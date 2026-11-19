import { INTRO_MS, OUTRO_MS, type CaptureView, type Flight } from './engine'

export interface VideoFormat {
  mime: string
  type: string
  ext: 'mp4' | 'webm'
}

const CANDIDATES: [string, VideoFormat['ext']][] = [
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
]

export function videoFormat(): VideoFormat | null {
  try {
    if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null

    for (const [mime, ext] of CANDIDATES) {
      if (MediaRecorder.isTypeSupported(mime)) return { mime, type: mime.split(';')[0]!, ext }
    }
  } catch {}

  return null
}

export const FPS = 30
const MAX_LONG = 1920
const MAX_SHORT = 1080

export function videoSize(width: number, height: number, maxLong = MAX_LONG, maxShort = MAX_SHORT): { width: number; height: number } {
  const w = Math.max(width, 2)
  const h = Math.max(height, 2)
  const long = Math.max(w, h)
  const short = Math.min(w, h)
  const k = Math.min(1, maxLong / long, maxShort / short)
  const even = (n: number) => Math.max(2, Math.floor((n * k) / 2) * 2)

  return { width: even(w), height: even(h) }
}

export function videoBitrate(width: number, height: number): number {
  return Math.round(Math.min(6_000_000, Math.max(2_500_000, width * height * FPS * 0.08)))
}

const fileDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })

export function videoFileName(title: string, at: number, ext: VideoFormat['ext']): string {
  const name = title.length > 80 ? title.slice(0, 80) : title
  return `${name}-${fileDate.format(at)}-立體播放.${ext}`.replace(/[/\\:*?"<>|]/g, '-')
}

export const INTRO_S = INTRO_MS / 1000
export const OUTRO_S = OUTRO_MS / 1000

export function videoSeconds(flightSeconds: number, speed: number): number {
  return Math.round(INTRO_S + flightSeconds / speed + OUTRO_S)
}

export interface VideoStop {
  caption: string
  meta?: string
  url: () => Promise<string | undefined>
}

export interface VideoOverlay {
  title: string
  subtitle: string
  stops: VideoStop[]
  attribution: string[]
  status: (info: CaptureView['info']) => string
}

export interface VideoHooks {
  progress(fraction: number, seconds: number): void
  done(blob: Blob): void
  fail(): void
}

export interface VideoRecording {
  cancel(): void
}

const COLOR = {
  card: 'rgba(251, 251, 244, 0.94)',
  ink: '#24352C',
  muted: '#4E5F53',
  accent: '#B84A22',
  white: '#FFFFFF',
  paper: '#FFFDF7',
  ground: '#E9E6D6',
}

const POP_IN_MS = 320
const POP_OUT_MS = 200
const HOLD_END_MS = 700

interface Pic {
  img: HTMLImageElement | null
  failed: boolean
}

export function recordFlight(flight: Flight, format: VideoFormat, overlay: VideoOverlay, hooks: VideoHooks): VideoRecording {
  const out = document.createElement('canvas')
  const ctx = out.getContext('2d', { alpha: false })!
  const chunks: Blob[] = []
  const pics = new Map<number, Pic>()
  const style = getComputedStyle(document.documentElement)
  const hand = style.getPropertyValue('--font-hand').trim() || 'serif'
  const body = style.getPropertyValue('--font-body').trim() || 'sans-serif'

  let recorder: MediaRecorder | null = null
  let sized = false
  let finished = false
  let delivering = false
  let settledAt = 0
  let started = 0
  let current = -1
  let leaving = -1
  let changedAt = 0
  let lastProgress = -1
  let lastSecond = -1

  const end = () => {
    finished = true
    flight.capture(null)
    pics.forEach((p) => p.img && URL.revokeObjectURL(p.img.src))
    pics.clear()
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    } catch {}
  }

  const fail = () => {
    if (finished && !delivering) return
    delivering = false
    end()
    hooks.fail()
  }

  const load = (i: number) => {
    if (i < 0 || i >= overlay.stops.length || pics.has(i)) return

    const pic: Pic = { img: null, failed: false }
    pics.set(i, pic)

    void overlay.stops[i]!.url().then(
      (url) => {
        if (!url) return void (pic.failed = true)
        const img = new Image()
        img.onload = () => {
          if (finished) URL.revokeObjectURL(url)
          else pic.img = img
        }
        img.onerror = () => {
          pic.failed = true
          URL.revokeObjectURL(url)
        }
        img.src = url
      },
      () => (pic.failed = true),
    )
  }

  const evict = (keepFrom: number) => {
    for (const [i, p] of pics) {
      if (i >= keepFrom - 1) continue
      if (p.img) URL.revokeObjectURL(p.img.src)
      pics.delete(i)
    }
  }

  const start = (w: number, h: number) => {
    out.width = w
    out.height = h

    const stream = out.captureStream(FPS)
    try {
      recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: videoBitrate(w, h) })
    } catch {
      return fail()
    }

    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
    recorder.onerror = fail
    recorder.onstop = () => {
      if (!delivering) return
      delivering = false
      if (chunks.length === 0) hooks.fail()
      else hooks.done(new Blob(chunks, { type: format.type }))
    }
    recorder.start(1000)
    started = performance.now()
  }

  const finish = () => {
    if (finished) return
    if (!recorder || recorder.state === 'inactive') return fail()
    delivering = true
    end()
  }

  const draw = (view: CaptureView) => {
    if (finished) return

    if (!sized) {
      sized = true
      const size = videoSize(view.canvas.width, view.canvas.height)
      start(size.width, size.height)
      if (finished) return
    }

    const W = out.width
    const H = out.height
    const k = W / Math.max(view.width, 1)
    const now = performance.now()

    ctx.fillStyle = COLOR.ground
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(view.canvas, 0, 0, W, H)

    for (const [lon, lat] of view.stops) {
      const p = view.project(lon, lat)
      if (p.x < -20 || p.y < -20 || p.x > view.width + 20 || p.y > view.height + 20) continue
      dot(ctx, p.x * k, p.y * k, 5.5 * k, COLOR.white, COLOR.accent, 3 * k)
    }

    const hiker = view.project(view.hiker[0], view.hiker[1])
    dot(ctx, hiker.x * k, hiker.y * k, 9.5 * k, COLOR.accent, COLOR.white, 3 * k, 8 * k)

    if (view.shown !== current) {
      if (view.shown >= 0) {
        current = view.shown
        leaving = -1
        load(current)
        load(current + 1)
        evict(current)
      } else {
        leaving = current
        current = -1
      }
      changedAt = now
    }

    const showing = current >= 0 ? current : leaving
    if (showing >= 0) {
      const age = now - changedAt
      const appear = current >= 0 ? easeOut(Math.min(age / POP_IN_MS, 1)) : 1 - Math.min(age / POP_OUT_MS, 1)
      if (current < 0 && age >= POP_OUT_MS) leaving = -1
      else polaroid(ctx, view, k, showing, appear, hiker)
    } else if (overlay.stops.length > 0 && !pics.has(0)) {
      load(0)
    }

    titleCard(ctx, k, W, overlay.title, `${overlay.subtitle}${overlay.subtitle ? '　' : ''}${overlay.status(view.info)}`)
    credits(ctx, k, W, H, overlay.attribution)

    const progress = Math.round(view.info.fraction * 200) / 200
    const seconds = Math.floor((now - started) / 1000)
    if (progress !== lastProgress || seconds !== lastSecond) {
      lastProgress = progress
      lastSecond = seconds
      hooks.progress(view.info.fraction, seconds)
    }

    if (view.settled) {
      settledAt ||= now
      if (now - settledAt >= HOLD_END_MS) finish()
    }
  }

  function polaroid(c: CanvasRenderingContext2D, view: CaptureView, k: number, i: number, appear: number, hiker: { x: number; y: number }) {
    const stop = overlay.stops[i]!
    const img = pics.get(i)?.img ?? null
    const wide = view.width >= 720
    const pw = (wide ? 260 : Math.min(210, view.width * 0.56)) * k
    const px = (wide ? Math.max(36, view.width / 2 - 380) : 36) * k
    const py = 108 * k
    const pad = 8 * k
    const iw = pw - pad * 2
    const ratio = img ? img.naturalHeight / Math.max(img.naturalWidth, 1) : 0.75
    const ih = Math.min(iw * ratio, view.height * 0.34 * k)
    const foot = (stop.meta ? 46 : 34) * k
    const ph = pad + ih + foot
    const tilt = ((i % 2 ? 3 : -3) * Math.PI) / 180
    const scale = 0.86 + 0.14 * appear

    c.save()
    c.globalAlpha = appear
    c.translate(px + pw * 0.4, py + ph * 0.9)
    c.rotate(tilt)
    c.scale(scale, scale)
    c.translate(-pw * 0.4, -ph * 0.9 + (1 - appear) * 12 * k)

    c.shadowColor = 'rgba(0, 0, 0, 0.38)'
    c.shadowBlur = 36 * k
    c.shadowOffsetY = 16 * k
    c.fillStyle = COLOR.paper
    roundRect(c, 0, 0, pw, ph, 6 * k)
    c.fill()
    c.shadowColor = 'transparent'

    c.fillStyle = '#C9D3B8'
    c.fillRect(pad, pad, iw, ih)
    if (img) {
      const s = Math.max(iw / img.naturalWidth, ih / img.naturalHeight)
      const sw = iw / s
      const sh = ih / s
      c.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, pad, pad, iw, ih)
    }

    c.textBaseline = 'alphabetic'
    c.fillStyle = COLOR.ink
    c.font = `700 ${15 * k}px ${hand}`
    const caption = stop.caption ? ellipsis(c, stop.caption, iw) : ''
    let y = pad + ih + 22 * k
    if (caption) {
      c.fillText(caption, pad, y)
      y += 18 * k
    }
    if (stop.meta) {
      c.fillStyle = COLOR.muted
      c.font = `500 ${12 * k}px ${body}`
      c.fillText(stop.meta, pad, caption ? y : y - 2 * k)
    }
    c.restore()

    if (current !== i) return

    const ax = px + pw * 0.55
    const ay = py + ph - 6 * k
    const hx = hiker.x * k
    const hy = hiker.y * k
    const dx = hx - ax
    const dy = hy - ay
    const len = Math.hypot(dx, dy)
    if (len < 24 * k) return

    c.save()
    c.globalAlpha = appear
    c.strokeStyle = COLOR.white
    c.lineWidth = 2.5 * k
    c.lineCap = 'round'
    c.setLineDash([2 * k, 7 * k])
    c.shadowColor = 'rgba(0, 0, 0, 0.6)'
    c.shadowBlur = 3 * k
    c.shadowOffsetY = 1 * k
    c.beginPath()
    c.moveTo(ax, ay)
    c.quadraticCurveTo(ax + dx * 0.15, ay + dy * 0.7, hx - (dx / len) * 14 * k, hy - (dy / len) * 14 * k)
    c.stroke()
    c.restore()
  }

  function titleCard(c: CanvasRenderingContext2D, k: number, W: number, title: string, sub: string) {
    const x = 16 * k
    const y = 16 * k
    const max = Math.min(W - 32 * k, 520 * k)

    c.save()
    c.font = `700 ${20 * k}px ${hand}`
    const t = ellipsis(c, title, max - 32 * k)
    const tw = c.measureText(t).width
    c.font = `500 ${13 * k}px ${body}`
    const s = ellipsis(c, sub, max - 32 * k)
    const sw = c.measureText(s).width
    const w = Math.min(Math.max(tw, sw) + 32 * k, max)
    const h = (s ? 64 : 46) * k

    c.shadowColor = 'rgba(0, 0, 0, 0.25)'
    c.shadowBlur = 14 * k
    c.shadowOffsetY = 4 * k
    c.fillStyle = COLOR.card
    roundRect(c, x, y, w, h, 18 * k)
    c.fill()
    c.shadowColor = 'transparent'

    c.fillStyle = COLOR.ink
    c.font = `700 ${20 * k}px ${hand}`
    c.fillText(t, x + 16 * k, y + 30 * k)
    if (s) {
      c.fillStyle = COLOR.muted
      c.font = `500 ${13 * k}px ${body}`
      c.fillText(s, x + 16 * k, y + 52 * k)
    }
    c.restore()
  }

  function credits(c: CanvasRenderingContext2D, k: number, W: number, H: number, lines: string[]) {
    c.save()
    c.font = `500 ${11 * k}px ${body}`
    const max = W - 24 * k
    const rows = lines.flatMap((l) => (c.measureText(l).width + 16 * k > max ? wrap(c, l, max - 16 * k) : [l]))
    const lh = 16 * k
    const w = Math.min(Math.max(...rows.map((r) => c.measureText(r).width)) + 16 * k, max)
    const h = rows.length * lh + 6 * k
    const x = W - 12 * k - w
    const y = H - 12 * k - h

    c.fillStyle = 'rgba(251, 251, 244, 0.85)'
    roundRect(c, x, y, w, h, 10 * k)
    c.fill()
    c.fillStyle = COLOR.ink
    rows.forEach((r, n) => c.fillText(r, x + 8 * k, y + 3 * k + lh * (n + 1) - 4 * k))
    c.restore()
  }

  flight.capture(draw)

  return {
    cancel() {
      delivering = false
      if (!finished) end()
    },
  }
}

function easeOut(k: number) {
  return 1 - (1 - k) ** 3
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, width: number, shadow = 4) {
  c.save()
  c.shadowColor = 'rgba(0, 0, 0, 0.45)'
  c.shadowBlur = shadow
  c.shadowOffsetY = shadow / 4
  c.beginPath()
  c.arc(x, y, r + width / 2, 0, Math.PI * 2)
  c.fillStyle = ring
  c.fill()
  c.shadowColor = 'transparent'
  c.beginPath()
  c.arc(x, y, r - width / 2, 0, Math.PI * 2)
  c.fillStyle = fill
  c.fill()
  c.restore()
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function ellipsis(c: CanvasRenderingContext2D, text: string, max: number): string {
  if (c.measureText(text).width <= max) return text

  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (c.measureText(`${chars.slice(0, mid).join('')}…`).width <= max) lo = mid
    else hi = mid - 1
  }

  return `${chars.slice(0, lo).join('')}…`
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/(?<=[ ,，、])/)
  const rows: string[] = []
  let row = ''

  for (const w of words) {
    if (row && c.measureText(row + w).width > max) {
      rows.push(row.trimEnd())
      row = w.trimStart()
    } else {
      row += w
    }
  }

  if (row) rows.push(row)
  return rows
}
