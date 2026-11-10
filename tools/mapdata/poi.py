import re
import sqlite3
import sys
from collections import Counter

src, dst = sys.argv[1], sys.argv[2]


def kind(t, name):
    n, tour, am, w = t.get("natural"), t.get("tourism"), t.get("amenity"), t.get("water")
    if n in ("peak", "volcano") or t.get("man_made") == "summit_board":
        return "peak"
    if tour in ("alpine_hut", "wilderness_hut"):
        return "hut"
    if am == "shelter":
        return "shelter"
    if t.get("highway") == "trailhead":
        return "trailhead"
    if n == "waterfall" or t.get("waterway") == "waterfall":
        return "waterfall"
    if tour == "viewpoint":
        return "viewpoint"
    if n == "hot_spring" or t.get("bath:type") == "hot_spring":
        return "hotspring"
    if n == "spring" or am in ("drinking_water", "water_point"):
        return "water"
    if tour == "camp_site":
        return "campsite"
    if n == "saddle":
        return "saddle"
    if n == "water" and (w == "lake" or (w is None and re.search("[湖潭]", name))):
        return "lake"
    if t.get("man_made") == "survey_point" or t.get("highway") == "emergency_access_point" or t.get("information") == "mobile":
        return "other_hiking"
    return None


def ele(v):
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", v or "")
    return float(m.group(1)) if m else None


inp = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
out = sqlite3.connect(dst)
out.executescript("""
DROP TABLE IF EXISTS poi;
CREATE TABLE poi(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, ele REAL);
CREATE INDEX poi_lat ON poi(lat);
CREATE INDEX poi_lon ON poi(lon);
""")

rows = []
for pid, data, lat, lon in inp.execute("SELECT d.id, d.data, i.lat, i.lon FROM poi_data d JOIN poi_index i ON i.id = d.id"):
    tags = dict(kv.split("=", 1) for kv in data.split("\r") if "=" in kv)
    name = (tags.get("name") or tags.get("name:zh") or "").strip()
    k = kind(tags, name)
    if not name or not k:
        continue
    name = re.sub(r",\s*-?\d+(\.\d+)?\s*m$", "", name)
    rows.append((pid, name, k, lat, lon, ele(tags.get("ele"))))

out.executemany("INSERT INTO poi VALUES(?,?,?,?,?,?)", rows)
out.commit()
out.execute("VACUUM")
out.close()

for k, n in Counter(r[2] for r in rows).most_common():
    print(k, n)
print("total", len(rows))
