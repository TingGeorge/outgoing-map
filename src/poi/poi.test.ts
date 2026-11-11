import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildRoute, parseGpx } from '../core'
import type { PoiKind, TrackPoint } from '../types'
import { DEFAULT_POI_RADIUS_M, decodePois } from './index'

const t0 = Date.UTC(2026, 10, 7, 0, 0)
const MIN = 60_000
const M_LON = 1 / (111_320 * Math.cos((24 * Math.PI) / 180))
const M_LAT = 1 / 111_320

const file = (rows: [number, string, number, number, number, number | null][]) => {
  const sorted = [...rows].sort((a, b) => a[3] - b[3])
  const deltas = (xs: number[]) => xs.map((v, i) => (i ? v - xs[i - 1]! : v))

  return {
    kinds: ['peak', 'trailhead'] as PoiKind[],
    id: sorted.map((r) => r[0]),
    name: sorted.map((r) => r[1]),
    kind: sorted.map((r) => r[2]),
    lat: deltas(sorted.map((r) => Math.round(r[3] * 1e5))),
    lon: deltas(sorted.map((r) => Math.round(r[4] * 1e5))),
    ele: sorted.map((r) => r[5]),
  }
}

const serve = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))

const route = (lons: number[], timed = true) =>
  buildRoute(lons.map((lon, i): TrackPoint => ({ lat: 24, lon, ele: null, time: timed ? t0 + i * 10 * MIN : null })), [])

const metres = (m: number) => 121 + m * M_LON

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

const fresh = () => import('./index')

describe('decoding and loading', () => {
  test('decodePois restores coordinates, kinds and nulls', () => {
    const pois = decodePois(file([[7, '甲', 1, 24.12345, 121.54321, null], [3, '乙', 0, 24.1, 121.5, 3422]]))

    expect(pois).toEqual([
      { id: 3, name: '乙', kind: 'peak', lat: 24.1, lon: 121.5, ele: 3422 },
      { id: 7, name: '甲', kind: 'trailhead', lat: 24.12345, lon: 121.54321, ele: null },
    ])
  })

  test('loads once and caches the promise', async () => {
    serve(file([[1, '甲', 0, 24, 121, 100]]))
    const { loadPois } = await fresh()

    expect(await loadPois()).toBe(await loadPois())
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('a failed load rejects in Chinese and is retried', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const { loadPois } = await fresh()

    await expect(loadPois()).rejects.toThrow('無法載入景點資料')

    serve(file([[1, '甲', 0, 24, 121, 100]]))
    expect(await loadPois()).toHaveLength(1)
  })
})

describe('poisAlongRoute', () => {
  const along = async (r: ReturnType<typeof route>, rows: Parameters<typeof file>[0], within?: number) => {
    vi.resetModules()
    serve(file(rows))
    const mod = await fresh()

    return mod.poisAlongRoute(r, within)
  }

  test('default radius is 100 m', () => expect(DEFAULT_POI_RADIUS_M).toBe(100))

  test('orders along the route and reports offset, distance and time', async () => {
    const r = route([121, 121.01, 121.02])
    const hits = await along(r, [
      [1, '後', 0, 24 + 30 * M_LAT, 121.015, null],
      [2, '前', 1, 24, 121.005, null],
    ])

    expect(hits.map((h) => h.poi.name)).toEqual(['前', '後'])
    expect(hits[0]!.offsetM).toBeLessThan(1)
    expect(hits[1]!.offsetM).toBeCloseTo(30, 0)
    expect(hits[0]!.passedAt).toBeCloseTo(t0 + 5 * MIN, -3)
  })

  test('radius boundary', async () => {
    const r = route([121, 121.02])
    const rows: Parameters<typeof file>[0] = [
      [1, '內', 0, 24 + 99 * M_LAT, 121.01, null],
      [2, '外', 0, 24 + 101 * M_LAT, 121.01, null],
    ]

    expect((await along(r, rows)).map((h) => h.poi.name)).toEqual(['內'])
    expect((await along(r, rows, 200)).map((h) => h.poi.name).sort()).toEqual(['內', '外'])
  })

  test('out-and-back lists a turnaround summit once, at the turnaround', async () => {
    const r = route([121, 121.01, 121.02, 121.01, 121])
    const hits = await along(r, [[1, '頂', 0, 24, 121.02, 3000]])

    expect(hits).toHaveLength(1)
    expect(hits[0]!.routeDistanceM).toBeCloseTo(r.points[2]!.distanceM, 0)
    expect(hits[0]!.passedAt).toBe(t0 + 20 * MIN)
  })

  test('out-and-back lists a mid-trail POI at its first pass', async () => {
    const r = route([121, 121.01, 121.02, 121.01, 121])
    const hits = await along(r, [[1, '中', 0, 24, 121.01, null]])

    expect(hits).toHaveLength(1)
    expect(hits[0]!.passedAt).toBe(t0 + 10 * MIN)
  })

  test('a trailhead at both ends is reported once, at the start', async () => {
    const r = route([121, 121.01, 121.02, 121.01, 121])
    const hits = await along(r, [[1, '登山口', 1, 24, 121, null]])

    expect(hits).toHaveLength(1)
    expect(hits[0]!.routeDistanceM).toBe(0)
  })

  test('same name within 50 m is one POI, the closer one; farther apart stays two', async () => {
    const r = route([121, 121.02])
    const near = await along(r, [
      [1, '山', 0, 24 + 40 * M_LAT, 121.01, null],
      [2, '山', 0, 24 + 10 * M_LAT, metres(1000) + 20 * M_LON, null],
    ])

    expect(near.map((h) => h.poi.id)).toEqual([2])

    const apart = await along(r, [
      [1, '山', 0, 24 + 40 * M_LAT, 121.005, null],
      [2, '山', 0, 24 + 10 * M_LAT, 121.015, null],
    ])

    expect(apart).toHaveLength(2)
  })

  test('route without times gives passedAt null; empty and single-point routes give []', async () => {
    const hits = await along(route([121, 121.02], false), [[1, '甲', 0, 24, 121.01, null]])

    expect(hits[0]!.passedAt).toBeNull()
    expect(await along(route([]), [[1, '甲', 0, 24, 121, null]])).toEqual([])
    expect(await along(route([121]), [[1, '甲', 0, 24, 121, null]])).toEqual([])
  })

  test('a sparse segment passing a POI with no vertex nearby still matches', async () => {
    const hits = await along(route([121, 121.1]), [[1, '甲', 0, 24 + 20 * M_LAT, 121.05, null]])

    expect(hits).toHaveLength(1)
  })
})

describe('real data', () => {
  const real = JSON.parse(readFileSync('public/poi.json', 'utf8'))
  const hehuan = () => buildRoute(parseGpx(readFileSync('tests/fixtures/hehuan-north.gpx', 'utf8')).points, [])

  test('Hehuan North fixture finds the summit near the turnaround and a trailhead near the start', async () => {
    serve(real)
    const { poisAlongRoute } = await fresh()
    const r = hehuan()
    const hits = await poisAlongRoute(r)
    const summit = hits.find((h) => /合歡(山)?北峰/.test(h.poi.name) && h.poi.kind === 'peak')

    expect(summit).toBeDefined()
    expect(Math.abs(summit!.poi.ele! - 3422)).toBeLessThan(10)
    expect(Math.abs(summit!.routeDistanceM - r.totalDistanceM / 2)).toBeLessThan(r.totalDistanceM * 0.1)

    const wide = await poisAlongRoute(r, 250)

    expect(wide.some((h) => h.poi.kind === 'trailhead' && h.poi.name.includes('登山口') && h.routeDistanceM === 0)).toBe(true)
  })

  test('20,000-point route against the full dataset is fast', async () => {
    serve(real)
    const { poisAlongRoute } = await fresh()
    const track: TrackPoint[] = Array.from({ length: 20_000 }, (_, i) => {
      const k = i / 20_000

      return { lat: 23.5 + k + 0.05 * Math.sin(k * 80), lon: 120.8 + 0.7 * k + 0.05 * Math.cos(k * 60), ele: null, time: t0 + i * 1000 }
    })

    await poisAlongRoute(buildRoute(track.slice(0, 2), []))
    const start = performance.now()
    const hits = await poisAlongRoute(buildRoute(track, []))
    const ms = performance.now() - start

    console.log(`20000 points: ${hits.length} pois in ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(1000)
  })
})
