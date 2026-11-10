import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

public class Stitch {

    public static void main(String[] a) throws Exception {
        if (a.length != 7) {
            System.err.println("usage: Stitch <in.mbtiles> <z> <lat> <lon> <cols> <rows> <out.png>");
            System.exit(2);
        }
        int z = Integer.parseInt(a[1]), cols = Integer.parseInt(a[4]), rows = Integer.parseInt(a[5]);
        double lat = Double.parseDouble(a[2]), lon = Double.parseDouble(a[3]);
        int n = 1 << z;
        int cx = (int) Math.floor((lon + 180) / 360 * n);
        double r = Math.toRadians(lat);
        int cy = (int) Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
        int x0 = cx - cols / 2, y0 = cy - rows / 2;

        try (Connection db = DriverManager.getConnection("jdbc:sqlite:" + a[0])) {
            int px = Integer.parseInt(value(db, "SELECT value FROM metadata WHERE name='tile_size'"));
            BufferedImage out = new BufferedImage(cols * px, rows * px, BufferedImage.TYPE_INT_RGB);
            Graphics2D g = out.createGraphics();
            g.setColor(Color.MAGENTA);
            g.fillRect(0, 0, out.getWidth(), out.getHeight());
            PreparedStatement q = db.prepareStatement("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?");
            PreparedStatement b = db.prepareStatement("SELECT color FROM blank WHERE key=?");
            for (int i = 0; i < cols; i++) {
                for (int j = 0; j < rows; j++) {
                    int x = x0 + i, y = n - 1 - (y0 + j);
                    q.setInt(1, z);
                    q.setInt(2, x);
                    q.setInt(3, y);
                    ResultSet t = q.executeQuery();
                    if (t.next()) {
                        g.drawImage(ImageIO.read(new ByteArrayInputStream(t.getBytes(1))), i * px, j * px, null);
                        continue;
                    }
                    b.setLong(1, ((long) z << 48) | ((long) x << 24) | y);
                    ResultSet c = b.executeQuery();
                    if (c.next()) {
                        g.setColor(new Color(c.getInt(1)));
                        g.fillRect(i * px, j * px, px, px);
                    }
                }
            }
            ImageIO.write(out, "png", new File(a[6]));
        }
    }

    static String value(Connection db, String sql) throws Exception {
        try (ResultSet r = db.createStatement().executeQuery(sql)) {
            return r.next() ? r.getString(1) : null;
        }
    }
}
