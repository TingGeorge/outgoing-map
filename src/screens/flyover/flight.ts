import { isRouteGap, sampleAtDistance } from '../../core'
import type { Route } from '../../types'

const EARTH_RADIUS_M = 6_371_008.8
const RAD = Math.PI / 180

export interface Path {
  count: number
  stepM: number
  totalM: number
  lon: Float64Array
  lat: Float64Array
  ele: Float64Array
  time: Float64Array
  heading: Float32Array
  breaks: number[]
}

export function resamplePath(route: Route, maxPoints = 3000, headingBackM = 80, headingAheadM = 260): Path {
  const totalM = route.totalDistanceM
  const count = Math.max(2, Math.min(maxPoints, Math.ceil(totalM / 2) + 1))
  const stepM = totalM / (count - 1)

  const lon = new Float64Array(count)
  const lat = new Float64Array(count)
  const ele = new Float64Array(count)
  const time = new Float64Array(count)

  for (let i = 0; i < count; i++) {
    const s = sampleAtDistance(route, i * stepM)!
    lon[i] = s.lon
    lat[i] = s.lat
    ele[i] = s.ele ?? NaN
    time[i] = s.time ?? NaN
  }

  const kx = Math.cos(lat[0]! * RAD)
  const x = new Float64Array(count)
  const y = new Float64Array(count)

  for (let i = 0; i < count; i++) {
    x[i] = (lon[i]! - lon[0]!) * kx * RAD * EARTH_RADIUS_M
    y[i] = (lat[i]! - lat[0]!) * RAD * EARTH_RADIUS_M
  }

  const back = stepM > 0 ? Math.round(headingBackM / stepM) : 0
  const ahead = stepM > 0 ? Math.max(1, Math.round(headingAheadM / stepM)) : 1

  const breaks = gapBreaks(route, stepM, count)
  const heading = new Float32Array(count)
  const starts = [0, ...breaks, count]

  for (let k = 0; k + 1 < starts.length; k++) {
    const a = starts[k]!
    const b = starts[k + 1]!
    heading.set(smoothHeadings(x.subarray(a, b), y.subarray(a, b), back, ahead), a)
  }

  return { count, stepM, totalM, lon, lat, ele, time, heading, breaks }
}

function gapBreaks(route: Route, stepM: number, count: number): number[] {
  const breaks: number[] = []
  const pts = route.points

  for (let i = 1; i < pts.length; i++) {
    if (!isRouteGap(pts[i - 1]!, pts[i]!)) continue

    const j = Math.min(Math.floor(pts[i]!.distanceM / (stepM || 1) + 1e-9) + 1, count - 1)
    if (j > (breaks.at(-1) ?? 0)) breaks.push(j)
  }

  return breaks
}

export function smoothHeadings(x: ArrayLike<number>, y: ArrayLike<number>, back: number, ahead: number): Float32Array {
  const n = x.length
  const sx = new Float64Array(n)
  const sy = new Float64Array(n)

  for (let i = 1; i < n; i++) {
    const dx = x[i]! - x[i - 1]!
    const dy = y[i]! - y[i - 1]!
    const len = Math.hypot(dx, dy) || 1
    sx[i] = sx[i - 1]! + dx / len
    sy[i] = sy[i - 1]! + dy / len
  }

  const out = new Float32Array(n)
  let last = 0

  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - back)
    const b = Math.min(n - 1, i + ahead)
    const vx = sx[b]! - sx[a]!
    const vy = sy[b]! - sy[a]!

    if (Math.hypot(vx, vy) > 0.2) last = Math.atan2(vx, vy) / RAD
    out[i] = last
  }

  return out
}

export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

export function easeAngle(current: number, target: number, dt: number, tau = 1, maxRate = 35): number {
  const delta = angleDelta(current, target)
  const step = delta * (1 - Math.exp(-dt / tau))
  const limit = maxRate * dt

  return current + Math.max(-limit, Math.min(limit, step))
}

export const CLEARANCE_FRACTIONS = [0.2, 0.4, 0.6, 0.8]

export function requiredCameraAltitude(targetAlt: number, groundAtCamera: number, groundAlong: ArrayLike<number>, cameraClearM = 90, rayClearM = 30): number {
  let need = groundAtCamera + cameraClearM

  for (let k = 0; k < CLEARANCE_FRACTIONS.length; k++) {
    const f = CLEARANCE_FRACTIONS[k]!
    need = Math.max(need, (groundAlong[k]! + rayClearM - targetAlt * f) / (1 - f))
  }

  return need
}

export function travelSeconds(totalM: number): number {
  return Math.min(90, Math.max(40, 30 + (totalM / 1000) * 6))
}

interface Segment {
  t0: number
  t1: number
  d0: number
  d1: number
  stop: number
  peak: number
  ramp: number
}

export interface Timeline {
  duration: number
  stopTimes: number[]
  segments: Segment[]
  accel: number
}

export interface TimelineOptions {
  travelS?: number
  rampS?: number
  holdS?: number
}

export function buildTimeline(totalM: number, stopsM: number[], { travelS = travelSeconds(totalM), rampS = 1.5, holdS = 3 }: TimelineOptions = {}): Timeline {
  const cruise = totalM / travelS
  const accel = cruise / rampS
  const segments: Segment[] = []
  const stopTimes: number[] = []
  let t = 0
  let d = 0

  const moveTo = (to: number) => {
    const length = to - d
    if (length <= 0) return

    const peak = length >= cruise * rampS ? cruise : Math.sqrt(accel * length)
    const ramp = peak / accel
    const span = 2 * ramp + (length - peak * ramp) / peak

    segments.push({ t0: t, t1: t + span, d0: d, d1: to, stop: -1, peak, ramp })
    t += span
    d = to
  }

  stopsM.forEach((m, i) => {
    moveTo(Math.min(Math.max(m, d), totalM))
    stopTimes.push(t)
    segments.push({ t0: t, t1: t + holdS, d0: d, d1: d, stop: i, peak: 0, ramp: 0 })
    t += holdS
  })

  moveTo(totalM)

  return { duration: t, stopTimes, segments, accel }
}

export interface TimelineSample {
  distanceM: number
  stop: number
}

function segmentAt(tl: Timeline, t: number): Segment | undefined {
  const segs = tl.segments
  let lo = 0
  let hi = segs.length - 1

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segs[mid]!.t0 <= t) lo = mid
    else hi = mid - 1
  }

  return segs[lo]
}

export function sampleTimeline(tl: Timeline, t: number, out: TimelineSample): TimelineSample {
  const seg = segmentAt(tl, Math.min(Math.max(t, 0), tl.duration))

  if (!seg) {
    out.distanceM = 0
    out.stop = -1
    return out
  }

  out.stop = seg.stop

  if (seg.stop >= 0) {
    out.distanceM = seg.d0
    return out
  }

  const tau = Math.min(Math.max(t - seg.t0, 0), seg.t1 - seg.t0)
  const span = seg.t1 - seg.t0
  const length = seg.d1 - seg.d0
  const a = tl.accel

  let s: number
  if (tau < seg.ramp) s = (a * tau * tau) / 2
  else if (tau < span - seg.ramp) s = (seg.peak * seg.ramp) / 2 + seg.peak * (tau - seg.ramp)
  else s = length - (a * (span - tau) ** 2) / 2

  out.distanceM = seg.d0 + Math.min(Math.max(s, 0), length)
  return out
}

export interface HudSteps {
  distanceM: number
  eleM: number
  minute: number
}

export function hudSteps(distanceM: number, eleM: number, time: number, out: HudSteps): HudSteps {
  out.distanceM = distanceM < 9950 ? Math.round(distanceM / 100) * 100 : Math.round(distanceM / 1000) * 1000
  out.eleM = Number.isNaN(eleM) ? NaN : Math.round(eleM)
  out.minute = Number.isNaN(time) ? NaN : Math.floor(time / 60_000) * 60_000
  return out
}

export function timeAtDistance(tl: Timeline, distanceM: number): number {
  if (distanceM <= 0) return 0

  for (const seg of tl.segments) {
    if (seg.stop >= 0 || distanceM > seg.d1) continue

    const s = Math.max(distanceM - seg.d0, 0)
    const length = seg.d1 - seg.d0
    const ramp = (seg.peak * seg.ramp) / 2
    const a = tl.accel

    if (s < ramp) return seg.t0 + Math.sqrt((2 * s) / a)
    if (s <= length - ramp) return seg.t0 + seg.ramp + (s - ramp) / seg.peak
    return seg.t1 - Math.sqrt((2 * Math.max(length - s, 0)) / a)
  }

  return tl.duration
}

export interface TileEvent {
  at: number
  ok: boolean
}

export const TILE_WINDOW_MS = 20_000

export function isNetworkTileError(error: unknown): boolean {
  const { name, status } = (error ?? {}) as { name?: string; status?: number }
  if (name === 'AbortError') return false

  return typeof status !== 'number' || status === 0 || status >= 500 || status === 408 || status === 429
}

export function tileTrouble(events: TileEvent[], now: number): boolean {
  const recent = events.filter((e) => now - e.at <= TILE_WINDOW_MS)
  const failed = recent.filter((e) => !e.ok).length

  return failed >= 4 && failed * 4 >= recent.length
}
