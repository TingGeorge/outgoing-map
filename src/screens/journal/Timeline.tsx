import { memo, useEffect, useRef, useState } from 'react'
import { getPhotoUrl } from '../../storage'
import type { Photo, TimelineItem } from '../../types'
import { DISPLAY_TIME_ZONE, Polaroid, SectionTitle, formatDate, formatMetres, formatTime } from '../../ui'
import { POI_KIND, photoAlt } from './text'
import { release } from './urls'
import s from './journal.module.css'

const TILTS = [-1.2, 1, -0.6, 1.4, -1.6, 0.6]

const COUNT = ['', '一', '兩', '三', '四', '五', '六', '七', '八', '九', '十']

const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

const dayNumber = (ms: number) => Date.parse(isoDay.format(ms)) / 86_400_000

interface Props {
  items: TimelineItem[]
  loop: boolean
  onOpen: (photoId: string) => void
}

function trailing(item: TimelineItem) {
  return item.kind === 'photo' && (item.time === null || item.routeDistanceM === null)
}

export const Timeline = memo(function Timeline({ items, loop, onOpen }: Props) {
  const cut = items.findIndex(trailing)
  const main = cut < 0 ? items : items.slice(0, cut)
  const rest = cut < 0 ? [] : items.slice(cut)

  const timed = main.flatMap((item) => (item.time === null ? [] : [dayNumber(item.time)]))
  const firstDay = Math.min(...timed)
  const dayCount = timed.length ? Math.max(...timed) - firstDay + 1 : 1
  const multiDay = dayCount > 1

  let photoIndex = 0
  const row = (item: TimelineItem) => <Row key={keyOf(item)} item={item} loop={loop} tilt={TILTS[photoIndex++ % TILTS.length]!} onOpen={onOpen} />

  let day = -1
  const withDays = (item: TimelineItem) => {
    const next = item.time === null ? day : dayNumber(item.time)
    if (!multiDay || next === day) return [row(item)]

    day = next
    const n = day - firstDay + 1

    return [
      <li key={`day-${n}`} className={s.dayHead}>
        <h3>
          第 {n} 天<span>{formatDate(item.time!)}</span>
        </h3>
      </li>,
      row(item),
    ]
  }

  return (
    <section className={s.timeline} aria-labelledby="journal-day">
      <SectionTitle>
        <span id="journal-day">{multiDay ? `這${COUNT[dayCount] ?? ` ${dayCount} `}天` : '這一天'}</span>
      </SectionTitle>

      {main.length > 0 && <ol className={s.rows}>{main.flatMap(withDays)}</ol>}

      {rest.length > 0 && (
        <>
          <div className={s.restHead}>
            <h3>沒放上路線的照片</h3>
            <p>這些照片沒有拍攝時間，或離路線太遠，所以排在最後。</p>
          </div>
          <ol className={s.rows}>{rest.map(row)}</ol>
        </>
      )}
    </section>
  )
})

function keyOf(item: TimelineItem) {
  if (item.kind === 'photo') return `photo-${item.photo.id}`
  if (item.kind === 'poi') return `poi-${item.hit.poi.id}`
  return item.kind
}

function Row({ item, loop, tilt, onOpen }: { item: TimelineItem; loop: boolean; tilt: number; onOpen: (id: string) => void }) {
  return (
    <li className={s.row}>
      <span className={s.time}>{item.time === null ? '' : <time dateTime={new Date(item.time).toISOString()}>{formatTime(item.time)}</time>}</span>
      <div className={s.rowBody}>
        <Body item={item} loop={loop} tilt={tilt} onOpen={onOpen} />
      </div>
    </li>
  )
}

function Body({ item, loop, tilt, onOpen }: { item: TimelineItem; loop: boolean; tilt: number; onOpen: (id: string) => void }) {
  if (item.kind === 'photo') return <PhotoCard photo={item.photo} tilt={tilt} onOpen={onOpen} />

  if (item.kind === 'poi') {
    const { poi } = item.hit

    return (
      <div className={poi.kind === 'peak' ? s.peak : s.place}>
        <span className={s.placeName}>{poi.name}</span>
        <span className={s.placeMeta}>
          {POI_KIND[poi.kind]}
          {poi.ele !== null && `　海拔 ${formatMetres(poi.ele)} 公尺`}
        </span>
      </div>
    )
  }

  const ele = item.point.ele
  const name = item.kind === 'start' ? '出發' : loop ? '回到出發點' : '抵達終點'

  return (
    <div className={s.place}>
      <span className={s.placeName}>{name}</span>
      {ele !== null && <span className={s.placeMeta}>海拔 {formatMetres(ele)} 公尺</span>}
    </div>
  )
}

function PhotoCard({ photo, tilt, onOpen }: { photo: Photo; tilt: number; onOpen: (id: string) => void }) {
  const alt = photoAlt(photo)

  return (
    <div className={s.photoCard}>
      <Polaroid alt={alt} tilt={tilt} caption={photo.caption.trim() || undefined}>
        <LazyThumb photo={photo} alt={alt} />
      </Polaroid>
      <button type="button" className={s.photoHit} aria-label={`打開照片：${alt}`} onClick={() => onOpen(photo.id)} />
    </div>
  )
}

function LazyThumb({ photo, alt }: { photo: Photo; alt: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [url, setUrl] = useState<string>()
  const img = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '800px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return

    let gone = false
    let created: string | undefined

    void getPhotoUrl(photo.id, 'thumb').then((u) => {
      if (!u) return
      if (gone) return URL.revokeObjectURL(u)
      created = u
      setUrl(u)
    }, () => {})

    return () => {
      gone = true
      if (created) release(created, img.current)
    }
  }, [near, photo.id])

  return (
    <div ref={ref} className={s.thumb} style={{ aspectRatio: `${photo.width || 4} / ${photo.height || 3}` }}>
      {url && <img ref={(n) => void (n && (img.current = n))} src={url} alt={alt} decoding="async" />}
    </div>
  )
}
