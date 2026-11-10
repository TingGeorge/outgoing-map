#!/bin/bash
set -euo pipefail

MODE=${1:-}
case "$MODE" in sample|full|bench) ;; *) echo "usage: $0 sample|full|bench" >&2; exit 2 ;; esac

TOOLS=$(cd "$(dirname "$0")" && pwd)
OUT=$(cd "$TOOLS/../.." && pwd)/MapData
mkdir -p "$OUT/src" "$OUT/lib" "$OUT/build" "$OUT/dem" "$OUT/samples"
cd "$OUT"

UA="Mozilla/5.0"
for f in MOI_OSM_Taiwan_TOPO_Rudy.map.zip MOI_OSM_Taiwan_TOPO_Rudy_hs_style.zip MOI_OSM_Taiwan_TOPO_Rudy.poi.zip hgtmix.zip; do
  [ -s "src/$f" ] || curl -fL -A "$UA" -C - -o "src/$f" "https://rudymap.tw/v1/$f"
done
[ -s src/MOI_OSM_Taiwan_TOPO_Rudy.map ] || unzip -oq src/MOI_OSM_Taiwan_TOPO_Rudy.map.zip MOI_OSM_Taiwan_TOPO_Rudy.map -d src
[ -s src/MOI_OSM_Taiwan_TOPO_Rudy.poi ] || unzip -oq src/MOI_OSM_Taiwan_TOPO_Rudy.poi.zip -d src
[ -s src/style/MOI_OSM.xml ] || unzip -oq src/MOI_OSM_Taiwan_TOPO_Rudy_hs_style.zip -d src/style
ls dem/*.hgt >/dev/null 2>&1 || unzip -oq src/hgtmix.zip -d dem

M=https://repo1.maven.org/maven2
for c in org/mapsforge/mapsforge-core/0.25.0 org/mapsforge/mapsforge-map/0.25.0 org/mapsforge/mapsforge-map-reader/0.25.0 \
         org/mapsforge/mapsforge-themes/0.25.0 org/mapsforge/mapsforge-map-awt/0.25.0 guru/nidi/com/kitfox/svgSalamander/1.1.3 \
         net/sf/kxml/kxml2/2.3.0 org/xerial/sqlite-jdbc/3.54.1.0; do
  jar=$(basename "$(dirname "$c")")-$(basename "$c").jar
  if [ ! -s "lib/$jar" ]; then
    curl -fsSL -o "lib/$jar" "$M/$c/$jar"
    [ "$(shasum -a 1 "lib/$jar" | cut -c1-40)" = "$(curl -fsSL "$M/$c/$jar.sha1" | cut -c1-40)" ] || { echo "sha1 mismatch $jar" >&2; exit 1; }
  fi
done
javac -cp "lib/*" -d build "$TOOLS/Render.java" "$TOOLS/Stitch.java"

render() { java -Djava.awt.headless=true -Xmx8g --enable-native-access=ALL-UNNAMED -cp "build:lib/*" Render \
  src/MOI_OSM_Taiwan_TOPO_Rudy.map src/style/MOI_OSM.xml dem "$@" 2>>render.log; }
stitch() { java --enable-native-access=ALL-UNNAMED -cp "build:lib/*" Stitch "$@" 2>/dev/null; }

python3 -I "$TOOLS/poi.py" src/MOI_OSM_Taiwan_TOPO_Rudy.poi poi.sqlite

TAIWAN=21.85,119.95,25.35,122.05
PENGHU=23.15,119.30,23.80,119.75
HEHUAN=24.05,121.18,24.25,121.42
PX=512
FMT=jpg

case "$MODE" in
  sample)
    render taiwan.mbtiles 7 11 $TAIWAN $PX $FMT
    render taiwan.mbtiles 7 11 $PENGHU $PX $FMT
    render taiwan.mbtiles 12 16 $HEHUAN $PX $FMT
    stitch taiwan.mbtiles 14 24.15 121.30 3 2 samples/z14_overview.png
    stitch taiwan.mbtiles 9 23.6 121.0 3 3 samples/z9_taiwan.png
    ;;
  full)
    render taiwan.mbtiles 7 15 $TAIWAN $PX $FMT
    render taiwan.mbtiles 7 15 $PENGHU $PX $FMT
    ;;
  bench)
    mkdir -p bench
    for px in 256 512; do
      maxz=16; [ $px = 512 ] && maxz=15
      for f in png png8 jpg; do
        for z in $(seq 12 $maxz); do echo "$px $f z$z $(render bench/hehuan_${px}_$f.mbtiles $z $z $HEHUAN $px $f | grep RESULT)"; done
      done
    done
    stitch bench/hehuan_256_png.mbtiles 15 24.1814 121.2816 3 3 samples/z15_256.png
    stitch bench/hehuan_512_png.mbtiles 15 24.1814 121.2816 3 3 samples/z15_512.png
    ;;
esac
du -sh "$OUT"
