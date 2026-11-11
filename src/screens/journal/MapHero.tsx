import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap, Marker } from 'maplibre-gl'
import { distanceM, sampleAtDistance } from '../../core'
import { getKey, validateKey } from '../../key'
import { loadMapLibre, mapContainer, type MapLibre } from '../../map/maplibre'
import { flatStyle, routeLayers } from '../../map/sources'
import { getPhotoUrl } from '../../storage'
import type { Photo, PoiOnRoute, Route } from '../../types'
import { Button, CloseIcon, ExpandIcon, IconButton, Notice, formatMetres } from '../../ui'
import { photoAlt } from './text'
import { routeSections } from './sections'
import { release } from './urls'
import s from './journal.module.css'

type Problem = 'load' | 'webgl' | 'key' | 'offline'

export type Scrub = (distanceM: number | null) => void

interface Props {
  route: Route
  photos: Photo[]
  pois: PoiOnRoute[]
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  onOpenPhoto: (id: string) => void
  scrub: RefObject<Scrub | null>
  controls: ReactNode
}

const ROUTE_SOURCE = 'route'

const LOCALE = {
  'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 再捲動，就能縮放地圖',
  'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 再捲動，就能縮放地圖',
  'CooperativeGesturesHandler.MobileHelpText': '用兩指移動地圖，或按放大鈕',
}

function padding(expanded: boolean, map?: MlMap) {
  const attribution = map?.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib')?.offsetHeight ?? 0

  return expanded
    ? { top: 100, bottom: Math.max(64, attribution + 30), left: 64, right: 64 }
    : { top: 96, bottom: Math.max(76, attribution + 62), left: 52, right: 52 }
}

function bounds(route: Route): LngLatBoundsLike {
  let w = Infinity
  let so = Infinity
  let e = -Infinity
  let n = -Infinity

  for (const p of route.points) {
    w = Math.min(w, p.lon)
    e = Math.max(e, p.lon)
    so = Math.min(so, p.lat)
    n = Math.max(n, p.lat)
  }

  return [w, so, e, n]
}

function fit(map: MlMap, route: Route, expanded: boolean, animate: boolean) {
  if (route.points.length === 0) return

  if (route.points.length === 1) {
    const p = route.points[0]!
    map.jumpTo({ center: [p.lon, p.lat], zoom: 14 })
    return
  }

  map.fitBounds(bounds(route), { padding: padding(expanded, map), maxZoom: 16, animate })
}

function el(className: string | undefined) {
  const node = document.createElement('div')
  node.className = className ?? ''
  return node
}

interface Entry {
  marker: Marker
  box: HTMLElement
  badge?: HTMLElement
  flip?: boolean
}

const PLACES = [s.flipped, s.toLeft, s.toRight].filter((c): c is string => !!c)

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const shown = (entries: Entry[]) => entries.filter((e) => e.marker.getElement().style.visibility !== 'hidden').map((e) => e.box.getBoundingClientRect())

// ponytail: greedy O(n²) overlap scan over marker rects after each move; fine for a few hundred markers, a grid bucket would be the upgrade.
function thin(entries: Entry[], blockers: DOMRect[], area?: DOMRect) {
  const kept: { rect: DOMRect; entry?: Entry; hidden: number }[] = blockers.map((rect) => ({ rect, hidden: 0 }))

  for (const entry of entries) entry.marker.getElement().style.visibility = ''

  const outside = area && { rect: area, hidden: 0 }
  const overlap = (r: DOMRect) =>
    kept.find(({ rect }) => overlaps(r, rect)) ?? (outside && (r.left < area.left || r.right > area.right || r.top < area.top) ? outside : undefined)

  for (const entry of entries) {
    const places = entry.flip ? PLACES : []
    let r: DOMRect | undefined
    let hit: (typeof kept)[number] | undefined

    for (const place of ['', ...places]) {
      entry.box.classList.remove(...places)
      if (place) entry.box.classList.add(place)
      r = entry.box.getBoundingClientRect()
      hit = overlap(r)
      if (!hit) break
    }

    if (!hit) {
      kept.push({ rect: r!, entry, hidden: 0 })
      continue
    }

    if (places.length) entry.box.classList.remove(...places)
    entry.marker.getElement().style.visibility = 'hidden'
    if (entry.badge && hit.entry?.badge) hit.hidden++
  }

  for (const { entry, hidden } of kept) {
    if (!entry?.badge) continue
    entry.badge.textContent = hidden ? `+${hidden}` : ''
    entry.badge.hidden = hidden === 0
  }
}

function chrome(section: Element | null | undefined): DOMRect[] {
  if (!section) return []

  const nodes = section.querySelectorAll(`.${s.controls} button, .${s.controls} a, .${s.expand}, .maplibregl-ctrl-attrib`)
  return Array.from(nodes, (n) => n.getBoundingClientRect()).filter((r) => r.width > 0)
}

export function MapHero({ route, photos, pois, expanded, onExpand, onCollapse, onOpenPhoto, scrub, controls }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<{ map: MlMap; lib: MapLibre } | null>(null)
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)

  const latest = useRef({ route, expanded, onOpenPhoto })
  latest.current = { route, expanded, onOpenPhoto }

  useEffect(() => {
    let cancelled = false
    let map: MlMap | undefined
    let observer: ResizeObserver | undefined

    void (async () => {
      let lib: MapLibre

      try {
        lib = await loadMapLibre()
      } catch {
        if (!cancelled) setProblem('load')
        return
      }

      if (cancelled || !container.current) return

      const key = getKey() ?? ''

      try {
        map = new lib.Map({
          container: container.current,
          style: flatStyle(key),
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          locale: LOCALE,
          bounds: latest.current.route.points.length > 1 ? bounds(latest.current.route) : undefined,
          fitBoundsOptions: { padding: padding(false), maxZoom: 16 },
        })
      } catch {
        setProblem('webgl')
        return
      }

      const m = map
      m.touchZoomRotate.disableRotation()
      m.keyboard.disableRotation()
      m.addControl(new lib.AttributionControl({ compact: false, customAttribution: '' }), 'bottom-right')

      let checked = false

      m.on('error', (e) => {
        if (cancelled || checked || (e as { sourceId?: string }).sourceId !== 'outdoors') return
        checked = true

        setTimeout(() => {
          if (cancelled) return

          void validateKey(key).then((result) => {
            if (!cancelled && result !== 'valid') setProblem(result === 'invalid' ? 'key' : 'offline')
          })
        }, 1000)
      })

      m.on('load', () => {
        m.addSource(ROUTE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        for (const layer of routeLayers(ROUTE_SOURCE)) m.addLayer(layer)

        mapRef.current = { map: m, lib }
        setReady(true)
      })

      observer = new ResizeObserver(() => m.resize())
      observer.observe(container.current)
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      map?.remove()
      mapRef.current = null
    }
  }, [])

  const routeKey = `${route.points.length}:${route.totalDistanceM}`

  useEffect(() => {
    const current = mapRef.current
    if (!ready || !current) return

    const lines = routeSections(route).map((section) => section.map((p) => [p.lon, p.lat]))
    const source = current.map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    const geometry = lines.length > 1 ? ({ type: 'MultiLineString', coordinates: lines } as const) : ({ type: 'LineString', coordinates: lines[0] ?? [] } as const)
    source?.setData({ type: 'Feature', properties: {}, geometry })

    fit(current.map, route, latest.current.expanded, false)
  }, [ready, routeKey])

  const photoKey = photos.map((p) => `${p.id}:${p.caption}:${p.placement.source}`).join('|')
  const poiKey = pois.map((h) => h.poi.id).join('|')

  useEffect(() => {
    const current = mapRef.current
    if (!ready || !current) return

    const { map, lib } = current
    const entries: Entry[] = []
    const urls: [string, HTMLImageElement][] = []
    let stale = false

    const photoEntries: Entry[] = []
    const poiEntries: Entry[] = []

    const add = (node: HTMLElement, lon: number, lat: number, box: HTMLElement, badge?: HTMLElement) => {
      const marker = new lib.Marker({ element: node, anchor: 'center' }).setLngLat([lon, lat]).addTo(map)
      const entry = { marker, box, badge }
      entries.push(entry)
      return entry
    }

    const first = route.points[0]
    const last = route.points.at(-1)

    if (first) {
      const node = el(s.startPin)
      node.setAttribute('aria-hidden', 'true')
      add(node, first.lon, first.lat, node)
    }

    if (last && route.points.length > 1 && route.totalDistanceM > 0) {
      if (distanceM(first!, last) >= 150) {
        const node = el(s.endPin)
        node.setAttribute('aria-hidden', 'true')
        add(node, last.lon, last.lat, node)
      }
    }

    for (const hit of pois) {
      const node = el(s.poiPin)
      const dot = el(hit.poi.kind === 'peak' ? s.poiDotPeak : s.poiDot)
      const label = el(s.poiLabel)
      const name = el(s.poiName)
      name.textContent = hit.poi.name
      label.append(name)

      if (hit.poi.ele !== null) {
        const ele = el(s.poiEle)
        ele.textContent = `${formatMetres(hit.poi.ele)} 公尺`
        label.append(ele)
      }

      node.append(dot, label)
      node.setAttribute('aria-hidden', 'true')

      const marker = new lib.Marker({ element: node, anchor: 'center' }).setLngLat([hit.poi.lon, hit.poi.lat]).addTo(map)
      poiEntries.push({ marker, box: label, flip: true })
    }

    for (const photo of photos) {
      const p = photo.placement
      if (p.source === 'none') continue

      const button = document.createElement('button')
      button.type = 'button'
      button.className = s.photoPin ?? ''
      button.setAttribute('aria-label', `打開照片：${photoAlt(photo)}`)

      const ring = el(s.photoRing)
      const img = document.createElement('img')
      img.alt = ''
      ring.append(img)

      const badge = el(s.pinBadge)
      badge.hidden = true

      button.append(ring, badge)
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        latest.current.onOpenPhoto(photo.id)
      })

      photoEntries.push(add(button, p.lon, p.lat, ring, badge))

      void getPhotoUrl(photo.id, 'thumb').then((url) => {
        if (!url) return
        if (stale) return URL.revokeObjectURL(url)
        urls.push([url, img])
        img.src = url
      }, () => {})
    }

    entries.push(...poiEntries)

    const run = () => {
      const fixed = chrome(container.current?.parentElement)
      thin(photoEntries, fixed)
      thin(poiEntries, [...fixed, ...shown(photoEntries)], container.current?.getBoundingClientRect())
    }
    run()
    map.on('moveend', run)

    return () => {
      stale = true
      map.off('moveend', run)
      for (const e of entries) e.marker.remove()
      for (const [url, img] of urls) release(url, img)
    }
  }, [ready, routeKey, photoKey, poiKey])

  useEffect(() => {
    const current = mapRef.current
    if (!ready || !current) return

    const { map, lib } = current
    const node = el(s.scrubDot)
    const marker = new lib.Marker({ element: node, anchor: 'center' })
    let shown = false

    scrub.current = (d) => {
      const at = d === null ? null : sampleAtDistance(latest.current.route, d)

      if (!at) {
        if (shown) marker.remove()
        shown = false
        return
      }

      marker.setLngLat([at.lon, at.lat])
      if (!shown) marker.addTo(map)
      shown = true
    }

    return () => {
      scrub.current = null
      marker.remove()
    }
  }, [ready, scrub])

  useEffect(() => {
    const current = mapRef.current
    if (!ready || !current) return

    const { map } = current

    if (expanded) map.cooperativeGestures.disable()
    else map.cooperativeGestures.enable()

    const frame = requestAnimationFrame(() => {
      map.resize()
      fit(map, latest.current.route, expanded, false)
    })

    return () => cancelAnimationFrame(frame)
  }, [ready, expanded])

  useEffect(() => {
    if (!expanded) return

    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onCollapse()
    }

    addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = before
      removeEventListener('keydown', onKey)
    }
  }, [expanded, onCollapse])

  return (
    <section className={expanded ? `${s.hero} ${s.heroExpanded}` : s.hero} aria-label="路線地圖">
      <div ref={container} className={`${s.map} ${mapContainer}`} />

      {problem && (
        <div className={s.mapProblem}>
          <MapProblem problem={problem} />
        </div>
      )}

      {expanded ? (
        <div className={s.controls}>
          <IconButton label="縮小地圖" onClick={onCollapse}>
            <CloseIcon />
          </IconButton>
        </div>
      ) : (
        <>
          <div className={s.controls}>{controls}</div>
          {!problem && (
            <div className={s.expand}>
              <IconButton label="放大地圖" onClick={onExpand}>
                <ExpandIcon size={20} />
              </IconButton>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function MapProblem({ problem }: { problem: Problem }) {
  if (problem === 'key') {
    return (
      <Notice tone="warning" title="地圖暫時打不開" action={<Button variant="dark" href="#/settings">前往設定</Button>}>
        地圖鑰匙已經不能用，或這個月的免費額度用完了。到設定換一把鑰匙，地圖就會回來。
      </Notice>
    )
  }

  if (problem === 'offline') {
    return (
      <Notice tone="info" title="地圖需要網路">
        現在連不上地圖服務。連上網路後重新整理，地圖就會出現；照片和日記都在下面。
      </Notice>
    )
  }

  if (problem === 'webgl') {
    return (
      <Notice tone="info" title="這個瀏覽器無法顯示地圖">
        顯示地圖需要 WebGL，這台裝置的瀏覽器目前沒有開啟。路線的數字、照片和日記都在下面。
      </Notice>
    )
  }

  return (
    <Notice tone="info" title="地圖沒有載入">
      地圖程式沒有下載成功，請確認網路後重新整理。
    </Notice>
  )
}
