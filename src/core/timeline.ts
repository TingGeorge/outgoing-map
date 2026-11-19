import type { NearestOnRoute, Photo, Placement, PoiOnRoute, Route, RouteSample, TimelineItem } from '../types'
import { distanceM, nearestOnRoute, sampleAtDistance, sampleAtTime } from './route'

export const SNAP_TO_ROUTE_M = 150

export const ORDER_STEP_M = 10

export const MAX_ORDER_SAMPLES = 20_000

export const MAX_ORDER_CELLS = 4_000_000

export function placePhotos(photos: Photo[], route: Route): Placement[] {
  const byTime = (photo: Photo): Placement | null => {
    const s = photo.takenAt === null ? null : sampleAtTime(route, photo.takenAt)
    return s && { source: 'track', lat: s.lat, lon: s.lon, ele: s.ele ?? photo.gps?.ele ?? null, routeDistanceM: s.distanceM }
  }

  const timed = photos.map((p) => (route.source === 'gpx' || !p.gps ? byTime(p) : null))
  const anchors = photos.flatMap((p, i) => (timed[i]?.source === 'track' ? [{ time: p.takenAt!, d: timed[i].routeDistanceM }] : []))
  const near = alongRoute(route, photos.filter((p, i) => !timed[i] && p.gps), anchors)

  return photos.map((photo, i) => {
    const gps = photo.gps
    if (timed[i]) return timed[i]
    if (!gps) return { source: 'none' }

    const hit = near.get(photo)
    const own = hit && hit.offsetM > SNAP_TO_ROUTE_M ? nearestOnRoute(route, gps) : hit
    const on = own && own.offsetM <= SNAP_TO_ROUTE_M ? sampleAtDistance(route, own.routeDistanceM) : null
    const routeDistanceM = hit?.routeDistanceM ?? 0

    if (on) return { source: 'exif', lat: on.lat, lon: on.lon, ele: on.ele ?? gps.ele, routeDistanceM, onRoute: true }
    return { source: 'exif', lat: gps.lat, lon: gps.lon, ele: gps.ele, routeDistanceM }
  })
}

function alongRoute(route: Route, photos: Photo[], anchors: { time: number; d: number }[]): Map<Photo, NearestOnRoute> {
  const out = new Map<Photo, NearestOnRoute>()
  const nearest = new Map<Photo, NearestOnRoute>()

  for (const p of photos) {
    const hit = nearestOnRoute(route, p.gps!)
    if (hit) nearest.set(p, hit)
    if (hit && (p.takenAt === null || route.source !== 'gpx')) out.set(p, hit)
  }

  const timed = photos
    .filter((p) => p.takenAt !== null && !out.has(p) && nearest.has(p))
    .sort((a, b) => a.takenAt! - b.takenAt! || nearest.get(a)!.routeDistanceM - nearest.get(b)!.routeDistanceM)

  if (timed.length === 0) return out

  // Photos placed by time are fixed: a photo placed by its GPS stays between the ones shot before and after it, so distance order is time order.
  const lows = timed.map((p) => anchors.reduce((lo, a) => (a.time <= p.takenAt! ? Math.max(lo, a.d) : lo), 0))
  const highs = timed.map((p) => anchors.reduce((hi, a) => (a.time >= p.takenAt! ? Math.min(hi, a.d) : hi), route.totalDistanceM))

  const step = Math.max(ORDER_STEP_M, route.totalDistanceM / MAX_ORDER_SAMPLES, (route.totalDistanceM * timed.length) / MAX_ORDER_CELLS)
  const grid: number[] = []

  for (let d = 0; d < route.totalDistanceM; d += step) grid.push(d)
  grid.push(route.totalDistanceM)

  const bounds = [...new Set([...lows, ...highs])].filter((d) => d > 0 && d < route.totalDistanceM)
  const at: RouteSample[] = (bounds.length ? [...new Set([...grid, ...bounds])].sort((a, b) => a - b) : grid).map((d) => sampleAtDistance(route, d)!)

  // ponytail: positions are the route sampled every ORDER_STEP_M, coarser past MAX_ORDER_SAMPLES or when photos × samples passes MAX_ORDER_CELLS (back pointers stay under ~8 MB), with flat-plane offsets, so an ordered photo lands within half a step of its best spot unless its own nearest point already fits the order; O(photos × samples) time and Uint16 back pointers per photo.
  const lat = Float64Array.from(at, (a) => a.lat)
  const lon = Float64Array.from(at, (a) => a.lon)
  let cost = new Float64Array(at.length)
  const from: Uint16Array[] = []

  for (const [i, p] of timed.entries()) {
    const next = new Float64Array(at.length)
    const back = new Uint16Array(at.length)
    const { lat: y, lon: x } = p.gps!
    const kx = Math.cos((y * Math.PI) / 180)
    let best = Infinity
    let arg = 0

    for (let k = 0; k < at.length; k++) {
      if (cost[k]! < best) {
        best = cost[k]!
        arg = k
      }

      back[k] = arg
      const d = at[k]!.distanceM
      next[k] = d < lows[i]! || d > highs[i]! ? Infinity : best + Math.hypot((lon[k]! - x) * kx, lat[k]! - y)
    }

    cost = next
    from.push(back)
  }

  const chosen: number[] = []
  let k = cost.indexOf(Math.min(...cost))

  for (let i = timed.length - 1; i >= 0; i--) {
    chosen[i] = at[k]!.distanceM
    k = from[i]![k]!
  }

  let lo = 0

  for (const [i, p] of timed.entries()) {
    const own = nearest.get(p)!
    const hi = Math.min(chosen[i + 1] ?? Infinity, highs[i]!)
    const d = own.routeDistanceM >= Math.max(lo, lows[i]!) && own.routeDistanceM <= hi ? own.routeDistanceM : chosen[i]!

    out.set(p, d === own.routeDistanceM ? own : { routeDistanceM: d, offsetM: distanceM(p.gps!, sampleAtDistance(route, d)!) })
    lo = d
  }

  return out
}

const RANK = { start: 0, poi: 1, photo: 2, end: 3 } as const

export function buildTimeline(route: Route, photos: Photo[], pois: PoiOnRoute[]): TimelineItem[] {
  const items: TimelineItem[] = []
  const first = sampleAtDistance(route, 0)
  const last = sampleAtDistance(route, route.totalDistanceM)

  if (first) items.push({ kind: 'start', time: first.time, routeDistanceM: 0, point: first })

  for (const hit of pois) items.push({ kind: 'poi', time: hit.passedAt, routeDistanceM: hit.routeDistanceM, hit })

  for (const photo of photos) {
    const p = photo.placement
    items.push({ kind: 'photo', time: photo.takenAt, routeDistanceM: p.source === 'none' ? null : p.routeDistanceM, photo })
  }

  if (last && route.points.length > 1) {
    items.push({ kind: 'end', time: last.time, routeDistanceM: last.distanceM, point: last })
  }

  const timed = route.startAt !== null

  const key = (item: TimelineItem): number[] => {
    const d = item.routeDistanceM

    if (item.kind === 'photo' && (item.time === null || d === null)) {
      return [1, item.time ?? Infinity, d ?? Infinity, 0]
    }

    const time = item.time ?? sampleAtDistance(route, d!)?.time ?? Infinity
    if (item.kind === 'start') return [0, -Infinity, 0, 0]
    return timed ? [0, time, d!, RANK[item.kind]] : [0, d!, RANK[item.kind], time]
  }

  const keys = new Map(items.map((item) => [item, key(item)]))

  return items.sort((a, b) => {
    const ka = keys.get(a)!
    const kb = keys.get(b)!
    const i = ka.findIndex((v, j) => v !== kb[j])
    return i < 0 ? 0 : ka[i]! - kb[i]!
  })
}
