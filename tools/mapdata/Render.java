import org.mapsforge.core.graphics.TileBitmap;
import org.mapsforge.core.model.Tile;
import org.mapsforge.core.util.MercatorProjection;
import org.mapsforge.core.util.Parameters;
import org.mapsforge.map.awt.graphics.AwtGraphicFactory;
import org.mapsforge.map.layer.hills.AdaptiveClasyHillShading;
import org.mapsforge.map.layer.hills.DemFolderFS;
import org.mapsforge.map.layer.hills.HillsRenderConfig;
import org.mapsforge.map.layer.hills.MemoryCachingHgtReaderTileSource;
import org.mapsforge.map.layer.labels.MapDataStoreLabelStore;
import org.mapsforge.map.layer.renderer.DatabaseRenderer;
import org.mapsforge.map.layer.renderer.RendererJob;
import org.mapsforge.map.model.DisplayModel;
import org.mapsforge.map.reader.MapFile;
import org.mapsforge.map.rendertheme.ExternalRenderTheme;
import org.mapsforge.map.rendertheme.XmlRenderThemeStyleLayer;
import org.mapsforge.map.rendertheme.rule.RenderThemeFuture;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.image.BufferedImage;
import java.awt.image.IndexColorModel;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

public class Render {

    record Out(int z, int x, int y, byte[] data, int color) {}

    static final Out DONE = new Out(-1, 0, 0, null, 0);

    public static void main(String[] a) throws Exception {
        if (a.length != 9) {
            System.err.println("usage: Render <map> <theme.xml> <demDir|-> <out.mbtiles> <minZ> <maxZ> <minLat,minLon,maxLat,maxLon> <256|512> <png|png8|jpg>");
            System.exit(2);
        }
        File mapPath = new File(a[0]), themePath = new File(a[1]);
        String dem = a[2], mbtiles = a[3], fmt = a[8];
        int minZ = Integer.parseInt(a[4]), maxZ = Integer.parseInt(a[5]), px = Integer.parseInt(a[7]);
        String[] b = a[6].split(",");
        double minLat = Double.parseDouble(b[0]), minLon = Double.parseDouble(b[1]);
        double maxLat = Double.parseDouble(b[2]), maxLon = Double.parseDouble(b[3]);
        if (minZ < 0 || maxZ > 20 || minZ > maxZ || px % 256 != 0 || minLat >= maxLat || minLon >= maxLon
                || !Set.of("png", "png8", "jpg").contains(fmt)) {
            throw new IllegalArgumentException("bad arguments");
        }

        Parameters.SQUARE_FRAME_BUFFER = false;
        DisplayModel.setDeviceScaleFactor(px / 256f);
        DisplayModel displayModel = new DisplayModel();
        var gf = AwtGraphicFactory.INSTANCE;

        MapFile map = new MapFile(mapPath, "zh");
        ExternalRenderTheme theme = new ExternalRenderTheme(themePath, menu -> {
            XmlRenderThemeStyleLayer base = menu.getLayer(menu.getDefaultValue());
            Set<String> cats = new HashSet<>(base.getCategories());
            for (XmlRenderThemeStyleLayer o : base.getOverlays()) {
                if (o.isEnabled()) cats.addAll(o.getCategories());
            }
            return cats;
        });
        RenderThemeFuture themeFuture = new RenderThemeFuture(gf, theme, displayModel);
        themeFuture.run();
        themeFuture.get();

        HillsRenderConfig hills = null;
        if (!dem.equals("-")) {
            var shadeSource = new MemoryCachingHgtReaderTileSource(new DemFolderFS(new File(dem)),
                    new AdaptiveClasyHillShading().setAdaptiveZoomEnabled(true), gf);
            shadeSource.applyConfiguration(true);
            hills = new HillsRenderConfig(shadeSource);
        }

        var labels = new MapDataStoreLabelStore(map, themeFuture, 1, displayModel, gf);
        var renderer = new DatabaseRenderer(map, gf, null, labels, true, false, hills);

        Connection db = DriverManager.getConnection("jdbc:sqlite:" + mbtiles);
        try (Statement s = db.createStatement()) {
            s.execute("PRAGMA journal_mode=WAL");
            s.execute("CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY, value TEXT)");
            s.execute("CREATE TABLE IF NOT EXISTS tiles(zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)");
            s.execute("CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles(zoom_level, tile_column, tile_row)");
            s.execute("CREATE TABLE IF NOT EXISTS blank(key INTEGER PRIMARY KEY, color INTEGER)");
        }
        String existingFmt = meta(db, "format");
        String dbFmt = fmt.equals("jpg") ? "jpg" : "png";
        if (existingFmt != null && !existingFmt.equals(dbFmt)) throw new IllegalStateException("db format is " + existingFmt);
        String existingPx = meta(db, "tile_size");
        if (existingPx != null && !existingPx.equals(String.valueOf(px))) throw new IllegalStateException("db tile_size is " + existingPx);

        Set<Long> have = new HashSet<>();
        try (ResultSet r = db.createStatement().executeQuery(
                "SELECT zoom_level, tile_column, tile_row FROM tiles WHERE zoom_level BETWEEN " + minZ + " AND " + maxZ)) {
            while (r.next()) have.add(key(r.getInt(1), r.getInt(2), r.getInt(3)));
        }
        try (ResultSet r = db.createStatement().executeQuery("SELECT key FROM blank")) {
            while (r.next()) have.add(r.getLong(1));
        }

        List<Tile> todo = new ArrayList<>();
        for (int z = minZ; z <= maxZ; z++) {
            byte zb = (byte) z;
            int x0 = MercatorProjection.longitudeToTileX(minLon, zb), x1 = MercatorProjection.longitudeToTileX(maxLon, zb);
            int y0 = MercatorProjection.latitudeToTileY(maxLat, zb), y1 = MercatorProjection.latitudeToTileY(minLat, zb);
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    if (!have.contains(key(z, x, tms(z, y)))) todo.add(new Tile(x, y, zb, px));
                }
            }
        }
        System.out.printf("%d tiles to render (%d already done)%n", todo.size(), have.size());

        BlockingQueue<Out> queue = new ArrayBlockingQueue<>(1000);
        AtomicLong bytes = new AtomicLong(), blank = new AtomicLong(), stored = new AtomicLong();
        Thread writer = new Thread(() -> {
            try (PreparedStatement ins = db.prepareStatement("INSERT OR REPLACE INTO tiles VALUES(?,?,?,?)");
                 PreparedStatement bl = db.prepareStatement("INSERT OR REPLACE INTO blank VALUES(?,?)")) {
                db.setAutoCommit(false);
                int n = 0;
                for (Out o = queue.take(); o != DONE; o = queue.take()) {
                    if (o.data == null) {
                        bl.setLong(1, key(o.z, o.x, o.y));
                        bl.setInt(2, o.color);
                        bl.executeUpdate();
                        continue;
                    }
                    ins.setInt(1, o.z);
                    ins.setInt(2, o.x);
                    ins.setInt(3, o.y);
                    ins.setBytes(4, o.data);
                    ins.executeUpdate();
                    if (++n % 500 == 0) db.commit();
                }
                db.commit();
                db.setAutoCommit(true);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        writer.start();

        long t0 = System.nanoTime();
        int threads = Runtime.getRuntime().availableProcessors();
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        AtomicLong done = new AtomicLong();
        for (Tile t : todo) {
            pool.submit(() -> {
                try {
                    RendererJob job = new RendererJob(t, map, themeFuture, displayModel, 1, false, false);
                    TileBitmap bmp = renderer.executeJob(job);
                    BufferedImage img = AwtGraphicFactory.getBitmap(bmp);
                    int row = tms(t.zoomLevel, t.tileY);
                    if (isUniform(img)) {
                        blank.incrementAndGet();
                        queue.put(new Out(t.zoomLevel, t.tileX, row, null, img.getRGB(0, 0) & 0xffffff));
                    } else {
                        byte[] data = encode(img, fmt);
                        bytes.addAndGet(data.length);
                        stored.incrementAndGet();
                        queue.put(new Out(t.zoomLevel, t.tileX, row, data, 0));
                    }
                    long d = done.incrementAndGet();
                    if (d % 1000 == 0) System.out.printf("%d/%d%n", d, todo.size());
                } catch (Throwable e) {
                    System.err.println("tile " + t + ": " + e);
                }
            });
        }
        pool.shutdown();
        pool.awaitTermination(30, TimeUnit.DAYS);
        queue.put(DONE);
        writer.join();
        double secs = (System.nanoTime() - t0) / 1e9;

        double[] bounds = {minLon, minLat, maxLon, maxLat};
        String pb = meta(db, "bounds");
        if (pb != null) {
            String[] p = pb.split(",");
            bounds[0] = Math.min(bounds[0], Double.parseDouble(p[0]));
            bounds[1] = Math.min(bounds[1], Double.parseDouble(p[1]));
            bounds[2] = Math.max(bounds[2], Double.parseDouble(p[2]));
            bounds[3] = Math.max(bounds[3], Double.parseDouble(p[3]));
        }
        int[] zr = new int[2];
        try (ResultSet r = db.createStatement().executeQuery("SELECT min(zoom_level), max(zoom_level) FROM tiles")) {
            r.next();
            zr[0] = r.getInt(1);
            zr[1] = r.getInt(2);
        }
        setMeta(db, "name", "MOI.OSM Taiwan TOPO (Rudy Map) raster");
        setMeta(db, "format", dbFmt);
        setMeta(db, "type", "baselayer");
        setMeta(db, "version", "1.3");
        setMeta(db, "tile_size", String.valueOf(px));
        setMeta(db, "minzoom", String.valueOf(zr[0]));
        setMeta(db, "maxzoom", String.valueOf(zr[1]));
        setMeta(db, "bounds", String.format("%.6f,%.6f,%.6f,%.6f", bounds[0], bounds[1], bounds[2], bounds[3]));
        setMeta(db, "attribution", "地圖 © Rudy Chung 魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw)；© OpenStreetMap contributors (ODbL)；內政部 DTM (政府資料開放授權)；style CC BY-NC-SA 3.0 based on OpenAndroMaps Elevate by Tobias Kühn");
        try (Statement s = db.createStatement()) {
            s.execute("PRAGMA journal_mode=DELETE");
        }
        db.close();

        System.out.printf("RESULT tiles=%d stored=%d blank=%d secs=%.1f tps=%.1f avgBytes=%.0f%n",
                todo.size(), stored.get(), blank.get(), secs, todo.size() / secs,
                stored.get() == 0 ? 0.0 : (double) bytes.get() / stored.get());
        System.exit(0);
    }

    static long key(int z, int x, int y) {
        return ((long) z << 48) | ((long) x << 24) | y;
    }

    static int tms(int z, int y) {
        return (1 << z) - 1 - y;
    }

    static String meta(Connection db, String k) throws Exception {
        try (PreparedStatement p = db.prepareStatement("SELECT value FROM metadata WHERE name=?")) {
            p.setString(1, k);
            ResultSet r = p.executeQuery();
            return r.next() ? r.getString(1) : null;
        }
    }

    static void setMeta(Connection db, String k, String v) throws Exception {
        try (PreparedStatement p = db.prepareStatement("INSERT OR REPLACE INTO metadata VALUES(?,?)")) {
            p.setString(1, k);
            p.setString(2, v);
            p.executeUpdate();
        }
    }

    static boolean isUniform(BufferedImage img) {
        int[] px = img.getRGB(0, 0, img.getWidth(), img.getHeight(), null, 0, img.getWidth());
        for (int p : px) if (p != px[0]) return false;
        return true;
    }

    static byte[] encode(BufferedImage src, String fmt) throws Exception {
        int w = src.getWidth(), h = src.getHeight();
        int[] px = src.getRGB(0, 0, w, h, null, 0, w);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (fmt.equals("png8")) {
            ImageIO.write(quantize(px, w, h), "png", out);
            return out.toByteArray();
        }
        BufferedImage rgb = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        rgb.setRGB(0, 0, w, h, px, 0, w);
        if (fmt.equals("png")) {
            ImageIO.write(rgb, "png", out);
            return out.toByteArray();
        }
        ImageWriter jw = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam p = jw.getDefaultWriteParam();
        p.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        p.setCompressionQuality(0.8f);
        try (var ios = new MemoryCacheImageOutputStream(out)) {
            jw.setOutput(ios);
            jw.write(null, new IIOImage(rgb, null, null), p);
        }
        jw.dispose();
        return out.toByteArray();
    }

    // ponytail: popularity quantizer on a 15-bit histogram, no dithering; smooth hillshade gradients may band. Upgrade: median-cut or pngquant-style k-means.
    static BufferedImage quantize(int[] px, int w, int h) {
        int[] count = new int[32768];
        long[][] sum = new long[32768][3];
        for (int p : px) {
            int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
            int bin = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
            count[bin]++;
            sum[bin][0] += r;
            sum[bin][1] += g;
            sum[bin][2] += b;
        }
        Integer[] bins = new Integer[32768];
        for (int i = 0; i < bins.length; i++) bins[i] = i;
        java.util.Arrays.sort(bins, (x, y) -> count[y] - count[x]);
        int n = 0;
        while (n < 256 && count[bins[n]] > 0) n++;
        byte[] rs = new byte[n], gs = new byte[n], bs = new byte[n];
        for (int i = 0; i < n; i++) {
            int c = count[bins[i]];
            rs[i] = (byte) (sum[bins[i]][0] / c);
            gs[i] = (byte) (sum[bins[i]][1] / c);
            bs[i] = (byte) (sum[bins[i]][2] / c);
        }
        int[] lut = new int[32768];
        java.util.Arrays.fill(lut, -1);
        byte[] idx = new byte[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
            int bin = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
            if (lut[bin] < 0) {
                int best = 0, bd = Integer.MAX_VALUE;
                for (int j = 0; j < n; j++) {
                    int dr = r - (rs[j] & 255), dg = g - (gs[j] & 255), db = b - (bs[j] & 255);
                    int d = dr * dr + dg * dg + db * db;
                    if (d < bd) {
                        bd = d;
                        best = j;
                    }
                }
                lut[bin] = best;
            }
            idx[i] = (byte) lut[bin];
        }
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_BYTE_INDEXED, new IndexColorModel(8, n, rs, gs, bs));
        out.getRaster().setDataElements(0, 0, w, h, idx);
        return out;
    }
}
