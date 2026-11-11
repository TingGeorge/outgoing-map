import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Photo, PhotoGps, Poi, PoiOnRoute, TrackPoint } from '../types'
import { buildRoute, buildTimeline, parseGpx, placePhotos } from './index'

const t0 = 1_700_000_000_000
const MIN = 60_000

const tp = (lon: number, ele: number | null = null, time: number | null = null, lat = 24): TrackPoint => ({ lat, lon, ele, time })

const straight = () => buildRoute([tp(121.0, 1000, t0), tp(121.01, 1100, t0 + 30 * MIN), tp(121.02, 1200, t0 + 60 * MIN)], [])

const gps = (lon: number, lat = 24, ele: number | null = null): PhotoGps => ({ lat, lon, ele, heading: null })

let n = 0
const photo = (over: Partial<Photo>): Photo => ({
  id: `p${n++}`,
  tripId: 't',
  fileName: 'a.jpg',
  takenAt: null,
  gps: null,
  caption: '',
  width: 1,
  height: 1,
  placement: { source: 'none' },
  ...over,
})

const poi = (id: number, routeDistanceM: number, passedAt: number | null): PoiOnRoute => ({
  poi: { id, name: `P${id}`, kind: 'peak', lat: 24, lon: 121, ele: null } satisfies Poi,
  offsetM: 0,
  routeDistanceM,
  passedAt,
})

const fixture = (name: string) => parseGpx(readFileSync(`tests/fixtures/${name}`, 'utf8')).points

describe('placePhotos', () => {
  test('ported Swift cases with time-on-track first', () => {
    const route = straight()
    const total = route.totalDistanceM

    const [both, timed, lost, late, lateWithGps, slightlyLate] = placePhotos(
      [
        photo({ takenAt: t0 + 100_000, gps: gps(121.01, 24.001) }),
        photo({ takenAt: t0 + 15 * MIN }),
        photo({}),
        photo({ takenAt: t0 + 105 * MIN }),
        photo({ takenAt: t0 + 105 * MIN, gps: gps(121.01, 24.001, 3000) }),
        photo({ takenAt: t0 + 80 * MIN }),
      ],
      route,
    )

    expect(both).toMatchObject({ source: 'track', lat: 24 })
    expect(both!.source === 'track' && both!.routeDistanceM).toBeCloseTo((total * 100) / 3600, 3)

    expect(timed).toMatchObject({ source: 'track' })
    if (timed!.source !== 'track') throw new Error()
    expect(timed!.lon).toBeCloseTo(121.005, 6)
    expect(timed!.ele).toBeCloseTo(1050, 6)
    expect(timed!.routeDistanceM / total).toBeCloseTo(0.25, 3)

    expect(lost).toEqual({ source: 'none' })
    expect(late).toEqual({ source: 'none' })

    expect(lateWithGps).toMatchObject({ source: 'exif', lat: 24.001, lon: 121.01, ele: 3000 })
    expect(lateWithGps!.source === 'exif' && lateWithGps!.routeDistanceM / total).toBeCloseTo(0.5, 3)

    expect(slightlyLate).toMatchObject({ source: 'track', routeDistanceM: total, lon: 121.02 })
  })

  test('the photo keeps its own elevation only when the track has none', () => {
    const route = buildRoute([tp(121, null, t0), tp(121.01, null, t0 + MIN)], [])
    expect(placePhotos([photo({ takenAt: t0, gps: gps(121, 24, 777) })], route)[0]).toMatchObject({ source: 'track', ele: 777 })
    expect(placePhotos([photo({ takenAt: t0 })], route)[0]).toMatchObject({ source: 'track', ele: null })
  })

  test('out-and-back: time puts the photo on the right leg even with GPS', () => {
    const out = [0, 1, 2, 3, 4].map((i) => tp(121 + i * 0.005, null, t0 + i * 10 * MIN))
    const back = [3, 2, 1, 0].map((i, k) => tp(121 + i * 0.005, null, t0 + (5 + k) * 10 * MIN))
    const route = buildRoute([...out, ...back], [])
    const half = route.totalDistanceM / 2

    const [goingUp, comingDown] = placePhotos(
      [photo({ takenAt: t0 + 10 * MIN, gps: gps(121.005) }), photo({ takenAt: t0 + 70 * MIN, gps: gps(121.005) })],
      route,
    )

    expect(goingUp!.source === 'track' && goingUp!.routeDistanceM).toBeLessThan(half)
    expect(comingDown!.source === 'track' && comingDown!.routeDistanceM).toBeGreaterThan(half)
  })

  test('an untimed GPX: GPS photos go to the nearest point, time-only photos stay unplaced', () => {
    const route = buildRoute(fixture('no-time.gpx'), [])
    const summit = route.points[58]!

    const [withGps, timeOnly] = placePhotos([photo({ takenAt: Date.UTC(2026, 10, 7, 1), gps: gps(summit.lon, summit.lat) }), photo({ takenAt: Date.UTC(2026, 10, 7, 1) })], route)

    expect(withGps).toMatchObject({ source: 'exif', lat: summit.lat })
    expect(withGps!.source === 'exif' && withGps!.routeDistanceM).toBeCloseTo(summit.distanceM, 3)
    expect(timeOnly).toEqual({ source: 'none' })
  })

  test('the timed fixture places the summit photo time at the summit', () => {
    const route = buildRoute(fixture('hehuan-north.gpx'), [])
    const summit = route.points[58]!

    const [p] = placePhotos([photo({ takenAt: summit.time })], route)
    expect(p).toMatchObject({ source: 'track', lat: summit.lat, lon: summit.lon, ele: 3424 })
  })

  test('a route built from photos: GPS first, then time between neighbours', () => {
    const photos = [photo({ takenAt: t0, gps: gps(121) }), photo({ takenAt: t0 + 20 * MIN, gps: gps(121.02) }), photo({ takenAt: t0 + 10 * MIN })]
    const route = buildRoute(null, photos)
    const [first, , between] = placePhotos(photos, route)

    expect(first).toMatchObject({ source: 'exif', lon: 121, routeDistanceM: 0 })
    expect(between).toMatchObject({ source: 'track' })
    expect(between!.source === 'track' && between!.lon).toBeCloseTo(121.01, 6)
  })

  test('an empty route', () => {
    const route = buildRoute(null, [])
    expect(placePhotos([photo({ takenAt: t0, gps: gps(121) }), photo({ takenAt: t0 })], route)).toEqual([
      { source: 'exif', lat: 24, lon: 121, ele: null, routeDistanceM: 0 },
      { source: 'none' },
    ])
  })
})

describe('buildTimeline', () => {
  const placed = (route: ReturnType<typeof straight>, over: Partial<Photo>) => {
    const p = photo(over)
    return { ...p, placement: placePhotos([p], route)[0]! }
  }

  const ids = (items: ReturnType<typeof buildTimeline>) =>
    items.map((i) => (i.kind === 'poi' ? `poi${i.hit.poi.id}` : i.kind === 'photo' ? i.photo.fileName : i.kind))

  test('start, POIs, photos and end by time', () => {
    const route = straight()
    const items = buildTimeline(
      route,
      [placed(route, { fileName: 'mid', takenAt: t0 + 30 * MIN }), placed(route, { fileName: 'early', takenAt: t0 + 5 * MIN })],
      [poi(2, 1800, t0 + 54 * MIN), poi(1, 400, t0 + 12 * MIN)],
    )

    expect(ids(items)).toEqual(['start', 'early', 'poi1', 'mid', 'poi2', 'end'])
    expect(items[0]).toMatchObject({ time: t0, routeDistanceM: 0, point: { lon: 121 } })
    expect(items.at(-1)).toMatchObject({ time: t0 + 60 * MIN, routeDistanceM: route.totalDistanceM })
  })

  test('route distance breaks ties, then start before everything and end after', () => {
    const route = straight()
    const items = buildTimeline(
      route,
      [placed(route, { fileName: 'atStart', takenAt: t0 }), placed(route, { fileName: 'atEnd', takenAt: t0 + 60 * MIN })],
      [poi(2, 900, t0 + 20 * MIN), poi(1, 100, t0 + 20 * MIN)],
    )

    expect(ids(items)).toEqual(['start', 'atStart', 'poi1', 'poi2', 'atEnd', 'end'])
  })

  test('untimed or unplaced photos go last, timed ones first among them', () => {
    const route = straight()
    const items = buildTimeline(
      route,
      [
        placed(route, { fileName: 'noTimeWithGps', gps: gps(121.005) }),
        placed(route, { fileName: 'tooLate', takenAt: t0 + 200 * MIN }),
        placed(route, { fileName: 'onTrack', takenAt: t0 + 10 * MIN }),
        placed(route, { fileName: 'nothing' }),
      ],
      [],
    )

    expect(ids(items)).toEqual(['start', 'onTrack', 'end', 'tooLate', 'noTimeWithGps', 'nothing'])
    expect(items.find((i) => i.kind === 'photo' && i.photo.fileName === 'tooLate')!.routeDistanceM).toBeNull()
  })

  test('a POI without a passing time is ordered by where it is', () => {
    const route = straight()
    const items = buildTimeline(route, [placed(route, { fileName: 'p', takenAt: t0 + 20 * MIN })], [poi(1, route.totalDistanceM / 2, null)])

    expect(ids(items)).toEqual(['start', 'p', 'poi1', 'end'])
  })

  test('an untimed route orders by distance', () => {
    const route = buildRoute(fixture('no-time.gpx'), [])
    const summit = route.points[58]!
    const items = buildTimeline(
      route,
      [placed(route, { fileName: 'summit', takenAt: t0, gps: gps(summit.lon, summit.lat) })],
      [poi(1, 3000, null), poi(2, 500, null)],
    )

    expect(ids(items)).toEqual(['start', 'poi2', 'summit', 'poi1', 'end'])
    expect(items[0]!.time).toBeNull()
  })

  test('empty and single-point routes', () => {
    const empty = buildRoute(null, [])
    expect(buildTimeline(empty, [photo({ fileName: 'x' })], [])).toMatchObject([{ kind: 'photo', routeDistanceM: null }])

    expect(ids(buildTimeline(buildRoute([tp(121, 1, t0)], []), [], []))).toEqual(['start'])
  })
})
