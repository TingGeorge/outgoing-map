import { PHOTO_TIME_TOLERANCE_MS } from '../types'
import type {
  ElevationProfile,
  EpochMs,
  LatLon,
  NearestOnRoute,
  Photo,
  Route,
  RoutePoint,
  RouteSample,
  RouteSource,
  TrackPoint,
  TripStats,
} from '../types'

const EARTH_RADIUS_M = 6_371_008.8

export const ELEVATION_HYSTERESIS_M = 5

export const GAP_MIN_M = 1000

export const GAP_MIN_SPEED_KMH = 12

const RAD = Math.PI / 180

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isRouteGap(a: TrackPoint, b: TrackPoint, meters = distanceM(a, b)): boolean {
  if (meters < GAP_MIN_M || a.time === null || b.time === null) return false

  const hours = (b.time - a.time) / 3_600_000
  return hours <= 0 || meters / 1000 / hours > GAP_MIN_SPEED_KMH
}

export function buildRoute(track: TrackPoint[] | null, photos: Photo[]): Route {
  if (track && track.length > 0) return toRoute('gpx', inTimeOrder(track))

  const points = photos
    .filter((p) => p.gps && p.takenAt !== null)
    .sort((a, b) => a.takenAt! - b.takenAt!)
    .map((p) => ({ lat: p.gps!.lat, lon: p.gps!.lon, ele: p.gps!.ele, time: p.takenAt }))

  return toRoute('photos', points)
}

function toRoute(source: RouteSource, track: TrackPoint[]): Route {
  let total = 0

  const points: RoutePoint[] = track.map((p, i) => {
    const step = i > 0 ? distanceM(track[i - 1]!, p) : 0
    if (!isRouteGap(track[i - 1] ?? p, p, step)) total += step
    return { lat: p.lat, lon: p.lon, ele: p.ele, time: p.time, distanceM: total }
  })

  const times = points.filter((p) => p.time !== null)

  return {
    source,
    points,
    totalDistanceM: total,
    startAt: times[0]?.time ?? null,
    endAt: times.at(-1)?.time ?? null,
  }
}

function inTimeOrder(track: TrackPoint[]): TrackPoint[] {
  if (track.every((p) => p.time !== null)) return [...track].sort((a, b) => a.time! - b.time!)
  return monotonicTimes(track)
}

function monotonicTimes(track: TrackPoint[]): TrackPoint[] {
  const timed = track.flatMap((p, i) => (p.time === null ? [] : [i]))
  const time = (j: number) => track[timed[j]!]!.time!

  const tails: number[] = []
  const previous: number[] = []

  for (let j = 0; j < timed.length; j++) {
    const k = lowerBound(tails.length, (m) => time(tails[m]!) > time(j))
    previous[j] = k > 0 ? tails[k - 1]! : -1
    tails[k] = j
  }

  if (tails.length === timed.length) return track

  const keep = new Set<number>()
  for (let j = tails.at(-1) ?? -1; j >= 0; j = previous[j]!) keep.add(timed[j]!)

  return track.map((p, i) => (p.time === null || keep.has(i) ? p : { ...p, time: null }))
}

export function routeStats(route: Route): TripStats {
  let ascentM = 0
  let descentM = 0
  let maxEleM: number | null = null
  let minEleM: number | null = null
  let reference: number | null = null
  let direction = 0

  for (const [i, { ele }] of route.points.entries()) {
    if (i > 0 && isRouteGap(route.points[i - 1]!, route.points[i]!)) {
      reference = null
      direction = 0
    }

    if (ele === null) continue

    maxEleM = Math.max(maxEleM ?? ele, ele)
    minEleM = Math.min(minEleM ?? ele, ele)

    if (reference === null) {
      reference = ele
      continue
    }

    const change = ele - reference

    if (change >= ELEVATION_HYSTERESIS_M || (direction > 0 && change > 0)) {
      ascentM += change
      reference = ele
      direction = 1
    } else if (change <= -ELEVATION_HYSTERESIS_M || (direction < 0 && change < 0)) {
      descentM -= change
      reference = ele
      direction = -1
    }
  }

  return {
    distanceM: route.totalDistanceM,
    ascentM,
    descentM,
    durationMs: route.startAt !== null && route.endAt !== null ? route.endAt - route.startAt : null,
    maxEleM,
    minEleM,
  }
}

export function sampleAtDistance(route: Route, distanceM: number): RouteSample | null {
  const points = route.points
  if (points.length === 0) return null

  const target = Math.min(Math.max(distanceM, 0), route.totalDistanceM)
  const i = Math.min(Math.max(lowerBound(points.length, (k) => points[k]!.distanceM >= target), 1), points.length - 1)
  const a = points[Math.max(i - 1, 0)]!
  const b = points[i]!
  const segment = b.distanceM - a.distanceM
  const k = segment > 0 ? (target - a.distanceM) / segment : 0

  return { ...between(a, b, k), time: timeAtDistance(route, target), distanceM: target }
}

function between(a: RoutePoint, b: RoutePoint, k: number) {
  return {
    lat: lerp(a.lat, b.lat, k),
    lon: lerp(a.lon, b.lon, k),
    ele: a.ele !== null && b.ele !== null ? lerp(a.ele, b.ele, k) : (a.ele ?? b.ele),
  }
}

function timeAtDistance(route: Route, distanceM: number): EpochMs | null {
  const timed = timedIndices(route)
  const at = (k: number) => route.points[timed[k]!]!
  if (timed.length === 0) return null

  const j = lowerBound(timed.length, (k) => at(k).distanceM >= distanceM)
  if (j === 0) return at(0).time
  if (j === timed.length) return at(j - 1).time

  const a = at(j - 1)
  const b = at(j)
  const segment = b.distanceM - a.distanceM

  return Math.round(lerp(a.time!, b.time!, segment > 0 ? (distanceM - a.distanceM) / segment : 0))
}

export function sampleAtTime(route: Route, time: EpochMs): RouteSample | null {
  const timed = timedIndices(route)
  const at = (k: number) => route.points[timed[k]!]!
  if (timed.length === 0) return null

  const start = at(0).time!
  const end = at(timed.length - 1).time!
  if (time < start - PHOTO_TIME_TOLERANCE_MS || time > end + PHOTO_TIME_TOLERANCE_MS) return null

  const t = Math.min(Math.max(time, start), end)
  const j = lowerBound(timed.length, (k) => at(k).time! >= t)
  const b = at(j)

  if (j === 0) return { ...between(b, b, 0), time: t, distanceM: b.distanceM }

  const a = at(j - 1)
  const span = b.time! - a.time!
  const k = span > 0 ? (t - a.time!) / span : 0
  const distance = lerp(a.distanceM, b.distanceM, k)

  if (timed[j] === timed[j - 1]! + 1) return { ...between(a, b, k), time: t, distanceM: distance }

  return { ...sampleAtDistance(route, distance)!, time: t }
}

export function nearestOnRoute(route: Route, point: LatLon): NearestOnRoute | null {
  const points = route.points
  if (points.length === 0) return null
  if (points.length === 1) return { routeDistanceM: 0, offsetM: distanceM(point, points[0]!) }

  const kx = Math.cos(point.lat * RAD)
  const x = (p: LatLon) => (p.lon - point.lon) * kx
  const y = (p: LatLon) => p.lat - point.lat

  let best = { d2: Infinity, i: 1, t: 0 }

  // ponytail: linear scan over every segment, O(n) per query; fine for one trip's photos and POIs, a grid index is the upgrade if this is ever called per frame.
  for (let i = 1; i < points.length; i++) {
    const ax = x(points[i - 1]!)
    const ay = y(points[i - 1]!)
    const dx = x(points[i]!) - ax
    const dy = y(points[i]!) - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(Math.max(-(ax * dx + ay * dy) / len2, 0), 1) : 0
    const d2 = (ax + t * dx) ** 2 + (ay + t * dy) ** 2

    if (d2 < best.d2) best = { d2, i, t }
  }

  const a = points[best.i - 1]!
  const b = points[best.i]!
  const nearest = { lat: lerp(a.lat, b.lat, best.t), lon: lerp(a.lon, b.lon, best.t) }

  return {
    routeDistanceM: lerp(a.distanceM, b.distanceM, best.t),
    offsetM: distanceM(point, nearest),
  }
}

export function elevationProfile(route: Route, samples = 200): ElevationProfile | null {
  const withEle = route.points.filter((p) => p.ele !== null)
  if (withEle.length === 0) return null

  const eles = withEle.map((p) => p.ele!)
  const minEleM = eles.reduce((a, b) => Math.min(a, b))
  const maxEleM = eles.reduce((a, b) => Math.max(a, b))
  const count = Math.max(2, Math.floor(samples))

  if (withEle.length <= count) {
    return {
      samples: withEle.map((p) => ({ distanceM: p.distanceM, ele: p.ele! })),
      totalDistanceM: route.totalDistanceM,
      minEleM,
      maxEleM,
    }
  }

  const out = []
  let j = 0

  for (let i = 0; i < count; i++) {
    const d = (route.totalDistanceM * i) / (count - 1)
    while (j < withEle.length - 2 && withEle[j + 1]!.distanceM < d) j++

    const a = withEle[j]!
    const b = withEle[j + 1]!
    const segment = b.distanceM - a.distanceM
    const k = segment > 0 ? Math.min(Math.max((d - a.distanceM) / segment, 0), 1) : 0

    out.push({ distanceM: d, ele: lerp(a.ele!, b.ele!, k) })
  }

  return { samples: out, totalDistanceM: route.totalDistanceM, minEleM, maxEleM }
}

const timedCache = new WeakMap<Route, number[]>()

function timedIndices(route: Route): number[] {
  let timed = timedCache.get(route)

  if (!timed) {
    timed = route.points.flatMap((p, i) => (p.time === null ? [] : [i]))
    timedCache.set(route, timed)
  }

  return timed
}

function lowerBound(length: number, isAtOrAfter: (i: number) => boolean): number {
  let lo = 0
  let hi = length

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (isAtOrAfter(mid)) hi = mid
    else lo = mid + 1
  }

  return lo
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}
