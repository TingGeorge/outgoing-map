import { distanceM, nearestOnRoute, sampleAtDistance } from '../core'
import type { Poi, PoiKind, PoiOnRoute, Route } from '../types'

export const DEFAULT_POI_RADIUS_M = 100

const SAME_PLACE_M = 50
const M_PER_DEG = 111_320

interface PoiFile {
  kinds: PoiKind[]
  id: number[]
  name: string[]
  kind: number[]
  lat: number[]
  lon: number[]
  ele: (number | null)[]
}

export function decodePois(raw: PoiFile): Poi[] {
  let lat = 0
  let lon = 0

  return raw.id.map((id, i) => {
    lat += raw.lat[i]!
    lon += raw.lon[i]!

    return { id, name: raw.name[i]!, kind: raw.kinds[raw.kind[i]!]!, lat: lat / 1e5, lon: lon / 1e5, ele: raw.ele[i]! }
  })
}

let loading: Promise<Poi[]> | null = null

export function loadPois(): Promise<Poi[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}poi.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      return res.json() as Promise<PoiFile>
    })
    .then(decodePois)
    .catch(() => {
      loading = null
      throw new Error('無法載入景點資料，請確認網路後再試一次。')
    })

  return loading
}

export async function poisAlongRoute(route: Route, withinM: number = DEFAULT_POI_RADIUS_M): Promise<PoiOnRoute[]> {
  const points = route.points
  if (points.length < 2) return []

  const pois = await loadPois()

  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity

  for (const p of points) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLon = Math.min(minLon, p.lon)
    maxLon = Math.max(maxLon, p.lon)
  }

  const padLat = withinM / M_PER_DEG
  const padLon = withinM / (M_PER_DEG * Math.cos((Math.max(Math.abs(minLat), Math.abs(maxLat)) * Math.PI) / 180))

  const hits: PoiOnRoute[] = []

  for (const poi of pois) {
    if (poi.lat < minLat - padLat || poi.lat > maxLat + padLat || poi.lon < minLon - padLon || poi.lon > maxLon + padLon) continue

    const run = firstRun(route, poi, withinM)
    if (!run) continue

    const near = nearestOnRoute({ ...route, points: points.slice(run[0], run[1] + 1) }, poi)
    if (!near || near.offsetM > withinM) continue

    hits.push({ poi, offsetM: near.offsetM, routeDistanceM: near.routeDistanceM, passedAt: sampleAtDistance(route, near.routeDistanceM)?.time ?? null })
  }

  const kept: PoiOnRoute[] = []

  for (const hit of hits.sort((a, b) => a.offsetM - b.offsetM)) {
    if (!kept.some((k) => k.poi.name === hit.poi.name && distanceM(k.poi, hit.poi) <= SAME_PLACE_M)) kept.push(hit)
  }

  return kept.sort((a, b) => a.routeDistanceM - b.routeDistanceM)
}

// ponytail: bbox prefilter, then an O(route points) scan per candidate POI; a route spanning most of Taiwan with thousands of candidates gets slow, the upgrade is a grid index over route segments.
function firstRun(route: Route, poi: Poi, withinM: number): [number, number] | null {
  const points = route.points
  const kx = Math.cos((poi.lat * Math.PI) / 180)
  const limit = (withinM / M_PER_DEG) ** 2

  let start = -1

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const ax = (a.lon - poi.lon) * kx
    const ay = a.lat - poi.lat
    const dx = (b.lon - poi.lon) * kx - ax
    const dy = b.lat - poi.lat - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(Math.max(-(ax * dx + ay * dy) / len2, 0), 1) : 0
    const inside = (ax + t * dx) ** 2 + (ay + t * dy) ** 2 <= limit

    if (inside && start < 0) start = i - 1
    if (!inside && start >= 0) return [start, i - 1]
  }

  return start < 0 ? null : [start, points.length - 1]
}
