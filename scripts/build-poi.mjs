import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const KINDS = ['peak', 'trailhead', 'hut', 'shelter', 'campsite', 'viewpoint', 'water', 'waterfall', 'lake', 'hotspring']

const GENERIC = new Set([
  'water', 'drink water', 'drinking water', 'spring', 'springs', 'toilet', 'toilets', 'shelter', 'pavilion', 'viewpoint', 'view point',
  'campsite', 'campground', 'camping', 'camping area', 'camp', 'peak', 'summit', 'hut', 'parking', 'trailhead', 'lake', 'pond',
  'waterfall', 'spa', 'hot spring', 'hot springs', 'unnamed', 'noname', 'no name', 'beach', 'bridge', 'view', 'sunset', 'sunrise',
  'swimming pool', 'pool', 'entrance', 'exit', 'gate', 'platform', 'bench', 'lookout', 'viewing platform', 'observation deck',
  '亭', '涼亭', '涼棚', '八角亭', '六角亭', '四方亭', '休息亭', '休憩亭', '休息涼亭', '休憩涼亭', '觀景亭', '觀景涼亭',
  '觀景台', '觀景臺', '觀景平台', '觀景平臺', '觀景點', '展望', '展望點', '展望台', '展望平台', '景觀平台', '平台', '瞭望台',
  '休憩平台', '休息區', '休憩區', '水源', '活水', '活水源', '泉水', '取水點', '加水站', '飲水機', '冰溫熱飲水機', '洗手台',
  '瀑布', '營地', '露營區', '露營地', '臨時營地', '獵寮', '獵寮營地', '工寮', '工寮營地', '登山口', '山屋', '避難山屋', '避難小屋',
  '溫泉', '溫泉露頭', '野溪溫泉露頭', '湖', '湖泊', '人工湖', '生態池', '山頂',
  '候車亭', '公車亭', '司令台', '升旗台', '賞鳥平台', '賞鳥亭', '觀瀑平台', '觀瀑台', '觀瀑亭', '眺景涼亭', '眺景台', '戲台', '舞台',
  '瞭望臺', '攝影平台', '正門', '北門', '南門', '東門', '西門', '大門', '入口', '出口', '廁所', '公廁', '停車場',
])

const NUMBER = '(第[\\d一二三四五六七八九十]+號?|[\\d一二三四五六七八九十]+號|\\d{1,2})'

const generic = (name) => {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ')
  const stem = n.replace(new RegExp(`^(${NUMBER} ?|小)`), '').replace(new RegExp(` ?${NUMBER}$`), '')

  return GENERIC.has(n) || GENERIC.has(stem) || /^[\d.,]+ ?(k|m|km)?$/.test(n) || /^(?=.*\d)[\da-f-]+$/.test(n) || /^[\p{P}\p{S} ]*$/u.test(n)
}

const sql = `select id, name, kind, lat, lon, ele from poi
  where kind != 'other_hiking' and trim(name) != '' order by lat, lon, id`
const all = JSON.parse(execFileSync('sqlite3', ['-json', 'data/poi.sqlite', sql], { maxBuffer: 1 << 28 }))
const rows = all.filter((r) => !generic(r.name))

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
console.log(`wrote public/poi.json: ${rows.length} pois, ${all.length - rows.length} generic names dropped`)
