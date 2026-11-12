import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Photo, PhotoGps, Poi, PoiOnRoute, TrackPoint } from '../types'
import { SNAP_TO_ROUTE_M, buildRoute, buildTimeline, nearestOnRoute, parseGpx, placePhotos, routeStats, sampleAtDistance } from './index'

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

    expect(lateWithGps).toMatchObject({ source: 'exif', lat: 24, lon: 121.01, ele: 1100 })
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

describe('a drawn GPX with made-up times', () => {
  const fake = Date.UTC(2022, 11, 28, 6)
  const day = Date.UTC(2023, 0, 8)
  const HOUR = 60 * MIN

  const loop = () => {
    const out = Array.from({ length: 21 }, (_, i) => ({ lat: 24, lon: 121 + i * 0.001 }))
    const back = Array.from({ length: 21 }, (_, i) => ({ lat: 24.0003, lon: 121.02 - i * 0.001 }))
    return [...out, ...back].map((p, i) => tp(p.lon, 1000 + i, fake + i * 2 * MIN, p.lat))
  }

  const shots = () => [
    photo({ fileName: 'trailhead', takenAt: day + 1 * HOUR, gps: gps(121, 24.00005) }),
    photo({ fileName: 'out', takenAt: day + 2 * HOUR, gps: gps(121.005, 24.0002) }),
    photo({ fileName: 'turn', takenAt: day + 3 * HOUR, gps: gps(121.02, 24.00015) }),
    photo({ fileName: 'back', takenAt: day + 4 * HOUR, gps: gps(121.005, 24.0001) }),
    photo({ fileName: 'home', takenAt: day + 5 * HOUR, gps: gps(121, 24.00025) }),
  ]

  test('photos from another day make the route untimed, like a GPX without time', () => {
    const route = buildRoute(loop(), shots())
    const untimed = buildRoute(loop().map((p) => ({ ...p, time: null })), [])

    expect(route).toEqual(untimed)
    expect(route.startAt).toBeNull()
    expect(routeStats(route).durationMs).toBeNull()
  })

  test('one photo inside the track time keeps the track time and its time placement', () => {
    const inside = photo({ takenAt: fake + 30 * MIN, gps: gps(121.019, 24.0003) })
    const route = buildRoute(loop(), [...shots(), inside])

    expect(route).toEqual(buildRoute(loop(), []))
    expect(placePhotos([inside], route)).toEqual(placePhotos([inside], buildRoute(loop(), [])))
    expect(placePhotos([inside], route)[0]).toMatchObject({ source: 'track' })
  })

  test('photos without time leave the track time alone', () => {
    const route = buildRoute(loop(), [photo({ gps: gps(121.005) })])
    expect(route).toEqual(buildRoute(loop(), []))
  })

  test('GPS placement follows capture time on a loop', () => {
    const photos = shots()
    const route = buildRoute(loop(), photos)
    const at = placePhotos(photos, route).map((p) => (p.source === 'none' ? NaN : p.routeDistanceM))
    const total = route.totalDistanceM

    expect(nearestOnRoute(route, photos[1]!.gps!)!.routeDistanceM).toBeGreaterThan(total / 2)
    expect(nearestOnRoute(route, photos[3]!.gps!)!.routeDistanceM).toBeLessThan(total / 2)

    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(at[0]).toBeLessThan(10)
    expect(at[1]).toBeLessThan(total / 2)
    expect(at[3]).toBeGreaterThan(total / 2)
    expect(at[4]).toBeGreaterThan(total - 10)
  })

  test('a GPS photo without time still goes to the nearest point', () => {
    const photos = [...shots(), photo({ gps: gps(121.005, 24.0002) })]
    const route = buildRoute(loop(), photos)
    const last = placePhotos(photos, route).at(-1)!

    expect(last.source === 'exif' && last.routeDistanceM).toBeCloseTo(nearestOnRoute(route, photos.at(-1)!.gps!)!.routeDistanceM, 6)
  })

  test(`pins snap onto the route within ${SNAP_TO_ROUTE_M} m and keep their own place beyond`, () => {
    const route = buildRoute(loop(), [])
    const [close, far] = placePhotos([photo({ gps: gps(121.01, 23.9988, 5) }), photo({ gps: gps(121.01, 23.9985, 5) })], route)
    const corner = route.points[10]!

    expect(close).toMatchObject({ source: 'exif', lat: 24, ele: 1010, onRoute: true })
    expect(close!.source === 'exif' && close!.lon).toBeCloseTo(121.01, 6)
    expect(far).toEqual({ source: 'exif', lat: 23.9985, lon: 121.01, ele: 5, routeDistanceM: expect.closeTo(corner.distanceM, 3) })
  })
  const along = (route: ReturnType<typeof buildRoute>, photos: Photo[]) => placePhotos(photos, route).map((p) => (p.source === 'none' ? NaN : p.routeDistanceM))
  const reading = (base: ReturnType<typeof buildRoute>, d: number, north = 0) => {
    const s = sampleAtDistance(base, d)!
    return gps(s.lon, s.lat + north)
  }

  const line = () => Array.from({ length: 31 }, (_, i) => tp(121 + i * 0.001, 1000, fake + i * MIN))
  const untimed = (track: TrackPoint[]) => buildRoute(track.map((p) => ({ ...p, time: null })), [])

  test('GPS jitter between two photos a minute apart does not push later photos to the end', () => {
    const base = untimed(line())
    const photos = [1030, 995, 1500, 2000].map((d, i) => photo({ takenAt: day + [0, 1, 20, 40][i]! * MIN, gps: reading(base, d) }))
    const at = along(buildRoute(line(), photos), photos)

    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(at[0]).toBeGreaterThanOrEqual(990)
    expect(at[1]).toBeLessThanOrEqual(1035)
    expect(at[2]).toBeCloseTo(1500, -1)
    expect(at[3]).toBeCloseTo(2000, -1)
  })

  test('a burst of four summit photos with jitter stays where it was taken, on the right leg', () => {
    const base = untimed(loop())
    const truth = [2500, 2510, 2520, 2530]
    const jitter = [20, -25, 25, -15]
    const burst = truth.map((d, k) => photo({ takenAt: day + 3.5 * HOUR + k * MIN, gps: reading(base, d + jitter[k]!, 0.00003) }))
    const photos = [...shots(), ...burst]
    const at = along(buildRoute(loop(), photos), photos).slice(-4)

    for (const [k, d] of at.entries()) expect(Math.abs(d - truth[k]!)).toBeLessThan(60)
  })

  test('photos taken in the same second land the same way whatever the file order', () => {
    const base = untimed(line())
    const a = photo({ fileName: 'a', takenAt: day, gps: reading(base, 2000) })
    const b = photo({ fileName: 'b', takenAt: day, gps: reading(base, 1000) })
    const c = photo({ fileName: 'c', takenAt: day + 10 * MIN, gps: reading(base, 2500) })
    const route = buildRoute(line(), [a, b, c])

    const forward = along(route, [a, b, c])
    const reverse = along(route, [b, a, c])

    expect(forward[0]).toBeCloseTo(2000, 0)
    expect(forward[1]).toBeCloseTo(1000, 0)
    expect([reverse[1], reverse[0], reverse[2]]).toEqual(forward)
  })

  test.each([500, 2000])('%i photos on a 100 km route are placed within a second, each near where it was taken', (count) => {
    const track = Array.from({ length: 10_001 }, (_, i) => tp(121 + i * 0.0001, 1000, fake + i * 1000, 24 + 0.002 * Math.sin(i / 300)))
    const base = untimed(track)
    const truth = Array.from({ length: count }, (_, i) => (i + 0.5) * (base.totalDistanceM / count))
    const photos = truth.map((d, i) => photo({ takenAt: day + i * MIN, gps: reading(base, d, 0.0002) }))
    const route = buildRoute(track, photos)

    const started = performance.now()
    const at = along(route, photos)

    expect(performance.now() - started).toBeLessThan(1000)
    expect(base.totalDistanceM).toBeGreaterThan(100_000)
    expect(Math.max(...at.map((d, i) => Math.abs(d - truth[i]!)))).toBeLessThan(60)
    expect(at).toEqual([...at].sort((a, b) => a - b))
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

  test('on an untimed route 出發 is first and the end is last, even with photos right at them', () => {
    const route = buildRoute(fixture('no-time.gpx'), [])
    const first = route.points[0]!
    const end = route.points.at(-1)!
    const items = buildTimeline(
      route,
      [
        placed(route, { fileName: 'atEnd', takenAt: t0 + 60 * MIN, gps: gps(end.lon, end.lat) }),
        placed(route, { fileName: 'atStart', takenAt: t0, gps: gps(first.lon, first.lat) }),
      ],
      [],
    )

    expect(ids(items)).toEqual(['start', 'atStart', 'atEnd', 'end'])
  })

  test('empty and single-point routes', () => {
    const empty = buildRoute(null, [])
    expect(buildTimeline(empty, [photo({ fileName: 'x' })], [])).toMatchObject([{ kind: 'photo', routeDistanceM: null }])

    expect(ids(buildTimeline(buildRoute([tp(121, 1, t0)], []), [], []))).toEqual(['start'])
  })
})
