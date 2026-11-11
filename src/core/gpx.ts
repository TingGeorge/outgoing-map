import { DEFAULT_PHOTO_UTC_OFFSET } from '../types'
import type { EpochMs, ParsedGpx, TrackPoint } from '../types'

const INVALID_GPX = '這個檔案不是有效的 GPX'
const NO_POINTS = 'GPX 裡沒有任何定位點'

export function parseGpx(xml: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')
  const root = doc.documentElement

  if (!root || root.localName !== 'gpx' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(INVALID_GPX)
  }

  const track: Element[] = []
  const route: Element[] = []

  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if (el.localName === 'trkpt') track.push(el)
    else if (el.localName === 'rtept') route.push(el)
  }

  const points = (track.length > 0 ? track : route).map(toPoint).filter((p) => p !== null)
  if (points.length === 0) throw new Error(NO_POINTS)

  const name = [root, child(root, 'metadata'), first(root, 'trk'), first(root, 'rte')]
    .map((el) => el && child(el, 'name')?.textContent?.trim())
    .find((n) => n)

  return { name: name ?? null, points }
}

function toPoint(el: Element): TrackPoint | null {
  const lat = coordinate(el.getAttribute('lat'))
  const lon = coordinate(el.getAttribute('lon'))

  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null

  const eleText = child(el, 'ele')?.textContent?.trim()
  const ele = eleText ? Number(eleText) : NaN
  const timeText = child(el, 'time')?.textContent?.trim()

  return {
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null,
    time: timeText ? isoTimeToEpoch(timeText) : null,
  }
}

function coordinate(text: string | null): number | null {
  const value = text?.trim() ? Number(text) : NaN
  return Number.isFinite(value) ? value : null
}

function child(el: Element, name: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === name)
}

function first(root: Element, name: string): Element | undefined {
  return Array.from(root.getElementsByTagName('*')).find((c) => c.localName === name)
}

const DATE_TIME = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i

function isoTimeToEpoch(text: string): EpochMs | null {
  const m = DATE_TIME.exec(text)
  return m ? toEpoch(m, offsetMinutes(m[8] ?? 'Z')) : null
}

export function exifTimeToEpoch(dateTimeOriginal: string, offsetTimeOriginal?: string | null): EpochMs | null {
  const m = DATE_TIME.exec(dateTimeOriginal.replace(/\0/g, '').trim())
  if (!m) return null

  const offset =
    offsetMinutes(offsetTimeOriginal?.replace(/\0/g, '').trim()) ??
    offsetMinutes(m[8]) ??
    offsetMinutes(DEFAULT_PHOTO_UTC_OFFSET)!

  return toEpoch(m, offset)
}

function offsetMinutes(text: string | null | undefined): number | null {
  if (!text) return null
  if (/^z$/i.test(text)) return 0

  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(text)
  if (!m) return null

  const hours = Number(m[2])
  const minutes = Number(m[3])
  if (hours > 14 || minutes > 59) return null

  return (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes)
}

function toEpoch(m: RegExpExecArray, offset: number | null): EpochMs | null {
  if (offset === null) return null

  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number]
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return null

  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  if (date.getUTCDate() !== d) return null

  const fraction = m[7] ? Math.round(Number(m[7]) * 1000) : 0
  return date.getTime() + fraction - offset * 60_000
}
