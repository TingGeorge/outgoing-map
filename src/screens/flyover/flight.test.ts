import { describe, expect, test } from 'vitest'
import { buildRoute } from '../../core'
import { formatKm, formatMetres, formatTime } from '../../ui'
import {
  angleDelta,
  buildTimeline,
  easeAngle,
  hudSteps,
  isNetworkTileError,
  requiredCameraAltitude,
  resamplePath,
  sampleTimeline,
  smoothHeadings,
  timeAtDistance,
  tileTrouble,
  travelSeconds,
} from './flight'

const at = (tl: ReturnType<typeof buildTimeline>, t: number) => sampleTimeline(tl, t, { distanceM: 0, stop: -1 })

describe('timeline', () => {
  test('travel time stays between 40 and 90 seconds', () => {
    expect(travelSeconds(500)).toBe(40)
    expect(travelSeconds(5000)).toBe(60)
    expect(travelSeconds(80_000)).toBe(90)
  })

  test('starts at rest, ends at the end, and is monotonic', () => {
    const tl = buildTimeline(6000, [1000, 3000], { travelS: 60, rampS: 1.5, holdS: 3 })
    expect(tl.duration).toBeCloseTo(60 + 3 * 1.5 + 2 * 3, 5)

    let last = -1
    for (let t = 0; t <= tl.duration; t += 0.05) {
      const d = at(tl, t).distanceM
      expect(d).toBeGreaterThanOrEqual(last - 1e-9)
      last = d
    }

    expect(at(tl, 0).distanceM).toBe(0)
    expect(at(tl, 0.1).distanceM).toBeLessThan(1)
    expect(at(tl, tl.duration).distanceM).toBe(6000)
  })

  test('holds at each stop for the hold time', () => {
    const tl = buildTimeline(6000, [1000, 3000], { travelS: 60, holdS: 3 })
    const [first, second] = tl.stopTimes

    expect(at(tl, first! + 0.01)).toEqual({ distanceM: 1000, stop: 0 })
    expect(at(tl, first! + 2.9)).toEqual({ distanceM: 1000, stop: 0 })
    expect(at(tl, first! + 3.2).stop).toBe(-1)
    expect(at(tl, first! + 3.2).distanceM).toBeGreaterThan(1000)
    expect(at(tl, second! + 1)).toEqual({ distanceM: 3000, stop: 1 })
  })

  test('close stops are shown one after another without a fast lurch', () => {
    const tl = buildTimeline(6000, [2000, 2003, 2003], { travelS: 60 })
    const [a, b, c] = tl.stopTimes

    expect(b! - a!).toBeGreaterThan(3)
    expect(b! - a!).toBeLessThan(5)
    expect(c! - b!).toBeCloseTo(3, 5)

    const peak = Math.max(...Array.from({ length: 20 }, (_, i) => at(tl, a! + 3 + (i + 1) * 0.02).distanceM - at(tl, a! + 3 + i * 0.02).distanceM)) / 0.02
    expect(peak).toBeLessThan(6000 / 60)
  })

  test('seeking maps distance back to time', () => {
    const tl = buildTimeline(6000, [1000, 1000.5, 4000], { travelS: 60 })

    for (const d of [0, 1, 300, 999, 1500, 3999.9, 4000, 5000, 5999, 6000]) {
      expect(at(tl, timeAtDistance(tl, d)).distanceM).toBeCloseTo(d, 3)
    }

    expect(timeAtDistance(tl, 4000)).toBeCloseTo(tl.stopTimes[2]!, 5)
    expect(timeAtDistance(tl, 0)).toBe(0)
  })

  test('works with no stops and with a stop at the very end', () => {
    const plain = buildTimeline(3000, [], { travelS: 40 })
    expect(plain.duration).toBeCloseTo(41.5, 5)
    expect(at(plain, 20).stop).toBe(-1)

    const end = buildTimeline(3000, [3000], { travelS: 40 })
    expect(at(end, end.duration - 1)).toEqual({ distanceM: 3000, stop: 0 })
  })
})

describe('heading', () => {
  test('angle delta takes the short way round', () => {
    expect(angleDelta(350, 10)).toBe(20)
    expect(angleDelta(10, 350)).toBe(-20)
    expect(angleDelta(0, 180)).toBe(-180)
  })

  test('easing turns gradually and never faster than the max rate', () => {
    let h = 0
    for (let i = 0; i < 10; i++) {
      const next = easeAngle(h, 170, 1 / 60, 1, 35)
      expect(next - h).toBeLessThanOrEqual(35 / 60 + 1e-9)
      h = next
    }
    expect(h).toBeGreaterThan(0)
    expect(easeAngle(355, 5, 0.5, 0.1, 1000)).toBeGreaterThan(355)
  })

  test('a zigzag heading north reads as north', () => {
    const x = Array.from({ length: 200 }, (_, i) => (i % 2 ? 4 : -4))
    const y = Array.from({ length: 200 }, (_, i) => i * 3)
    const h = smoothHeadings(x, y, 5, 20)

    for (let i = 10; i < 180; i++) expect(Math.abs(angleDelta(0, h[i]!))).toBeLessThan(8)
  })

  test('a path bends east in the smoothed heading before the corner', () => {
    const x = [...Array.from({ length: 100 }, () => 0), ...Array.from({ length: 100 }, (_, i) => i + 1)]
    const y = [...Array.from({ length: 100 }, (_, i) => i), ...Array.from({ length: 100 }, () => 99)]
    const h = smoothHeadings(x, y, 2, 20)

    expect(h[50]).toBeCloseTo(0, 3)
    expect(h[95]!).toBeGreaterThan(10)
    expect(h[150]).toBeCloseTo(90, 3)
  })
})

describe('path', () => {
  test('resamples a long route to a bounded, evenly spaced path', () => {
    const track = Array.from({ length: 20_000 }, (_, i) => ({ lat: 24 + i * 1e-5, lon: 121, ele: 2000 + i * 0.05, time: i * 1000 }))
    const path = resamplePath(buildRoute(track, []))

    expect(path.count).toBe(3000)
    expect(path.stepM * (path.count - 1)).toBeCloseTo(path.totalM, 6)
    expect(path.ele[0]).toBeCloseTo(2000, 6)
    expect(path.time[path.count - 1]).toBe(19_999_000)
    expect(path.heading[1500]).toBeCloseTo(0, 3)
  })

  test('a route without elevation or time gives NaN for them', () => {
    const path = resamplePath(buildRoute([
      { lat: 24, lon: 121, ele: null, time: null },
      { lat: 24, lon: 121.01, ele: null, time: null },
    ], []))

    expect(Number.isNaN(path.ele[3]!)).toBe(true)
    expect(Number.isNaN(path.time[3]!)).toBe(true)
    expect(path.heading[3]).toBeCloseTo(90, 3)
    expect(path.breaks).toEqual([])
  })

  test('a drive between two sections is cut, not flown, and not counted', () => {
    const walkNorth = Array.from({ length: 101 }, (_, i) => ({ lat: 24 + i * 0.00018, lon: 121, ele: 2000, time: i * 60_000 }))
    const walkEast = Array.from({ length: 101 }, (_, i) => ({ lat: 24.018, lon: 121.2 + i * 0.0002, ele: 2500, time: 7_200_000 + i * 60_000 }))
    const path = resamplePath(buildRoute([...walkNorth, ...walkEast], []))

    expect(path.breaks).toHaveLength(1)
    expect(path.totalM).toBeGreaterThan(3900)
    expect(path.totalM).toBeLessThan(4200)

    const gapM = (i: number) => Math.hypot((path.lon[i]! - path.lon[i - 1]!) * 101_000, (path.lat[i]! - path.lat[i - 1]!) * 111_000)
    const b = path.breaks[0]!
    expect(gapM(b)).toBeGreaterThan(15_000)
    for (let i = 1; i < path.count; i++) if (i !== b) expect(gapM(i)).toBeLessThan(path.stepM * 2)

    expect(path.heading[b - 1]).toBeCloseTo(0, 1)
    expect(path.heading[b]).toBeCloseTo(90, 1)

    const timeline = buildTimeline(path.totalM, [])
    expect(timeline.duration).toBeCloseTo(travelSeconds(path.totalM) + 1.5, 5)
  })

  test('a recorded drive between two walks is one break, not many', () => {
    const at = (northM: number, eastM: number, time: number) => ({ lat: 24 + northM / 111_195, lon: 121 + eastM / 101_580, ele: 2000, time })
    const walk1 = Array.from({ length: 31 }, (_, i) => at(i * 33.3, 0, i * 30_000))
    const drive = Array.from({ length: 19 }, (_, k) => at(1000, (k + 1) * 242, 900_000 + (k + 1) * 30_000))
    const walk2 = Array.from({ length: 31 }, (_, i) => at(1000 - i * 33.3, 4600, 1_500_000 + i * 30_000))
    const path = resamplePath(buildRoute([...walk1, ...drive, ...walk2], []))

    expect(path.breaks).toHaveLength(1)
    expect(path.totalM).toBeCloseTo(2000, -1)

    const gapM = (i: number) => Math.hypot((path.lon[i]! - path.lon[i - 1]!) * 101_580, (path.lat[i]! - path.lat[i - 1]!) * 111_195)
    expect(gapM(path.breaks[0]!)).toBeGreaterThan(4000)
    for (let i = 1; i < path.count; i++) if (i !== path.breaks[0]) expect(gapM(i)).toBeLessThan(path.stepM * 2)
  })
})

describe('camera clearance', () => {
  test('flat ground needs only the clearance above the camera spot', () => {
    expect(requiredCameraAltitude(1000, 1000, [1000, 1000, 1000, 1000], 90, 30)).toBeCloseTo(1150, 6)
  })

  test('a ridge between camera and hiker raises the camera above the line of sight', () => {
    const need = requiredCameraAltitude(1000, 1000, [1000, 1500, 1000, 1000], 90, 30)
    const rayAtRidge = need * 0.6 + 1000 * 0.4

    expect(rayAtRidge).toBeCloseTo(1530, 6)
  })
})

describe('HUD steps', () => {
  const steps = (d: number, ele: number, time: number) => ({ ...hudSteps(d, ele, time, { distanceM: 0, eleM: 0, minute: 0 }) })

  test('the step only changes when the displayed text changes', () => {
    const start = Date.UTC(2026, 10, 7, 22, 40, 0)
    let last = steps(0, 2995, start)
    let changes = 0

    for (let k = 1; k <= 60 * 120; k++) {
      const d = k * 2.1
      const ele = 2995 + k * 0.07
      const time = start + k * 900
      const next = steps(d, ele, time)

      expect(Math.abs(Number(formatKm(next.distanceM)) - d / 1000)).toBeLessThanOrEqual((d < 9950 ? 0.05 : 0.5) + 1e-9)
      expect(formatMetres(next.eleM)).toBe(formatMetres(ele))
      expect(formatTime(next.minute)).toBe(formatTime(time))

      if (next.distanceM !== last.distanceM || next.eleM !== last.eleM || next.minute !== last.minute) changes++
      last = next
    }

    expect(changes).toBeLessThan(1400)
  })

  test('switches to whole kilometres from 10 km and keeps missing values missing', () => {
    expect(formatKm(steps(9_949, NaN, NaN).distanceM)).toBe('9.9')
    expect(formatKm(steps(9_951, NaN, NaN).distanceM)).toBe('10')
    expect(formatKm(steps(23_600, NaN, NaN).distanceM)).toBe('24')
    expect(steps(100, NaN, NaN).eleM).toBeNaN()
    expect(steps(100, NaN, NaN).minute).toBeNaN()
  })
})

describe('tile trouble', () => {
  const mix = (ok: number, bad: number, base = 0) => [
    ...Array.from({ length: ok }, (_, i) => ({ at: base + i, ok: true })),
    ...Array.from({ length: bad }, (_, i) => ({ at: base + i, ok: false })),
  ]

  test('only network-like errors count', () => {
    expect(isNetworkTileError({ name: 'AbortError' })).toBe(false)
    expect(isNetworkTileError({ status: 404 })).toBe(false)
    expect(isNetworkTileError({ status: 503 })).toBe(true)
    expect(isNetworkTileError({ status: 0 })).toBe(true)
    expect(isNetworkTileError(new TypeError('Failed to fetch'))).toBe(true)
  })

  test('needs several failures and a real share, and clears when the window passes', () => {
    expect(tileTrouble(mix(100, 3), 50)).toBe(false)
    expect(tileTrouble(mix(100, 10), 50)).toBe(false)
    expect(tileTrouble(mix(10, 5), 50)).toBe(true)
    expect(tileTrouble(mix(0, 8), 50)).toBe(true)
    expect(tileTrouble(mix(0, 8), 50_000)).toBe(false)
  })
})
