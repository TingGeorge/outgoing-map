import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { exifTimeToEpoch, parseGpx } from './index'

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8')

const gpx11 = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`

const pt = (lat: number | string, lon: number | string, inner = '') => `<trkpt lat="${lat}" lon="${lon}">${inner}</trkpt>`

describe('parseGpx', () => {
  test('ported Swift case: waypoints ignored, fractional seconds, missing ele and time', () => {
    const parsed = parseGpx(
      gpx11(`
      <wpt lat="24.1" lon="121.1"><name>ignored</name></wpt>
      <trk><name>雪山</name><trkseg>
        <trkpt lat="24.3833" lon="121.2311"><ele>2140.5</ele><time>2024-10-01T22:00:00Z</time></trkpt>
        <trkpt lat="24.3840" lon="121.2320"><ele>2150</ele><time>2024-10-01T22:01:00.500Z</time></trkpt>
        <trkpt lat="24.3850" lon="121.2330"></trkpt>
      </trkseg></trk>`),
    )

    expect(parsed.name).toBe('雪山')
    expect(parsed.points).toHaveLength(3)
    expect(parsed.points[0]).toEqual({ lat: 24.3833, lon: 121.2311, ele: 2140.5, time: Date.UTC(2024, 9, 1, 22) })
    expect(parsed.points[1]!.time).toBe(1_727_820_060_500)
    expect(parsed.points[2]).toMatchObject({ ele: null, time: null })
  })

  test('GPX 1.0 without namespace, name on the root, time offsets and long fractions', () => {
    const parsed = parseGpx(`<gpx version="1.0"><name>北大武</name><trk><trkseg>
      ${pt(22.6, 120.7, '<time>2024-10-02T06:00:00+08:00</time>')}
      ${pt(22.61, 120.71, '<time>2024-10-01T22:00:01.123456Z</time>')}
      ${pt(22.62, 120.72, '<time>2024-10-01T17:00:02-0500</time>')}
      ${pt(22.63, 120.73, '<time>2024-10-01T22:00:03</time>')}
    </trkseg></trk></gpx>`)

    const t = Date.UTC(2024, 9, 1, 22)
    expect(parsed.name).toBe('北大武')
    expect(parsed.points.map((p) => p.time)).toEqual([t, t + 1123, t + 2000, t + 3000])
  })

  test('metadata name wins over track name', () => {
    expect(parseGpx(gpx11(`<metadata><name> 行程 </name></metadata><trk><name>軌跡</name><trkseg>${pt(1, 2)}</trkseg></trk>`)).name).toBe('行程')
    expect(parseGpx(gpx11(`<trk><trkseg>${pt(1, 2)}</trkseg></trk>`)).name).toBeNull()
  })

  test('joins every trk and trkseg in document order', () => {
    const parsed = parseGpx(
      gpx11(`
      <trk><trkseg>${pt(1, 1)}${pt(1, 2)}</trkseg><trkseg>${pt(1, 3)}</trkseg></trk>
      <trk><trkseg>${pt(1, 4)}</trkseg></trk>`),
    )

    expect(parsed.points.map((p) => p.lon)).toEqual([1, 2, 3, 4])
  })

  test('uses rte points only when there is no track', () => {
    const route = gpx11('<rte><name>計畫</name><rtept lat="24" lon="121"/><rtept lat="24.1" lon="121.1"><ele>10</ele></rtept></rte>')
    expect(parseGpx(route).points).toEqual([
      { lat: 24, lon: 121, ele: null, time: null },
      { lat: 24.1, lon: 121.1, ele: 10, time: null },
    ])
    expect(parseGpx(route).name).toBe('計畫')

    const both = gpx11(`<rte><rtept lat="5" lon="5"/></rte><trk><trkseg>${pt(1, 1)}</trkseg></trk>`)
    expect(parseGpx(both).points.map((p) => p.lat)).toEqual([1])
  })

  test('accepts a UTF-8 BOM and namespace prefixes', () => {
    expect(parseGpx('\uFEFF' + gpx11(`<trk><trkseg>${pt(1, 2)}</trkseg></trk>`)).points).toHaveLength(1)

    const prefixed = '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg><g:trkpt lat="3" lon="4"><g:ele>5</g:ele></g:trkpt></g:trkseg></g:trk></g:gpx>'
    expect(parseGpx(prefixed).points).toEqual([{ lat: 3, lon: 4, ele: 5, time: null }])
  })

  test('drops points with missing or out-of-range coordinates, nulls unreadable ele and time', () => {
    const parsed = parseGpx(
      gpx11(`<trk><trkseg>
        ${pt('abc', 121)}${pt(95, 121)}${pt(24, 181)}${pt('', 121)}<trkpt lat="24"/>
        ${pt(-90, -180, '<ele>n/a</ele><time>yesterday</time>')}
        ${pt(' 24.5 ', '121.5', '<ele></ele><time>2024-02-30T00:00:00Z</time>')}
      </trkseg></trk>`),
    )

    expect(parsed.points).toEqual([
      { lat: -90, lon: -180, ele: null, time: null },
      { lat: 24.5, lon: 121.5, ele: null, time: null },
    ])
  })

  test('keeps file order even when times go backwards', () => {
    const parsed = parseGpx(
      gpx11(`<trk><trkseg>
        ${pt(1, 1, '<time>2024-10-01T10:00:00Z</time>')}
        ${pt(1, 2, '<time>2024-10-01T09:00:00Z</time>')}
      </trkseg></trk>`),
    )

    expect(parsed.points.map((p) => p.lon)).toEqual([1, 2])
    expect(parsed.points[1]!.time).toBeLessThan(parsed.points[0]!.time!)
  })

  test('throws a short Traditional Chinese message on bad input', () => {
    for (const bad of ['not xml <<', '', '<html><body>hi</body></html>', '<gpx><trk>', '{"type":"FeatureCollection"}']) {
      expect(() => parseGpx(bad), bad).toThrow(new Error('這個檔案不是有效的 GPX'))
    }

    for (const empty of [gpx11(''), gpx11('<wpt lat="1" lon="2"/>'), gpx11(`<trk><trkseg>${pt(99, 1)}</trkseg></trk>`)]) {
      expect(() => parseGpx(empty)).toThrow(new Error('GPX 裡沒有任何定位點'))
    }
  })

  test('fixture with times', () => {
    const parsed = parseGpx(fixture('hehuan-north.gpx'))

    expect(parsed.name).toBe('合歡北峰')
    expect(parsed.points).toHaveLength(101)
    expect(parsed.points[0]).toEqual({ lat: 24.1674, lon: 121.28879, ele: 2995, time: Date.UTC(2026, 10, 6, 22, 40) })
    expect(parsed.points[100]).toEqual({ lat: 24.1674, lon: 121.288891, ele: 2994, time: Date.UTC(2026, 10, 7, 3, 40) })
  })

  test('fixture without times', () => {
    const parsed = parseGpx(fixture('no-time.gpx'))

    expect(parsed.points).toHaveLength(101)
    expect(parsed.points.every((p) => p.time === null && p.ele !== null)).toBe(true)
  })
})

describe('exifTimeToEpoch', () => {
  const utc = (h: number, m: number, s: number) => Date.UTC(2026, 10, 7, h, m, s)

  test('defaults to +08:00', () => {
    expect(exifTimeToEpoch('2026:11:07 09:26:31')).toBe(utc(1, 26, 31))
    expect(exifTimeToEpoch('2026:11:07 09:26:31', null)).toBe(utc(1, 26, 31))
  })

  test('uses OffsetTimeOriginal, then an offset inside the string', () => {
    expect(exifTimeToEpoch('2026:11:07 09:25:30', '-05:30')).toBe(utc(14, 55, 30))
    expect(exifTimeToEpoch('2026:11:07 09:25:30', 'Z')).toBe(utc(9, 25, 30))
    expect(exifTimeToEpoch('2026:11:07 09:25:30+09:00')).toBe(utc(0, 25, 30))
    expect(exifTimeToEpoch('2026:11:07 09:25:30+09:00', '+00:00')).toBe(utc(9, 25, 30))
  })

  test('an unreadable offset falls back to the default', () => {
    expect(exifTimeToEpoch('2026:11:07 09:26:31', '   ')).toBe(utc(1, 26, 31))
    expect(exifTimeToEpoch('2026:11:07 09:26:31', '+99:00')).toBe(utc(1, 26, 31))
  })

  test('tolerates trailing NULs, dashes and fractional seconds', () => {
    expect(exifTimeToEpoch('2026:11:07 09:26:31\0')).toBe(utc(1, 26, 31))
    expect(exifTimeToEpoch('2026-11-07 09:26:31.25')).toBe(utc(1, 26, 31) + 250)
  })

  test('returns null for garbage', () => {
    for (const bad of ['0000:00:00 00:00:00', '', '    :  :     :  :  ', 'abc', '2026:02:30 10:00:00', '2026:13:01 10:00:00', '2026:11:07 25:00:00', '2026:11:07']) {
      expect(exifTimeToEpoch(bad), bad).toBeNull()
    }
  })
})
