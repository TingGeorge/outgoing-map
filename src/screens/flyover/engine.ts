import type { JumpToOptions, LngLat, Map as MapLibreMap, Marker } from 'maplibre-gl'
import { loadMapLibre, type MapLibre } from '../../map/maplibre'
import { ROUTE_COLOR, TERRAIN_EXAGGERATION, TERRAIN_SOURCE_ID, flyoverStyle, routeLayers } from '../../map/sources'
import {
  CLEARANCE_FRACTIONS,
  angleDelta,
  easeAngle,
  requiredCameraAltitude,
  sampleTimeline,
  timeAtDistance,
  type Path,
  type TileEvent,
  type Timeline,
  isNetworkTileError,
  tileTrouble,
  TILE_WINDOW_MS,
} from './flight'
import s from './flyover.module.css'

const EARTH_RADIUS_M = 6_371_008.8
const RAD = Math.PI / 180

export const CHASE = { backM: 1300, heightM: 520, focusY: 0.66 }

const INTRO_MS = 4000
const OUTRO_MS = 3000
const JUMP_MS = 900
const RESUME_MS = 1400
const READY_TIMEOUT_MS = 25_000

export type FailReason = 'webgl' | 'network' | 'map'

export interface FlightState {
  playing: boolean
  ended: boolean
  active: number
  shown: number
}

export interface FrameInfo {
  distanceM: number
  fraction: number
  eleM: number
  time: number
  stopX: number
  stopY: number
}

export interface FlightHooks {
  ready(): void
  fail(reason: FailReason): void
  tileTrouble(on: boolean): void
  state(state: FlightState): void
  frame(info: FrameInfo): void
  insets(): { top: number; bottom: number }
}

export interface Flight {
  playing(): boolean
  play(): void
  pause(): void
  toggle(): void
  next(): void
  prev(): void
  seek(fraction: number): void
  destroy(): void
}

interface Pose {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}

interface Transition {
  from: Pose
  start: number
  ms: number
  freeze: boolean
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)

export function startFlight(
  container: HTMLElement,
  path: Path,
  timeline: Timeline,
  stopsM: number[],
  reducedMotion: boolean,
  hooks: FlightHooks,
): Flight {
  let lib: MapLibre | null = null
  let map: MapLibreMap | null = null
  let hiker: Marker | null = null
  let destroyed = false
  let raf = 0
  let readyTimer = 0
  let isReady = false
  let tileErrors = 0
  let troubleOn = false
  const tileEvents: TileEvent[] = []
  let troubleTimer = 0
  const loadedTiles = new Set<string>()

  let t = 0
  let last = 0
  let playing = false
  let ended = false
  let mode: 'overview' | 'chase' = 'overview'
  let transition: Transition | null = null
  let snap = true
  let applyOnce = false

  let bearing = path.heading[0]!
  let cameraAlt = NaN
  let lastFraction = -1
  let lastD = -1
  let lastPaint = 0
  let overview: Pose | null = null

  const sample = { distanceM: 0, stop: -1 }
  const info: FrameInfo = { distanceM: 0, fraction: 0, eleM: NaN, time: NaN, stopX: NaN, stopY: NaN }
  const state: FlightState = { playing: false, ended: false, active: -1, shown: -1 }
  const point: [number, number] = [0, 0]
  const ground = new Float64Array(CLEARANCE_FRACTIONS.length)
  const chase: Pose = { center: [0, 0], zoom: 0, pitch: 0, bearing: 0 }
  const blended: Pose = { center: [0, 0], zoom: 0, pitch: 0, bearing: 0 }
  const jump: JumpToOptions = {}
  let fromLngLat: LngLat | null = null
  let toLngLat: LngLat | null = null

  const isBreak = new Uint8Array(path.count)
  for (const b of path.breaks) isBreak[b] = 1

  const sectionAt = (f: number) => {
    let n = 0
    while (n < path.breaks.length && path.breaks[n]! <= f) n++
    return n
  }

  let section = 0
  const sections = [0, ...path.breaks]
    .map((from, n) => ({ id: n ? `flight-${n}` : 'flight', from, to: (path.breaks[n] ?? path.count) - 1, painted: -1 }))
    .filter((sec) => sec.to > sec.from)

  const motion = (ms: number) => (reducedMotion ? 0 : ms)

  const terrainAt = (lon: number, lat: number) => {
    point[0] = lon
    point[1] = lat
    const h = map!.queryTerrainElevation(point)
    return h === null || !Number.isFinite(h) ? null : h
  }

  const emit = () => {
    const active = lastStopAtOrBefore(t)
    const shown = sample.stop
    if (state.playing === playing && state.ended === ended && state.active === active && state.shown === shown) return

    state.playing = playing
    state.ended = ended
    state.active = active
    state.shown = shown
    hooks.state({ ...state })
  }

  const lastStopAtOrBefore = (time: number) => {
    let i = -1
    while (i + 1 < timeline.stopTimes.length && timeline.stopTimes[i + 1]! <= time + 1e-6) i++
    return i
  }

  const pose = (): Pose => {
    const m = map!
    return { center: [m.getCenter().lng, m.getCenter().lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }
  }

  const blendTo = (ms: number, freeze = false) => {
    transition = ms > 0 && map ? { from: pose(), start: performance.now(), ms, freeze } : null
    applyOnce = true
  }

  const frameHiker = () => {
    const h = map!.getContainer().clientHeight
    const insets = hooks.insets()
    const y = insets.top + Math.max(h - insets.top - insets.bottom, 0) * CHASE.focusY
    map!.setPadding({ top: Math.max(0, 2 * y - h), bottom: Math.max(0, h - 2 * y), left: 0, right: 0 })
  }

  const computeOverview = () => {
    const m = map!
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let n = -Infinity

    for (let i = 0; i < path.count; i++) {
      w = Math.min(w, path.lon[i]!)
      e = Math.max(e, path.lon[i]!)
      s = Math.min(s, path.lat[i]!)
      n = Math.max(n, path.lat[i]!)
    }

    const insets = hooks.insets()
    const fit = m.cameraForBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: { top: insets.top + 24, bottom: insets.bottom + 24, left: 32, right: 32 }, bearing: path.heading[0]!, pitch: 45, maxZoom: 15 },
    )
    const center = fit?.center ? lib!.LngLat.convert(fit.center) : m.getCenter()

    overview = {
      center: [center.lng, center.lat],
      zoom: (fit?.zoom ?? 13) - 0.35,
      pitch: 45,
      bearing: path.heading[0]!,
    }
  }

  const computeChase = (d: number, dt: number) => {
    const f = Math.min(d / (path.stepM || 1), path.count - 1)
    const i = Math.min(Math.floor(f), path.count - 2)
    const k = isBreak[i + 1] ? 0 : f - i

    const sectionNow = sectionAt(i + k)
    if (sectionNow !== section) snap = true
    section = sectionNow

    const lon = path.lon[i]! + (path.lon[i + 1]! - path.lon[i]!) * k
    const lat = path.lat[i]! + (path.lat[i + 1]! - path.lat[i]!) * k
    const ele = path.ele[i]! + (path.ele[i + 1]! - path.ele[i]!) * k
    const time = path.time[i]! + (path.time[i + 1]! - path.time[i]!) * k
    const heading = path.heading[i]! + angleDelta(path.heading[i]!, path.heading[i + 1]!) * k

    bearing = snap ? heading : easeAngle(bearing, heading, dt)

    const fallback = Number.isNaN(ele) ? 0 : ele * TERRAIN_EXAGGERATION
    const targetAlt = terrainAt(lon, lat) ?? fallback

    const b = bearing * RAD
    const camLat = lat - ((CHASE.backM * Math.cos(b)) / EARTH_RADIUS_M) / RAD
    const camLon = lon - ((CHASE.backM * Math.sin(b)) / (EARTH_RADIUS_M * Math.cos(lat * RAD))) / RAD

    const groundAtCamera = terrainAt(camLon, camLat) ?? targetAlt
    for (let j = 0; j < CLEARANCE_FRACTIONS.length; j++) {
      const q = CLEARANCE_FRACTIONS[j]!
      ground[j] = terrainAt(camLon + (lon - camLon) * q, camLat + (lat - camLat) * q) ?? targetAlt
    }

    const need = Math.max(targetAlt + CHASE.heightM, requiredCameraAltitude(targetAlt, groundAtCamera, ground))

    if (snap || Number.isNaN(cameraAlt)) cameraAlt = need
    else cameraAlt += (need - cameraAlt) * (1 - Math.exp(-dt / (need > cameraAlt ? 0.35 : 2.5)))
    cameraAlt = Math.max(cameraAlt, groundAtCamera + 40)
    snap = false

    fromLngLat!.lng = camLon
    fromLngLat!.lat = camLat
    toLngLat!.lng = lon
    toLngLat!.lat = lat

    const o = map!.calculateCameraOptionsFromTo(fromLngLat!, cameraAlt, toLngLat!, targetAlt)
    const center = o.center as LngLat

    chase.center[0] = center.lng
    chase.center[1] = center.lat
    chase.zoom = o.zoom!
    chase.pitch = o.pitch!
    chase.bearing = o.bearing!

    info.eleM = Number.isNaN(ele) ? targetAlt / TERRAIN_EXAGGERATION : ele
    info.time = time
    point[0] = lon
    point[1] = lat
    hiker!.setLngLat(point)
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const m = map
    if (!m || !isReady) return

    const dt = Math.min(now - last, 100) / 1000
    last = now

    const frozen = transition?.freeze === true
    if (playing && !frozen) t += dt

    if (playing && t >= timeline.duration) {
      t = timeline.duration
      playing = false
      ended = true
      mode = 'overview'
      blendTo(motion(OUTRO_MS))
    }

    sampleTimeline(timeline, t, sample)
    const d = sample.distanceM
    const moving = playing || transition !== null || applyOnce

    if (moving || snap || d !== lastD) computeChase(d, dt)
    lastD = d

    const target = mode === 'chase' ? chase : overview!
    let out = target

    if (transition) {
      const k = Math.min((now - transition.start) / transition.ms, 1)
      const e = easeInOut(k)
      const from = transition.from

      blended.center[0] = from.center[0] + (target.center[0] - from.center[0]) * e
      blended.center[1] = from.center[1] + (target.center[1] - from.center[1]) * e
      blended.zoom = from.zoom + (target.zoom - from.zoom) * e
      blended.pitch = from.pitch + (target.pitch - from.pitch) * e
      blended.bearing = from.bearing + angleDelta(from.bearing, target.bearing) * e
      out = blended

      if (k >= 1) transition = null
    }

    if (moving) {
      jump.center = out.center
      jump.zoom = out.zoom
      jump.pitch = out.pitch
      jump.bearing = out.bearing
      m.jumpTo(jump)
      applyOnce = !!transition
    }

    const fraction = path.totalM > 0 ? d / path.totalM : 0
    if ((Math.abs(fraction - lastFraction) > 0.0002 || (fraction >= 1 && lastFraction < 1)) && (!playing || now - lastPaint >= 100)) {
      lastFraction = fraction
      lastPaint = now
      for (const sec of sections) {
        const p = Math.min(Math.max((d / (path.stepM || 1) - sec.from) / (sec.to - sec.from), 0.00001), 0.99999)
        if (p === sec.painted) continue

        sec.painted = p
        m.setPaintProperty(`${sec.id}-done-casing`, 'line-gradient', ['step', ['line-progress'], '#FFFFFF', p, 'rgba(255,255,255,0)'])
        m.setPaintProperty(`${sec.id}-done-line`, 'line-gradient', ['step', ['line-progress'], ROUTE_COLOR, p, 'rgba(184,74,34,0)'])
      }
    }

    info.distanceM = d
    info.fraction = fraction
    info.stopX = NaN
    info.stopY = NaN

    if (sample.stop >= 0) {
      const at = m.project(hiker!.getLngLat())
      info.stopX = at.x
      info.stopY = at.y
    }

    hooks.frame(info)
    emit()
  }

  const goTo = (time: number, ms: number) => {
    t = Math.min(Math.max(time, 0), timeline.duration)
    if (ended && t < timeline.duration) ended = false
    mode = 'chase'
    snap = true
    blendTo(ms)
  }

  const flight: Flight = {
    playing: () => playing,

    play() {
      if (!map || !isReady || playing) return

      if (ended || t >= timeline.duration) {
        t = 0
        ended = false
        mode = 'chase'
        snap = true
        playing = true
        blendTo(motion(INTRO_MS), true)
        return
      }

      const intro = mode === 'overview'
      mode = 'chase'
      playing = true
      if (intro) snap = true
      blendTo(motion(intro ? INTRO_MS : RESUME_MS), intro)
    },

    pause() {
      playing = false
      if (transition?.freeze) transition = null
    },

    toggle() {
      if (playing) flight.pause()
      else flight.play()
    },

    next() {
      const i = lastStopAtOrBefore(t) + 1
      if (i < timeline.stopTimes.length) goTo(timeline.stopTimes[i]!, motion(JUMP_MS))
    },

    prev() {
      const active = lastStopAtOrBefore(t)
      const i = sample.stop >= 0 || (active >= 0 && t - timeline.stopTimes[active]! < 0.5) ? active - 1 : active
      goTo(i >= 0 ? timeline.stopTimes[i]! : 0, motion(JUMP_MS))
    },

    seek(fraction) {
      goTo(timeAtDistance(timeline, Math.min(Math.max(fraction, 0), 1) * path.totalM), 0)
    },

    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      clearTimeout(readyTimer)
      clearInterval(troubleTimer)
      map?.remove()
      map = null
    },
  }

  const judgeTrouble = () => {
    const now = performance.now()
    while (tileEvents.length && now - tileEvents[0]!.at > TILE_WINDOW_MS) tileEvents.shift()

    const on = isReady && (!navigator.onLine || tileTrouble(tileEvents, now))
    if (on === troubleOn) return

    troubleOn = on
    hooks.tileTrouble(on)
  }

  const markReady = () => {
    if (isReady || destroyed || !map) return
    if (!hiker || !loadedTiles.has('photo') || !loadedTiles.has(TERRAIN_SOURCE_ID)) {
      clearTimeout(readyTimer)
      return hooks.fail('network')
    }

    isReady = true
    clearTimeout(readyTimer)
    hooks.ready()
    troubleTimer = window.setInterval(judgeTrouble, 2000)
    judgeTrouble()
    if (!reducedMotion) flight.play()
  }

  const boot = async () => {
    try {
      lib = await loadMapLibre()
    } catch {
      return hooks.fail(navigator.onLine ? 'map' : 'network')
    }
    if (destroyed) return

    const mgl = lib

    try {
      map = new mgl.Map({
        container,
        style: flyoverStyle(),
        attributionControl: false,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        maxPitch: 72,
        minZoom: 8,
        maxZoom: 17.5,
        renderWorldCopies: false,
        fadeDuration: 0,
        center: [path.lon[0]!, path.lat[0]!],
        zoom: 13,
      })
    } catch {
      return hooks.fail('webgl')
    }

    const m = map
    readyTimer = window.setTimeout(markReady, READY_TIMEOUT_MS)
    fromLngLat = new mgl.LngLat(0, 0)
    toLngLat = new mgl.LngLat(0, 0)

    m.on('error', (e) => {
      const fromTiles = 'sourceId' in e
      if (!fromTiles) {
        if (!isReady) hooks.fail('map')
        return
      }

      tileErrors++
      if (!isReady && !navigator.onLine) {
        clearTimeout(readyTimer)
        hooks.fail('network')
        return
      }

      if (isNetworkTileError(e.error)) tileEvents.push({ at: performance.now(), ok: false })
      judgeTrouble()
    })

    m.on('sourcedata', (e) => {
      if (e.tile?.state !== 'loaded') return

      loadedTiles.add(e.sourceId)
      tileEvents.push({ at: performance.now(), ok: true })
    })

    m.on('webglcontextlost', () => hooks.fail('map'))

    m.on('movestart', (e) => {
      if (e.originalEvent && isReady) {
        playing = false
        transition = null
      }
    })

    m.on('resize', () => {
      if (!hiker) return
      frameHiker()
      computeOverview()
      applyOnce = true
    })

    m.once('style.load', () => {
      if (destroyed) return

      for (const sec of sections) {
        const coordinates = Array.from({ length: sec.to - sec.from + 1 }, (_, i) => [path.lon[sec.from + i]!, path.lat[sec.from + i]!])
        m.addSource(sec.id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }, lineMetrics: true })
        m.addLayer({ id: `${sec.id}-all-casing`, type: 'line', source: sec.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.45, 'line-width': 6 } })
        m.addLayer({ id: `${sec.id}-all-line`, type: 'line', source: sec.id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ROUTE_COLOR, 'line-opacity': 0.45, 'line-width': 3 } })
      }

      for (const sec of sections) {
        for (const layer of routeLayers(`${sec.id}-done`)) {
          if (layer.type !== 'line') continue
          const { 'line-color': _color, ...paint } = layer.paint ?? {}
          m.addLayer({ ...layer, source: sec.id, paint: { ...paint, 'line-gradient': ['step', ['line-progress'], ROUTE_COLOR, 0.00001, 'rgba(0,0,0,0)'] } })
        }
      }

      for (const at of stopsM) {
        const f = Math.min(at / (path.stepM || 1), path.count - 1)
        const i = Math.round(f)
        const el = document.createElement('div')
        el.className = s.stop!
        new mgl.Marker({ element: el, opacityWhenCovered: '0.4' }).setLngLat([path.lon[i]!, path.lat[i]!]).addTo(m)
      }

      const me = document.createElement('div')
      me.className = s.hiker!
      hiker = new mgl.Marker({ element: me, opacityWhenCovered: '1', subpixelPositioning: true }).setLngLat([path.lon[0]!, path.lat[0]!]).addTo(m)

      frameHiker()
      computeOverview()
      m.jumpTo({ center: overview!.center, zoom: overview!.zoom, pitch: overview!.pitch, bearing: overview!.bearing })

      m.on('idle', () => {
        if (!isReady && (tileErrors > 0 || (loadedTiles.has('photo') && loadedTiles.has(TERRAIN_SOURCE_ID)))) markReady()
      })

      last = performance.now()
      raf = requestAnimationFrame(frame)
    })
  }

  void boot()
  return flight
}
