import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const KINDS = ['peak', 'trailhead', 'hut', 'shelter', 'campsite', 'viewpoint', 'water', 'waterfall', 'lake', 'hotspring']

const sql = `select id, name, kind, lat, lon, ele from poi
  where kind != 'other_hiking' and trim(name) != '' order by lat, lon, id`
const rows = JSON.parse(execFileSync('sqlite3', ['-json', 'data/poi.sqlite', sql], { maxBuffer: 1 << 28 }))

const lat = rows.map((r) => Math.round(r.lat * 1e5))
const lon = rows.map((r) => Math.round(r.lon * 1e5))

const out = {
  kinds: KINDS,
  id: rows.map((r) => r.id),
  name: rows.map((r) => r.name.trim()),
  kind: rows.map((r) => KINDS.indexOf(r.kind)),
  lat: lat.map((v, i) => (i ? v - lat[i - 1] : v)),
  lon: lon.map((v, i) => (i ? v - lon[i - 1] : v)),
  ele: rows.map((r) => (r.ele === null ? null : Math.round(r.ele))),
}

if (out.kind.includes(-1)) throw new Error('unknown kind')

mkdirSync('public', { recursive: true })
writeFileSync('public/poi.json', JSON.stringify(out))
console.log(`wrote public/poi.json: ${rows.length} pois`)
