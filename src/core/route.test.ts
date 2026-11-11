import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Photo, TrackPoint } from '../types'
import {
  ELEVATION_HYSTERESIS_M,
  buildRoute,
  distanceM,
  elevationProfile,
  isRouteGap,
  nearestOnRoute,
  parseGpx,
  routeStats,
  sampleAtDistance,
  sampleAtTime,
} from './index'

const t0 = 1_700_000_000_000
const MIN = 60_000

const fixture = (name: string) => parseGpx(readFileSync(`tests/fixtures/${name}`, 'utf8')).points

const tp = (lon: number, ele: number | null = null, time: number | null = null, lat = 24): TrackPoint => ({ lat, lon, ele, time })

const straight = () => buildRoute([tp(121.0, 1000, t0), tp(121.01, 1100, t0 + 30 * MIN), tp(121.02, 1200, t0 + 60 * MIN)], [])

const eles = (values: (number | null)[]) => buildRoute(values.map((e, i) => tp(121 + i * 0.0001, e)), [])

const photo =(over: Partial<Photo>): Photo => ({
  id: 'p',
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

describe('distanceM', () => {
  test('known distances', () => {
    expect(distanceM({ lat: 24, lon: 121 }, { lat: 24, lon: 121 })).toBe(0)
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo((6_371_008.8 * Math.PI) / 180, 6)

    const d = distanceM({ lat: 25.034, lon: 121.5645 }, { lat: 25.0478, lon: 121.517 })
    expect(Math.abs(d - 5000) / 5000).toBeLessThan(0.03)
  })
})

describe('buildRoute', () => {
  test('a track becomes a gpx route with cumulative distances', () => {
    const route = straight()

    expect(route.source).toBe('gpx')
    expect(route.points.map((p) => p.distanceM)).toEqual([0, route.points[1]!.distanceM, route.totalDistanceM])
    expect(route.points[1]!.distanceM).toBeCloseTo(distanceM(tp(121), tp(121.01)), 9)
    expect(Math.abs(route.totalDistanceM - 2034)).toBeLessThan(20)
    expect([route.startAt, route.endAt]).toEqual([t0, t0 + 60 * MIN])
  })

  test('the track wins over photos', () => {
    const route = buildRoute([tp(121)], [photo({ takenAt: t0, gps: { lat: 1, lon: 1, ele: null, heading: null } })])
    expect(route.source).toBe('gpx')
    expect(route.points).toHaveLength(1)
  })

  test('without a track, photos with GPS and time are joined in time order', () => {
    const gps = (lon: number, ele: number | null = null) => ({ lat: 24, lon, ele, heading: null })
    const photos = [
      photo({ takenAt: t0 + 20 * MIN, gps: gps(121.02) }),
      photo({ takenAt: t0, gps: gps(121.0) }),
      photo({ takenAt: t0 + 10 * MIN, gps: gps(121.01, 1234) }),
      photo({ gps: gps(122) }),
      photo({ takenAt: t0 + 5 * MIN }),
    ]

    for (const track of [null, []]) {
      const route = buildRoute(track, photos)
      expect(route.source).toBe('photos')
      expect(route.points.map((p) => p.lon)).toEqual([121.0, 121.01, 121.02])
      expect(route.points[1]!.ele).toBe(1234)
      expect([route.startAt, route.endAt]).toEqual([t0, t0 + 20 * MIN])
      expect(route.totalDistanceM).toBeGreaterThan(2000)
    }
  })

  test('fewer than two usable points gives a valid short route', () => {
    expect(buildRoute(null, [])).toEqual({ source: 'photos', points: [], totalDistanceM: 0, startAt: null, endAt: null })

    const one = buildRoute(null, [photo({ takenAt: t0, gps: { lat: 24, lon: 121, ele: null, heading: null } })])
    expect(one.points).toEqual([{ lat: 24, lon: 121, ele: null, time: t0, distanceM: 0 }])
    expect(one.totalDistanceM).toBe(0)
  })

  test('out-of-order times with some points untimed: file order is kept, the longest in-order run keeps its times', () => {
    const backward = buildRoute([tp(121, null, t0), tp(121.001, null, t0 + MIN), tp(121.002, null, t0 - 99 * MIN), tp(121.0025, null, null), tp(121.003, null, t0 + 3 * MIN)], [])
    expect(backward.points.map((p) => p.time)).toEqual([t0, t0 + MIN, null, null, t0 + 3 * MIN])
    expect(backward.points.map((p) => p.lon)).toEqual([121, 121.001, 121.002, 121.0025, 121.003])

    const forward = buildRoute([tp(121, null, t0), tp(121.001, null, t0 + 999 * MIN), tp(121.002, null, null), tp(121.003, null, t0 + 2 * MIN), tp(121.004, null, t0 + 3 * MIN)], [])
    expect(forward.points.map((p) => p.time)).toEqual([t0, null, null, t0 + 2 * MIN, t0 + 3 * MIN])
    expect([forward.startAt, forward.endAt]).toEqual([t0, t0 + 3 * MIN])

    const equal = buildRoute([tp(121, null, t0), tp(121.001, null, t0)], [])
    expect(equal.points.map((p) => p.time)).toEqual([t0, t0])
  })

  test('when every point has a time, a shuffled track is put back in time order (stable)', () => {
    const walk = [0, 1, 2, 3, 4, 5].map((i) => tp(121 + i * 0.001, 1000 + i * 10, t0 + i * MIN))
    const shuffled = [walk[3]!, walk[0]!, walk[5]!, walk[1]!, walk[4]!, walk[2]!]

    const ordered = buildRoute(shuffled, [])
    expect(ordered.points.map((p) => p.lon)).toEqual(walk.map((p) => p.lon))
    expect(ordered.totalDistanceM).toBeCloseTo(buildRoute(walk, []).totalDistanceM, 6)
    expect(routeStats(ordered).ascentM).toBe(50)
    expect(shuffled[0]).toBe(walk[3])

    const ties = buildRoute([tp(121.002, null, t0 + MIN), tp(121.001, null, t0), tp(121.003, null, t0)], [])
    expect(ties.points.map((p) => p.lon)).toEqual([121.001, 121.003, 121.002])
  })

  test('a jump that is both far and too fast to walk is a gap: no distance, no climb', () => {
    const first = [0, 1, 2, 3].map((i) => tp(121 + i * 0.001, 2000 + i * 10, t0 + i * MIN))
    const jumpLon = 121.003 + 5000 / distanceM({ lat: 24, lon: 121 }, { lat: 24, lon: 122 })
    const second = [0, 1, 2, 3].map((i) => tp(jumpLon + i * 0.001, 2400 + i * 10, t0 + (13 + i) * MIN))
    const joined = buildRoute([...first, ...second], [])

    const walked = buildRoute(first, []).totalDistanceM * 2
    expect(distanceM(first[3]!, second[0]!)).toBeCloseTo(5000, -1)
    expect(joined.totalDistanceM).toBeCloseTo(walked, 6)
    expect(joined.points[4]!.distanceM).toBe(joined.points[3]!.distanceM)
    expect(routeStats(joined)).toMatchObject({ ascentM: 60, descentM: 0, durationMs: 16 * MIN, maxEleM: 2430 })
    expect(sampleAtDistance(joined, joined.points[3]!.distanceM)).toMatchObject({ lat: 24 })

    const untimed = buildRoute([...first, ...second].map((p) => ({ ...p, time: null })), [])
    expect(untimed.totalDistanceM).toBeGreaterThan(5000)

    const slow = buildRoute([...first, ...second.map((p) => ({ ...p, time: p.time! + 60 * MIN }))], [])
    expect(slow.totalDistanceM).toBeGreaterThan(5000)
  })

  test('a pause and resume 20 m away measures exactly as one walk', () => {
    const before = [0, 1, 2].map((i) => tp(121 + i * 0.001, 2000 + i * 10, t0 + i * MIN))
    const resumeLon = 121.002 + 20 / distanceM({ lat: 24, lon: 121 }, { lat: 24, lon: 122 })
    const after = [0, 1, 2].map((i) => tp(resumeLon + i * 0.001, 2030 + i * 10, t0 + (62 + i) * MIN))
    const route = buildRoute([...before, ...after], [])

    let expected = 0
    const all = [...before, ...after]
    for (let i = 1; i < all.length; i++) expected += distanceM(all[i - 1]!, all[i]!)

    expect(route.totalDistanceM).toBeCloseTo(expected, 9)
    expect(routeStats(route)).toMatchObject({ ascentM: 50, durationMs: 64 * MIN })
  })

  const at = (northM: number, eastM: number, ele: number, time: number): TrackPoint => ({
    lat: 24 + northM / 111_195,
    lon: 121 + eastM / (111_195 * Math.cos(24 * (Math.PI / 180))),
    ele,
    time,
  })

  const walked = (points: TrackPoint[]) => points.slice(1).reduce((sum, p, i) => sum + distanceM(points[i]!, p), 0)
  const gapCount = (points: TrackPoint[]) => points.slice(1).filter((p, i) => isRouteGap(points[i]!, p)).length

  test('a drive the GPS app kept recording is a gap: only the two walks count', () => {
    const walk1 = Array.from({ length: 31 }, (_, i) => at(i * 33.3, 0, 2000 + i * 2, t0 + i * 30_000))
    const end = walk1.at(-1)!
    const drive = Array.from({ length: 18 }, (_, k) => at(1000, (k + 1) * 250, 2000 - k * 25, end.time! + (k + 1) * 30_000))
    const park = drive.at(-1)!.time! + 12_000
    const walk2 = Array.from({ length: 31 }, (_, i) => at(1000 - i * 33.3, 4600, 1500 + i * 2, park + i * 30_000))
    const route = buildRoute([...walk1, ...drive, ...walk2], [])

    expect(walked([...walk1, ...drive, ...walk2])).toBeGreaterThan(6500)
    expect(route.totalDistanceM).toBeCloseTo(walked(walk1) + walked(walk2), 6)
    expect(gapCount(route.points)).toBe(1)
    expect(routeStats(route)).toMatchObject({ ascentM: 120, descentM: 0 })
  })

  test('a short sprint and a long downhill jog stay counted', () => {
    const walk = Array.from({ length: 11 }, (_, i) => at(i * 33.3, 0, 2000, t0 + i * 30_000))
    const sprint = Array.from({ length: 12 }, (_, i) => at(333 + (i + 1) * 25, 0, 2000, walk.at(-1)!.time! + (i + 1) * 6000))
    const after = Array.from({ length: 11 }, (_, i) => at(633 + (i + 1) * 33.3, 0, 2000, sprint.at(-1)!.time! + (i + 1) * 30_000))
    const sprinted = [...walk, ...sprint, ...after]

    expect(buildRoute(sprinted, []).totalDistanceM).toBeCloseTo(walked(sprinted), 6)
    expect(gapCount(buildRoute(sprinted, []).points)).toBe(0)

    const jog = Array.from({ length: 41 }, (_, i) => at(i * 75, 0, 2500 - i * 10, t0 + i * 30_000))
    expect(buildRoute(jog, []).totalDistanceM).toBeCloseTo(3000, -1)
    expect(routeStats(buildRoute(jog, []))).toMatchObject({ descentM: 400 })
  })
})

describe('routeStats', () => {
  test('ported Swift hysteresis cases', () => {
    expect(routeStats(eles([100, 103, 101, 104, 102])).ascentM).toBe(0)
    expect(routeStats(eles(Array.from({ length: 101 }, (_, i) => 100 + i))).ascentM).toBe(100)
    expect(routeStats(eles([100, 110, 100, 110]))).toMatchObject({ ascentM: 20, descentM: 10 })
  })

  test('once a climb is confirmed every metre counts, jitter inside it does not', () => {
    expect(ELEVATION_HYSTERESIS_M).toBe(5)
    expect(routeStats(eles([100, 106, 108, 104])).ascentM).toBe(8)
    expect(routeStats(eles([100, 106, 104, 108, 106, 110]))).toMatchObject({ ascentM: 10, descentM: 0 })
    expect(routeStats(eles([200, 190, 192, 185]))).toMatchObject({ ascentM: 0, descentM: 15 })
  })

  test('points without elevation are skipped', () => {
    expect(routeStats(eles([100, null, 110, null, null, 100]))).toMatchObject({ ascentM: 10, descentM: 10, maxEleM: 110, minEleM: 100 })
    expect(routeStats(eles([null, null]))).toMatchObject({ ascentM: 0, descentM: 0, maxEleM: null, minEleM: null })
  })

  test('empty and untimed routes', () => {
    expect(routeStats(buildRoute(null, []))).toEqual({ distanceM: 0, ascentM: 0, descentM: 0, durationMs: null, maxEleM: null, minEleM: null })
    expect(routeStats(eles([1, 2])).durationMs).toBeNull()
  })

  test('fixture numbers match an independent calculation', () => {
    const stats = routeStats(buildRoute(fixture('hehuan-north.gpx'), []))

    expect(stats.distanceM).toBeCloseTo(3680.578, 2)
    expect(stats.ascentM).toBeCloseTo(3424 - 2995, 6)
    expect(stats.descentM).toBeCloseTo(3424 - 2994, 6)
    expect(stats.durationMs).toBe(5 * 60 * MIN)
    expect([stats.minEleM, stats.maxEleM]).toEqual([2994, 3424])

    const untimed = routeStats(buildRoute(fixture('no-time.gpx'), []))
    expect(untimed).toEqual({ ...stats, durationMs: null })
  })
})

describe('sampleAtDistance', () => {
  test('interpolates position, elevation and time', () => {
    const route = straight()
    const mid = sampleAtDistance(route, route.totalDistanceM / 2)!

    expect(mid.lon).toBeCloseTo(121.01, 6)
    expect(mid.ele).toBeCloseTo(1100, 6)
    expect(mid.time).toBe(t0 + 30 * MIN)
  })

  test('clamps to the ends', () => {
    const route = straight()

    expect(sampleAtDistance(route, -5)).toMatchObject({ lon: 121, distanceM: 0, time: t0 })
    expect(sampleAtDistance(route, 1e9)).toMatchObject({ lon: 121.02, distanceM: route.totalDistanceM, time: t0 + 60 * MIN })
  })

  test('empty, single point and missing values', () => {
    expect(sampleAtDistance(buildRoute(null, []), 0)).toBeNull()
    expect(sampleAtDistance(buildRoute([tp(121, 5, t0)], []), 10)).toEqual({ lat: 24, lon: 121, ele: 5, time: t0, distanceM: 0 })

    const gappy = buildRoute([tp(121.0, null, t0), tp(121.01, 1000, null), tp(121.02, 1200, t0 + 60 * MIN)], [])
    const s = sampleAtDistance(gappy, gappy.totalDistanceM / 4)!
    expect(s.ele).toBe(1000)
    expect(Math.abs(s.time! - (t0 + 15 * MIN))).toBeLessThan(1000)
  })
})

describe('sampleAtTime', () => {
  test('interpolates between track points', () => {
    const route = straight()
    const s = sampleAtTime(route, t0 + 15 * MIN)!

    expect(s.lon).toBeCloseTo(121.005, 6)
    expect(s.ele).toBeCloseTo(1050, 6)
    expect(s.distanceM).toBeCloseTo(route.totalDistanceM / 4, 3)
    expect(s.time).toBe(t0 + 15 * MIN)
  })

  test('clamps within the tolerance, null beyond it', () => {
    const route = straight()

    expect(sampleAtTime(route, t0 - 29 * MIN)).toMatchObject({ lon: 121, distanceM: 0, time: t0 })
    expect(sampleAtTime(route, t0 + 80 * MIN)).toMatchObject({ lon: 121.02, distanceM: route.totalDistanceM, time: t0 + 60 * MIN })
    expect(sampleAtTime(route, t0 + 90 * MIN)).not.toBeNull()
    expect(sampleAtTime(route, t0 + 90 * MIN + 1)).toBeNull()
    expect(sampleAtTime(route, t0 - 31 * MIN)).toBeNull()
  })

  test('null without times', () => {
    expect(sampleAtTime(buildRoute(fixture('no-time.gpx'), []), t0)).toBeNull()
    expect(sampleAtTime(buildRoute(null, []), t0)).toBeNull()
  })

  test('follows the geometry through untimed points', () => {
    const route = buildRoute([tp(121, null, t0, 24), tp(121.01, null, null, 24), tp(121.01, null, t0 + 60 * MIN, 24 + 0.01 * Math.cos((24 * Math.PI) / 180))], [])
    const s = sampleAtTime(route, t0 + 30 * MIN)!

    expect(s.distanceM).toBeCloseTo(route.totalDistanceM / 2, 3)
    expect(distanceM(s, route.points[1]!)).toBeLessThan(10)
  })

  test('a stop keeps the position while time runs', () => {
    const route = buildRoute([tp(121, null, t0), tp(121.01, null, t0 + 10 * MIN), tp(121.01, null, t0 + 50 * MIN), tp(121.02, null, t0 + 60 * MIN)], [])
    expect(sampleAtTime(route, t0 + 30 * MIN)!.lon).toBeCloseTo(121.01, 9)
  })
})

describe('nearestOnRoute', () => {
  test('projects onto the segment, not the nearest vertex', () => {
    const route = straight()
    const near = nearestOnRoute(route, { lat: 24.001, lon: 121.005 })!

    expect(near.routeDistanceM / route.totalDistanceM).toBeCloseTo(0.25, 3)
    expect(Math.abs(near.offsetM - 111)).toBeLessThan(2)
  })

  test('ends, empty and single point', () => {
    const route = straight()

    expect(nearestOnRoute(route, { lat: 24, lon: 120.9 })!.routeDistanceM).toBe(0)
    expect(nearestOnRoute(route, { lat: 24, lon: 121.5 })!.routeDistanceM).toBeCloseTo(route.totalDistanceM, 6)
    expect(nearestOnRoute(buildRoute(null, []), { lat: 24, lon: 121 })).toBeNull()
    expect(nearestOnRoute(buildRoute([tp(121)], []), { lat: 24.001, lon: 121 })!.offsetM).toBeCloseTo(111.2, 0)
  })

  test('the fixture summit is found where the track tops out', () => {
    const route = buildRoute(fixture('hehuan-north.gpx'), [])
    const summit = route.points[58]!

    const near = nearestOnRoute(route, summit)!
    expect(near.offsetM).toBeLessThan(0.01)
    expect(near.routeDistanceM).toBeCloseTo(summit.distanceM, 3)
  })
})

describe('elevationProfile', () => {
  test('short routes keep their own points', () => {
    const route = buildRoute(fixture('hehuan-north.gpx'), [])
    const profile = elevationProfile(route)!

    expect(profile.samples).toHaveLength(101)
    expect(profile).toMatchObject({ totalDistanceM: route.totalDistanceM, minEleM: 2994, maxEleM: 3424 })
  })

  test('downsamples evenly by distance', () => {
    const route = buildRoute(fixture('hehuan-north.gpx'), [])
    const profile = elevationProfile(route, 20)!
    const step = route.totalDistanceM / 19

    expect(profile.samples).toHaveLength(20)
    profile.samples.forEach((s, i) => expect(s.distanceM).toBeCloseTo(i * step, 6))
    expect(profile.samples[0]!.ele).toBe(2995)
    expect(profile.samples[19]!.ele).toBe(2994)
    expect(profile.maxEleM).toBe(3424)
  })

  test('null without elevation, partial elevation is interpolated', () => {
    expect(elevationProfile(eles([null, null]))).toBeNull()
    expect(elevationProfile(buildRoute(null, []))).toBeNull()

    const partial = eles([100, null, null, null, 200])
    expect(elevationProfile(partial)!.samples.map((s) => s.ele)).toEqual([100, 200])

    const sampled = elevationProfile(eles([100, null, 200, null, 300]), 3)!
    expect(sampled.samples.map((s) => Math.round(s.ele))).toEqual([100, 200, 300])
  })
})

describe('scale', () => {
  test('20k points stay fast', () => {
    const track = Array.from({ length: 20_000 }, (_, i) => tp(121 + i * 0.0001, 2000 + 50 * Math.sin(i / 300), t0 + i * 10_000, 24 + 0.001 * Math.sin(i / 50)))
    const started = performance.now()

    const route = buildRoute(track, [])
    routeStats(route)
    elevationProfile(route)
    for (let i = 0; i < 2000; i++) sampleAtTime(route, t0 + i * 100_000)
    for (let i = 0; i < 200; i++) nearestOnRoute(route, { lat: 24.01, lon: 121 + i * 0.01 })

    expect(performance.now() - started).toBeLessThan(2000)
    expect(elevationProfile(route)!.samples).toHaveLength(200)
  })
})
