import type { NearestOnRoute, Photo, Placement, PoiOnRoute, Route, TimelineItem } from '../types'
import { nearestOnRoute, routeCandidates, sampleAtDistance, sampleAtTime } from './route'

export const SNAP_TO_ROUTE_M = 150

export function placePhotos(photos: Photo[], route: Route): Placement[] {
  const byTime = (photo: Photo): Placement | null => {
    const s = photo.takenAt === null ? null : sampleAtTime(route, photo.takenAt)
    return s && { source: 'track', lat: s.lat, lon: s.lon, ele: s.ele ?? photo.gps?.ele ?? null, routeDistanceM: s.distanceM }
  }

  const timed = photos.map((p) => (route.source === 'gpx' || !p.gps ? byTime(p) : null))
  const near = alongRoute(route, photos.filter((p, i) => !timed[i] && p.gps))

  return photos.map((photo, i) => {
    const gps = photo.gps
    if (timed[i]) return timed[i]
    if (!gps) return { source: 'none' }

    const hit = near.get(photo)
    const on = hit && hit.offsetM <= SNAP_TO_ROUTE_M ? sampleAtDistance(route, hit.routeDistanceM) : null
    const routeDistanceM = hit?.routeDistanceM ?? 0

    if (on) return { source: 'exif', lat: on.lat, lon: on.lon, ele: on.ele ?? gps.ele, routeDistanceM }
    return { source: 'exif', lat: gps.lat, lon: gps.lon, ele: gps.ele, routeDistanceM }
  })
}

function alongRoute(route: Route, photos: Photo[]): Map<Photo, NearestOnRoute> {
  const out = new Map<Photo, NearestOnRoute>()

  for (const p of photos) {
    const hit = p.takenAt === null ? nearestOnRoute(route, p.gps!) : null
    if (hit) out.set(p, hit)
  }

  const timed = photos.filter((p) => p.takenAt !== null).sort((a, b) => a.takenAt! - b.takenAt!)

  // ponytail: candidates are only the local minima of each photo's offset along the route (plus the route end), so an order-constrained photo jumps to the next such minimum instead of the exact boundary point; O(photos × points) like nearestOnRoute. Add the previous photo's position as a candidate if that ever matters.
  const options = timed.map((p) => routeCandidates(route, p.gps!))
  if (!options[0]?.length) return out

  const cost: number[][] = []
  const from: number[][] = []

  for (const [i, here] of options.entries()) {
    const prev = options[i - 1] ?? []
    let best = i === 0 ? 0 : Infinity
    let arg = -1
    let m = 0

    from[i] = []
    cost[i] = here.map((c, k) => {
      for (; m < prev.length && prev[m]!.routeDistanceM <= c.routeDistanceM; m++) {
        if (cost[i - 1]![m]! < best) {
          best = cost[i - 1]![m]!
          arg = m
        }
      }

      from[i]![k] = arg
      return best + c.offsetM
    })
  }

  const last = cost.at(-1)!
  let k = last.indexOf(Math.min(...last))

  for (let i = options.length - 1; i >= 0; i--) {
    out.set(timed[i]!, options[i]![k]!)
    k = from[i]![k]!
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
    return timed ? [0, time, d!, RANK[item.kind]] : [0, d!, time, RANK[item.kind]]
  }

  const keys = new Map(items.map((item) => [item, key(item)]))

  return items.sort((a, b) => {
    const ka = keys.get(a)!
    const kb = keys.get(b)!
    const i = ka.findIndex((v, j) => v !== kb[j])
    return i < 0 ? 0 : ka[i]! - kb[i]!
  })
}
