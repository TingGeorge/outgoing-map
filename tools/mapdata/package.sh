#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)/MapData
OUT="$ROOT/device/MapData"
mkdir -p "$OUT/dem"
ln -f "$ROOT/taiwan.mbtiles" "$ROOT/poi.sqlite" "$OUT/"
ln -f "$ROOT"/dem/*.hgt "$OUT/dem/"
du -shL "$OUT"
echo "把這個資料夾拖進 Finder → iPhone → 檔案 → 登山回憶：$OUT"
