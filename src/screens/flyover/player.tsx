import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { mapContainer } from '../../map/maplibre'
import { NLSC_ATTRIBUTION, TERRAIN_ATTRIBUTION } from '../../map/sources'
import { goBack } from '../../router'
import { getPhotoUrl } from '../../storage'
import {
  Button,
  CloseIcon,
  IconButton,
  NextIcon,
  Notice,
  PauseIcon,
  PlayIcon,
  Polaroid,
  PrevIcon,
  Spinner,
  formatKm,
  formatMetres,
  formatTime,
} from '../../ui'
import { startFlight, type FailReason, type Flight, type FlightState } from './engine'
import type { FlightData } from './index'
import s from './flyover.module.css'

const W = 330
const H = 56

const FAILURE: Record<FailReason, { title: string; text: string }> = {
  webgl: { title: '這台裝置無法顯示立體畫面', text: '瀏覽器沒有開啟 WebGL，或這台裝置不支援。可以回到日誌看照片與平面地圖。' },
  network: { title: '立體畫面需要網路連線', text: '地形和空拍影像要從網路載入。連上網路後再試一次。' },
  map: { title: '立體畫面載入失敗', text: '地圖沒有順利開啟，請稍後再試一次。' },
}

function profileShape(data: FlightData) {
  const { profile, path } = data
  const ys = new Float32Array(W + 1)

  if (!profile || profile.maxEleM - profile.minEleM < 1) {
    ys.fill(H - 16)
  } else {
    const span = profile.maxEleM - profile.minEleM
    const pts = profile.samples
    let j = 0

    for (let x = 0; x <= W; x++) {
      const d = (x / W) * path.totalM
      while (j < pts.length - 2 && pts[j + 1]!.distanceM < d) j++

      const a = pts[j]!
      const b = pts[Math.min(j + 1, pts.length - 1)]!
      const k = b.distanceM > a.distanceM ? Math.min(Math.max((d - a.distanceM) / (b.distanceM - a.distanceM), 0), 1) : 0
      ys[x] = H - 8 - ((a.ele + (b.ele - a.ele) * k - profile.minEleM) / span) * (H - 16)
    }
  }

  let line = `M0 ${ys[0]!.toFixed(1)}`
  for (let x = 2; x <= W; x += 2) line += ` L${x} ${ys[x]!.toFixed(1)}`

  return { ys, line, area: `${line} L${W} ${H} L0 ${H} Z` }
}

function PhotoPop({ photo, index, onOpen }: { photo: Photo; index: number; onOpen: () => void }) {
  const url = usePhotoUrl(photo.id)

  return (
    <button type="button" className={s.pop} aria-label="放大這張照片" data-photo-id={photo.id} onClick={onOpen}>
      <Polaroid
        alt={photo.caption || '沿途的照片'}
        src={url}
        caption={photo.caption || undefined}
        meta={photo.takenAt !== null ? formatTime(photo.takenAt) : undefined}
        tilt={index % 2 ? 3 : -3}
      />
    </button>
  )
}

type Photo = FlightData['stops'][number]

function usePhotoUrl(id: string) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    let live = true
    const made: string[] = []

    const fetchSize = async (size: 'thumb' | 'full') => {
      const u = await getPhotoUrl(id, size).catch(() => undefined)
      if (!u) return
      made.push(u)
      if (live) setUrl(u)
    }

    void fetchSize('thumb').then(() => {
      if (live) void fetchSize('full')
    })

    return () => {
      live = false
      made.forEach((u) => URL.revokeObjectURL(u))
      setUrl(undefined)
    }
  }, [id])

  return url
}

function Lightbox({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const url = usePhotoUrl(photo.id)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  return (
    <div className={s.lightbox} role="dialog" aria-modal="true" aria-label="照片" onClick={onClose}>
      {url && <img src={url} alt={photo.caption || '沿途的照片'} />}
      {photo.caption && <p className={s.lightboxCaption}>{photo.caption}</p>}
      <button ref={closeRef} type="button" className={s.lightboxClose} aria-label="關閉照片" onClick={onClose}>
        <CloseIcon size={20} />
      </button>
    </div>
  )
}

export function Player({ tripId, data }: { tripId: string; data: FlightData | null }) {
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'ready' | FailReason>('loading')
  const [trouble, setTrouble] = useState(false)
  const [flight, setFlight] = useState<FlightState>({ playing: false, ended: false, active: -1, shown: -1 })
  const [shownPhoto, setShownPhoto] = useState(-1)
  const [leaving, setLeaving] = useState(false)
  const [enlarged, setEnlarged] = useState(false)

  const mapRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const distanceRef = useRef<HTMLSpanElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const eleRef = useRef<HTMLSpanElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<SVGRectElement>(null)
  const knobRef = useRef<SVGCircleElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const leaderRef = useRef<SVGPathElement>(null)
  const engine = useRef<Flight | null>(null)
  const fractionRef = useRef(0)
  const drag = useRef<{ resume: boolean } | null>(null)

  const shape = useMemo(() => (data ? profileShape(data) : null), [data])
  const clipId = `flight-clip-${attempt}`
  const close = () => goBack({ name: 'trip', id: tripId })

  useEffect(() => {
    if (!data || !shape || !mapRef.current) return

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const last = { distance: '', clock: '', ele: '', percent: -1, x: -1 }
    let shownTime = NaN
    const hasTime = !Number.isNaN(data.path.time[0]!) || !Number.isNaN(data.path.time[data.path.count - 1]!)

    setPhase('loading')

    const f = startFlight(mapRef.current, data.path, data.timeline, data.stops.map((p) => (p.placement.source === 'none' ? 0 : p.placement.routeDistanceM)), reduced, {
      ready: () => setPhase('ready'),
      fail: (reason) => setPhase(reason),
      tileTrouble: () => setTrouble(true),
      state: (next) => {
        shownTime = data.stops[next.shown]?.takenAt ?? NaN
        setFlight(next)
        if (next.shown >= 0) {
          setShownPhoto(next.shown)
          setLeaving(false)
        } else {
          setLeaving(true)
        }
      },
      insets: () => ({
        top: topRef.current ? topRef.current.getBoundingClientRect().bottom : 80,
        bottom: cardRef.current ? innerHeight - cardRef.current.getBoundingClientRect().top : 240,
      }),
      frame: (info) => {
        fractionRef.current = info.fraction

        const distance = formatKm(info.distanceM)
        if (distance !== last.distance && distanceRef.current) {
          last.distance = distance
          distanceRef.current.textContent = distance
          distanceRef.current.dataset.distanceM = String(Math.round(info.distanceM))
        }

        const time = Number.isNaN(shownTime) ? info.time : shownTime
        const clock = hasTime && !Number.isNaN(time) ? formatTime(time) : ''
        if (clock !== last.clock && clockRef.current) {
          last.clock = clock
          clockRef.current.textContent = clock
          clockRef.current.parentElement!.hidden = !clock
        }

        const ele = Number.isNaN(info.eleM) ? '' : `海拔 ${formatMetres(info.eleM)} 公尺`
        if (ele !== last.ele && eleRef.current) {
          last.ele = ele
          eleRef.current.textContent = ele
        }

        const x = Math.round(info.fraction * W * 2) / 2
        if (x !== last.x) {
          last.x = x
          clipRef.current?.setAttribute('width', String(x))
          knobRef.current?.setAttribute('cx', String(x))
          knobRef.current?.setAttribute('cy', String(shape.ys[Math.round(x)]!.toFixed(1)))
        }

        const percent = Math.round(info.fraction * 100)
        if (percent !== last.percent && sliderRef.current) {
          last.percent = percent
          sliderRef.current.setAttribute('aria-valuenow', String(percent))
          sliderRef.current.setAttribute('aria-valuetext', `已走 ${distance} 公里`)
        }

        const leader = leaderRef.current
        const pop = popRef.current
        if (!leader) return

        if (Number.isNaN(info.stopX) || !pop) {
          if (leader.getAttribute('d')) leader.setAttribute('d', '')
          return
        }

        const box = pop.getBoundingClientRect()
        const ax = box.left + box.width * 0.55
        const ay = box.bottom - 6
        const dx = info.stopX - ax
        const dy = info.stopY - ay
        const len = Math.hypot(dx, dy)
        if (len < 24) return leader.setAttribute('d', '')

        const ex = info.stopX - (dx / len) * 14
        const ey = info.stopY - (dy / len) * 14
        leader.setAttribute('d', `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${(ax + dx * 0.15).toFixed(1)} ${(ay + dy * 0.7).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`)
      },
    })

    engine.current = f

    const onVisibility = () => document.hidden && f.pause()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      f.destroy()
      engine.current = null
    }
  }, [data, shape, attempt])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement
      const onControl = target.closest('button, a, [role="slider"], input, textarea')

      if (e.key === 'Escape') {
        e.preventDefault()
        if (enlarged) setEnlarged(false)
        else close()
        return
      }

      if (enlarged || phase !== 'ready') return

      if (e.key === ' ' && !onControl) {
        e.preventDefault()
        engine.current?.toggle()
      } else if (e.key === 'ArrowLeft' && !target.closest('[role="slider"]')) {
        e.preventDefault()
        engine.current?.prev()
      } else if (e.key === 'ArrowRight' && !target.closest('[role="slider"]')) {
        e.preventDefault()
        engine.current?.next()
      }
    }

    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const seekAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    engine.current?.seek((e.clientX - box.left) / box.width)
  }

  const onSliderKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02, PageDown: -0.1, PageUp: 0.1 }[e.key]
    if (step === undefined && e.key !== 'Home' && e.key !== 'End') return

    e.preventDefault()
    e.stopPropagation()
    engine.current?.pause()
    engine.current?.seek(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : fractionRef.current + step!)
  }

  const openPhoto = () => {
    engine.current?.pause()
    setEnlarged(true)
  }

  const stops = data?.stops ?? []
  const photo = shownPhoto >= 0 ? stops[shownPhoto] : undefined
  const shown = flight.shown >= 0 ? stops[flight.shown] : undefined
  const ready = phase === 'ready'
  const failed = phase !== 'loading' && phase !== 'ready'
  const counter = stops.length === 0 ? null : flight.active >= 0 ? `第 ${flight.active + 1} 張，共 ${stops.length} 張` : `共 ${stops.length} 張照片`

  return (
    <div className={s.root} data-state={flight.ended ? 'ended' : flight.playing ? 'playing' : 'paused'} data-phase={phase}>
      <h1 className="visually-hidden">立體播放{data ? `：${data.trip.title}` : ''}</h1>

      <div ref={mapRef} key={attempt} className={mapContainer} />

      {ready && (
        <>
          <svg className={s.leaderLayer} aria-hidden="true">
            <path ref={leaderRef} className={s.leader} d="" />
          </svg>

          {photo && !enlarged && (
            <div
              key={photo.id}
              ref={popRef}
              className={leaving ? s.popOut : s.popIn}
              onAnimationEnd={() => {
                if (leaving) setShownPhoto(-1)
              }}
            >
              <PhotoPop key={photo.id} photo={photo} index={shownPhoto} onOpen={openPhoto} />
            </div>
          )}
        </>
      )}

      <div ref={topRef} className={s.top}>
        <IconButton label="關閉播放" onClick={close}>
          <CloseIcon size={20} />
        </IconButton>
        {data && (
          <div className={s.pill}>
            <span hidden>
              <span ref={clockRef} />
              <span className={s.dot} aria-hidden="true" />
            </span>
            <span ref={eleRef} />
          </div>
        )}
      </div>

      {ready && trouble && (
        <div className={s.trouble}>
          <Notice tone="warning">網路不穩，部分地形或空拍影像沒有載入。立體畫面需要網路連線。</Notice>
        </div>
      )}

      {data && shape && (
        <div ref={cardRef} className={s.card} inert={!ready}>
          <div className={s.cardHead}>
            <div className={s.title}>{shown?.caption || data.trip.title}</div>
            {counter && (
              <div className={s.counter} aria-live="polite">
                {counter}
              </div>
            )}
          </div>

          <div className={s.distance}>
            已走 <span ref={distanceRef} data-distance-m="0">0.0</span> 公里，全程 {formatKm(data.path.totalM)} 公里
          </div>

          <div
            ref={sliderRef}
            className={s.scrubber}
            role="slider"
            tabIndex={0}
            aria-label="播放進度與海拔剖面"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            onKeyDown={onSliderKey}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { resume: engine.current?.playing() ?? false }
              engine.current?.pause()
              seekAt(e)
            }}
            onPointerMove={(e) => drag.current && seekAt(e)}
            onPointerUp={() => {
              if (drag.current?.resume) engine.current?.play()
              drag.current = null
            }}
            onPointerCancel={() => {
              drag.current = null
            }}
          >
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <clipPath id={clipId}>
                  <rect ref={clipRef} x="0" y="0" width="0" height={H} />
                </clipPath>
              </defs>
              <path d={shape.area} className={s.areaAll} />
              <g clipPath={`url(#${clipId})`}>
                <path d={shape.area} className={s.areaDone} />
                <path d={shape.line} className={s.lineDone} vectorEffect="non-scaling-stroke" />
              </g>
              <circle ref={knobRef} cx="0" cy={shape.ys[0]} r="6" className={s.knob} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div className={s.controls}>
            {stops.length > 0 && (
              <button type="button" className={s.side} aria-label="上一張照片" disabled={flight.active < 0 && flight.shown < 0} onClick={() => engine.current?.prev()}>
                <PrevIcon size={20} />
              </button>
            )}

            {flight.ended ? (
              <Button variant="dark" icon={<PlayIcon size={18} />} onClick={() => engine.current?.play()}>
                重新播放
              </Button>
            ) : (
              <button type="button" className={s.main} aria-label={flight.playing ? '暫停' : '播放'} onClick={() => engine.current?.toggle()}>
                {flight.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
              </button>
            )}

            {stops.length > 0 && (
              <button type="button" className={s.side} aria-label="下一張照片" disabled={flight.active + 1 >= stops.length} onClick={() => engine.current?.next()}>
                <NextIcon size={20} />
              </button>
            )}
          </div>

          <p className={s.credit}>
            <span dangerouslySetInnerHTML={{ __html: `影像 ${NLSC_ATTRIBUTION}` }} />
            <span dangerouslySetInnerHTML={{ __html: TERRAIN_ATTRIBUTION }} />
          </p>
        </div>
      )}

      {phase === 'loading' && (
        <div className={s.veil}>
          <Spinner label="載入中" />
          <p>正在載入地形與空拍影像…</p>
        </div>
      )}

      {failed && (
        <div className={s.veil}>
          <div className={s.failure}>
            <Notice
              tone="error"
              title={FAILURE[phase].title}
              action={
                <div className={s.failActions}>
                  {phase !== 'webgl' && (
                    <Button variant="dark" onClick={() => setAttempt((n) => n + 1)}>
                      再試一次
                    </Button>
                  )}
                  <Button variant="ghost" onClick={close}>
                    回到日誌
                  </Button>
                </div>
              }
            >
              {FAILURE[phase].text}
            </Notice>
          </div>
        </div>
      )}

      {enlarged && photo && <Lightbox photo={photo} onClose={() => setEnlarged(false)} />}
    </div>
  )
}
