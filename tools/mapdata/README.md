# Offline map data

`./build.sh sample|full|bench` rebuilds everything under `MapData/` (gitignored) from a clean checkout.
Needs only `java`/`javac` (17+), `curl`, `unzip`, `python3`.

- Downloads 魯地圖 from https://rudymap.tw/v1/ into `MapData/src/` and jars from Maven Central into `MapData/lib/` (sha1-checked).
- `Render.java` renders tiles with Mapsforge 0.25.0 + Rudy's `MOI_OSM.xml` hs theme (default `elmt-hiking` style, `zh` names, hillshading from `MapData/dem/`) straight into an MBTiles file.
  `Render <map> <theme.xml> <demDir|-> <out.mbtiles> <minZ> <maxZ> <minLat,minLon,maxLat,maxLon> <256|512> <png|png8|jpg>`.
  Uses all cores, commits every 500 tiles, skips tiles already in the DB, so it can be re-run after an interrupt.
- `poi.py` turns the Mapsforge POI DB into `MapData/poi.sqlite` (`poi(id, name, kind, lat, lon, ele)`).
- `Stitch.java` stitches tiles into a PNG for eyeballing.

| mode   | output |
|--------|--------|
| sample | `taiwan.mbtiles`: Taiwan + Penghu z7–11, Hehuanshan z12–max; `poi.sqlite`; `dem/*.hgt`; `samples/z14_overview.png` |
| full   | `taiwan.mbtiles`: Taiwan main island (incl. Lanyu, Green Island) + Penghu, z7–max |
| bench  | `bench/hehuan_<px>_<fmt>.mbtiles` per format, timings per zoom, `samples/z15_256.png`, `samples/z15_512.png` |

## App notes

- MBTiles rows are TMS (`tile_row = 2^z - 1 - y`). `metadata.tile_size` is the pixel size; a 512 tile at zoom z covers the same area as a 256 tile at z, so set `MKTileOverlay.tileSize` to it.
- Tiles that rendered as one flat colour (open sea) are not stored. Their keys are in table `blank(key = z<<48 | x<<24 | tms_row, color = 0xRRGGBB)`; the colour is always the sea `#B3DDFF`. Treat a missing tile inside `bounds` as a flat `#B3DDFF` tile.

## Attribution the app must show

地圖 © Rudy Chung 魯地圖 MOI.OSM Taiwan TOPO (https://rudymap.tw) · © OpenStreetMap contributors (ODbL) · 內政部 20m DTM (政府資料開放授權條款) · JAXA AW3D30 · Map style CC BY-NC-SA 3.0, based on OpenAndroMaps Elevate by Tobias Kühn.

Rudy's licence requires reproducing his copyright notice + conditions (or a link to them) and using a distinguishable name for modified maps; the style is **NonCommercial**.
