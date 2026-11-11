import type { Photo, Placement, PoiOnRoute, Route, TimelineItem } from '../types'
import { nearestOnRoute, sampleAtDistance, sampleAtTime } from './route'

export function placePhotos(photos: Photo[], route: Route): Placement[] {
  return photos.map((photo) => {
    const byTime = (): Placement | null => {
      const s = photo.takenAt === null ? null : sampleAtTime(route, photo.takenAt)
      return s && { source: 'track', lat: s.lat, lon: s.lon, ele: s.ele ?? photo.gps?.ele ?? null, routeDistanceM: s.distanceM }
    }

    const byGps = (): Placement | null => {
      const gps = photo.gps
      if (!gps) return null

      const routeDistanceM = nearestOnRoute(route, gps)?.routeDistanceM ?? 0
      return { source: 'exif', lat: gps.lat, lon: gps.lon, ele: gps.ele, routeDistanceM }
    }

    const placement = route.source === 'gpx' ? (byTime() ?? byGps()) : (byGps() ?? byTime())
    return placement ?? { source: 'none' }
  })
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
