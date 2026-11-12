import exifr from 'exifr'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildRoute, exifTimeToEpoch, parseGpx, trackTimeTrusted } from '../../core'
import { goBack, guardBack, navigate } from '../../router'
import { addPhotos, createTrip, deleteTrip, getTrip, listPhotos, saveTrack } from '../../storage'
import { PHOTO_TIME_TOLERANCE_MS, type Id, type PhotoImportFailure, type Route, type TrackPoint } from '../../types'
import {
  BackIcon,
  Button,
  Card,
  CheckIcon,
  ConfirmDialog,
  FilePicker,
  IconButton,
  Notice,
  PhotoIcon,
  ProgressBar,
  RouteIcon,
  Screen,
  SectionTitle,
  Spinner,
  TextField,
  formatDate,
  formatDateRange,
  formatKm,
  formatTime,
} from '../../ui'
import s from './new-trip.module.css'

interface GpxPick {
  fileName: string
  name: string | null
  points: TrackPoint[]
  route: Route
  startAt: number | null
  endAt: number | null
  distanceM: number
}

interface Summary {
  tripId: Id
  hadGpx: boolean
  byTime: number
  byPhoto: number
  unplaced: number
  failed: PhotoImportFailure[]
  offWindow: boolean
  error: string | null
}

type Phase =
  | { name: 'form' }
  | { name: 'saving'; step: string; done: number; total: number }
  | { name: 'done'; summary: Summary }

const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

const TITLE_MAX = 80

const dayOf = (ms: number) => formatDate(ms).split('　')[0]!

const clip = (text: string) => text.slice(0, TITLE_MAX).replace(/[\uD800-\uDBFF]$/, '')

function dayName(startMs: number, endMs: number | null): string {
  if (endMs === null || dayOf(endMs) === dayOf(startMs)) return dayOf(startMs)

  const [, m1, d1] = /(\d+) 月 (\d+) 日/.exec(dayOf(startMs)) ?? []
  const [, m2, d2] = /(\d+) 月 (\d+) 日/.exec(dayOf(endMs)) ?? []

  return m1 === m2 ? `${m1} 月 ${d1}–${d2} 日` : `${dayOf(startMs)} – ${dayOf(endMs)}`
}

const spansDays = (g: GpxPick) => g.startAt !== null && g.endAt !== null && dayOf(g.startAt) !== dayOf(g.endAt)

// ponytail: reads EXIF of at most 60 picked files to suggest a title and spot a GPX with made-up times; a bigger batch only uses the first 60 (storage decides with every photo).
async function photoTimes(files: File[]): Promise<number[]> {
  const text = (v: unknown) => (typeof v === 'string' ? v : null)

  const times = await Promise.all(
    files.slice(0, 60).map(async (file) => {
      const tags = await exifr
        .parse(file, { pick: ['DateTimeOriginal', 'OffsetTimeOriginal'], reviveValues: false })
        .catch(() => undefined)
      const taken = text(tags?.DateTimeOriginal)

      return taken ? exifTimeToEpoch(taken, text(tags?.OffsetTimeOriginal)) : null
    }),
  )

  return times.filter((t): t is number => t !== null)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生了預料之外的錯誤'
}

function FailureList({ failed }: { failed: PhotoImportFailure[] }) {
  return (
    <Notice tone="warning" title={`${failed.length} 個檔案沒有加入`}>
      <ul className={s.failures}>
        {failed.map((f, i) => (
          <li key={`${f.fileName}-${i}`}>
            <span className={s.fileName}>{f.fileName}</span>
            <span>{f.reason}</span>
          </li>
        ))}
      </ul>
    </Notice>
  )
}

function ResultView({ summary, onOpen }: { summary: Summary; onOpen: () => void }) {
  const { byTime, byPhoto, unplaced, failed, hadGpx, offWindow, error } = summary
  const added = byTime + byPhoto + unplaced

  return (
    <Screen
      bottom={
        <Button block onClick={onOpen}>
          {error ? '看已存下的部分' : '看這趟日誌'}
        </Button>
      }
    >
      <div aria-live="polite" className={s.stack}>
        <h1 className={s.title}>{error ? '只存到一部分' : '回憶存好了'}</h1>

        {error && (
          <Notice tone="error" title="存到一半出了問題">
            {error} 已經存下來的內容保留在這篇回憶裡。
          </Notice>
        )}

        {!error && added === 0 && hadGpx && <Notice tone="success">路線已經存好。之後可以在日誌裡再加照片。</Notice>}

        {added > 0 && (
          <Card radius="md" className={s.summary}>
            <p className={s.summaryHead}>加入了 {added} 張照片</p>
            <dl className={s.counts}>
              <div>
                <dt>依拍攝時間放上路線</dt>
                <dd>{byTime}</dd>
              </div>
              <div>
                <dt>依照片自己的位置</dt>
                <dd>{byPhoto}</dd>
              </div>
              <div>
                <dt>放不上路線</dt>
                <dd>{unplaced}</dd>
              </div>
            </dl>
          </Card>
        )}

        {offWindow && (
          <Notice tone="warning" title="照片的時間和這條路線對不上">
            多數照片不是在這條路線的時間前後半小時內拍的。可能是選到別天的照片，或相機的時間不準。照片已經加入，你可以到日誌裡刪掉，或換一個正確的 GPX。
          </Notice>
        )}

        {!hadGpx && added > 0 && <Notice tone="info">路線由照片位置連成，匯入 GPX 會更準。可以到日誌裡再匯入。</Notice>}

        {failed.length > 0 && <FailureList failed={failed} />}
      </div>
    </Screen>
  )
}

export function NewTripScreen() {
  const [phase, setPhase] = useState<Phase>({ name: 'form' })
  const [gpx, setGpx] = useState<GpxPick | null>(null)
  const [gpxError, setGpxError] = useState<string | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const [shotTimes, setShotTimes] = useState<number[]>([])
  const [title, setTitle] = useState('')
  const [titleEdited, setTitleEdited] = useState(false)
  const [formError, setFormError] = useState<{ message: string; failed: PhotoImportFailure[] } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const busy = useRef(false)
  const [today] = useState(Date.now)

  const dirty = phase.name === 'form' && (gpx !== null || photos.length > 0)
  const saving = phase.name === 'saving'

  useEffect(() => {
    let cancelled = false

    setShotTimes([])
    if (photos.length) photoTimes(photos).then((t) => !cancelled && setShotTimes(t))

    return () => {
      cancelled = true
    }
  }, [photos])

  const photoDay = shotTimes.length ? Math.min(...shotTimes) : null
  const madeUpTime = gpx !== null && !trackTimeTrusted(gpx.route, shotTimes)
  const gpxTime = madeUpTime ? null : (gpx?.startAt ?? null)

  const suggested = useMemo(() => {
    if (gpx?.name?.trim()) return clip(gpx.name.trim())
    if (gpxTime !== null) return `${dayName(gpxTime, gpx!.endAt)}的山`
    return `${dayOf(photoDay ?? today)}的山`
  }, [gpx, gpxTime, photoDay, today])

  const shownTitle = titleEdited ? title : suggested

  useEffect(() => {
    if (!dirty && !saving) return

    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving])

  const pickGpx = async (files: File[]) => {
    const file = files[0]!

    try {
      const parsed = parseGpx(await file.text())
      const route = buildRoute(parsed.points, [])

      setGpx({
        fileName: file.name,
        name: parsed.name,
        points: parsed.points,
        route,
        startAt: route.startAt,
        endAt: route.endAt,
        distanceM: route.totalDistanceM,
      })
      setGpxError(null)
    } catch (error) {
      setGpxError(`${file.name}：${errorMessage(error)}`)
    }
  }

  const addPicked = (files: File[]) => {
    setPhotos((current) => {
      const seen = new Set(current.map(fileKey))
      return [...current, ...files.filter((f) => !seen.has(fileKey(f)))]
    })
  }

  const guarded = dirty || saving
  const savingNow = useRef(saving)
  savingNow.current = saving
  const release = useRef<(then?: () => void) => void>(() => {})

  useLayoutEffect(() => {
    if (!guarded) return

    const off = guardBack(() => {
      if (!savingNow.current) setLeaving(true)
    })
    release.current = off

    return () => off()
  }, [guarded])

  const back = () => {
    if (dirty) history.back()
    else goBack({ name: 'home' })
  }

  const stay = () => setLeaving(false)

  const create = async () => {
    if (busy.current) return
    busy.current = true
    setFormError(null)

    const finalTitle = clip(shownTitle.trim()) || suggested
    let tripId: Id | null = null

    const rollback = async (message: string, failed: PhotoImportFailure[] = []) => {
      if (tripId) await deleteTrip(tripId).catch(() => {})
      setFormError({ message, failed })
      setPhase({ name: 'form' })
    }

    try {
      setPhase({ name: 'saving', step: '正在建立回憶…', done: 0, total: 0 })
      const trip = await createTrip({ title: finalTitle })
      tripId = trip.id

      if (gpx) {
        setPhase({ name: 'saving', step: '正在存路線…', done: 0, total: 0 })
        await saveTrack(trip.id, gpx.points)
      }

      let failed: PhotoImportFailure[] = []
      let addedIds = new Set<Id>()

      if (photos.length) {
        setPhase({ name: 'saving', step: '正在處理照片', done: 0, total: photos.length })

        const result = await addPhotos(trip.id, photos, (done, total) =>
          setPhase({ name: 'saving', step: '正在處理照片', done, total }),
        )
        failed = result.failed
        addedIds = new Set(result.added.map((p) => p.id))

        if (!gpx && addedIds.size === 0) {
          await rollback('沒有任何一張照片可以加入，所以沒有建立回憶。', failed)
          return
        }
      }

      const placed = (await listPhotos(trip.id)).filter((p) => addedIds.has(p.id))
      const withTime = placed.filter((p) => p.takenAt !== null)
      const start = gpx?.startAt ?? null
      const end = gpx?.endAt ?? null

      const outside =
        start !== null && end !== null && trackTimeTrusted(gpx!.route, withTime.map((p) => p.takenAt!))
          ? withTime.filter((p) => p.takenAt! < start - PHOTO_TIME_TOLERANCE_MS || p.takenAt! > end + PHOTO_TIME_TOLERANCE_MS)
          : []

      setPhase({
        name: 'done',
        summary: {
          tripId: trip.id,
          hadGpx: gpx !== null,
          byTime: placed.filter((p) => p.placement.source === 'track').length,
          byPhoto: placed.filter((p) => p.placement.source === 'exif').length,
          unplaced: placed.filter((p) => p.placement.source === 'none').length,
          failed,
          offWindow: withTime.length > 0 && outside.length / withTime.length > 0.5,
          error: null,
        },
      })
    } catch (error) {
      const message = errorMessage(error)
      const saved = tripId ? await getTrip(tripId).catch(() => undefined) : undefined

      if (!tripId || !saved || (!saved.hasTrack && saved.photoCount === 0)) {
        await rollback(`沒有建立回憶。${message}`)
        return
      }

      setPhase({
        name: 'done',
        summary: {
          tripId,
          hadGpx: saved.hasTrack,
          byTime: 0,
          byPhoto: 0,
          unplaced: saved.photoCount,
          failed: [],
          offWindow: false,
          error: message,
        },
      })
    } finally {
      busy.current = false
    }
  }

  if (phase.name === 'done') {
    const { tripId } = phase.summary
    return <ResultView summary={phase.summary} onOpen={() => navigate({ name: 'trip', id: tripId }, { replace: true })} />
  }

  if (phase.name === 'saving') {
    return (
      <Screen>
        <div className={s.stack} aria-live="polite">
          <h1 className={s.title}>正在存你的回憶</h1>
          {phase.total > 0 ? (
            <ProgressBar value={phase.done} max={phase.total} label={`${phase.step} ${phase.done} / ${phase.total}`} />
          ) : (
            <Spinner label={phase.step} />
          )}
          <p className={s.hint}>請先不要關閉或離開這個畫面。照片會一張一張縮小、讀取拍攝時間，張數多的時候要等一下。</p>
        </div>
      </Screen>
    )
  }

  const ready = gpx !== null || photos.length > 0

  const editTitle = (value: string) => {
    setTitle(value)
    setTitleEdited(true)
  }

  return (
    <Screen
      bottom={
        <Button block onClick={create} disabled={!ready}>
          建立回憶
        </Button>
      }
    >
      <div className={s.top}>
        <IconButton label="回首頁" variant="moss" onClick={back}>
          <BackIcon />
        </IconButton>
        <h1 className={s.title}>新的回憶</h1>
      </div>

      {formError && (
        <div className={s.stack}>
          <Notice tone="error" title="沒有建立成功">
            {formError.message}
          </Notice>
          {formError.failed.length > 0 && <FailureList failed={formError.failed} />}
        </div>
      )}

      <section className={s.section}>
        <SectionTitle>GPX 檔</SectionTitle>

        {gpx ? (
          <Card radius="md" className={s.picked}>
            <div className={s.pickedHead}>
              <span className={s.check}>
                <CheckIcon size={18} />
              </span>
              <span className={s.fileName}>{gpx.fileName}</span>
            </div>
            <ul className={s.facts}>
              <li>{gpx.points.length} 個定位點</li>
              {gpx.startAt !== null && !madeUpTime && (
                spansDays(gpx) ? (
                  <>
                    <li>{formatDateRange(gpx.startAt, gpx.endAt, true)}</li>
                    <li>
                      {formatTime(gpx.startAt)} 出發，{formatTime(gpx.endAt!)} 結束
                    </li>
                  </>
                ) : (
                  <li>
                    {formatDate(gpx.startAt, true)}
                    {gpx.endAt !== null && `，${formatTime(gpx.startAt)} 到 ${formatTime(gpx.endAt)}`}
                  </li>
                )
              )}
              <li>{gpx.distanceM > 0 ? `${formatKm(gpx.distanceM)} 公里` : '路線長度為 0'}</li>
              {gpx.startAt === null && <li>這個檔案沒有時間，照片只能靠自己的位置放上路線</li>}
            </ul>
            <div className={s.row}>
              <FilePicker variant="ghost" inline onFiles={pickGpx}>
                換一個檔案
              </FilePicker>
              <Button variant="ghost" inline onClick={() => setGpx(null)}>
                移除
              </Button>
            </div>
          </Card>
        ) : (
          <Card radius="md" className={s.picked}>
            <p className={s.hint}>選你登山 App 匯出的 GPX 檔。有它，路線會最準，照片也放得更準。</p>
            <FilePicker variant="dark" icon={<RouteIcon size={20} />} onFiles={pickGpx}>
              選擇 GPX 檔
            </FilePicker>
          </Card>
        )}

        {madeUpTime && <Notice tone="info">這個 GPX 檔的時間不是實際記錄的，會改用照片的時間來排列。</Notice>}

        {gpxError && (
          <Notice tone="error" title="這個檔案不能用">
            {gpxError}。請再選一次。
          </Notice>
        )}
      </section>

      <section className={s.section}>
        <SectionTitle>照片</SectionTitle>

        <Card radius="md" className={s.picked}>
          <p className={s.hint}>照片會依拍攝時間放到路線上，所以沒有位置資訊的照片，有 GPX 也放得上去。</p>
          {photos.length > 0 && (
            <p className={s.count} aria-live="polite">
              已選 {photos.length} 張照片
            </p>
          )}
          <div className={s.row}>
            <FilePicker variant="dark" icon={<PhotoIcon size={20} />} accept="image/*" multiple onFiles={addPicked}>
              {photos.length ? '再加幾張' : '選擇照片'}
            </FilePicker>
            {photos.length > 0 && (
              <Button variant="ghost" inline onClick={() => setPhotos([])}>
                全部清除
              </Button>
            )}
          </div>
        </Card>

        {!gpx && photos.length > 0 && <Notice tone="info">路線會由照片位置連成，匯入 GPX 會更準。</Notice>}
      </section>

      <section className={s.section}>
        <TextField
          label="這趟的名字"
          value={shownTitle}
          onChange={editTitle}
          maxLength={TITLE_MAX}
          enterKeyHint="done"
          hint={shownTitle.length >= TITLE_MAX - 20 ? `${shownTitle.length} / ${TITLE_MAX}` : undefined}
        />
        {!ready && <p className={s.hint}>至少選一個 GPX 檔或一張照片，才能建立。</p>}
      </section>

      <ConfirmDialog
        open={leaving}
        danger
        title="要離開嗎？"
        message="你選好的檔案還沒有存下來，離開後要重新選。"
        confirmLabel="離開"
        cancelLabel="留下來"
        onCancel={stay}
        onConfirm={() => release.current(() => goBack({ name: 'home' }))}
      />
    </Screen>
  )
}
