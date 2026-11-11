import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRoute, buildTimeline, distanceM, elevationProfile } from '../../core'
import { poisAlongRoute } from '../../poi'
import { goBack, href } from '../../router'
import { TEXT_LIMITS, getTrack, getTrip, listPhotos, updateTrip } from '../../storage'
import type { ElevationProfile, Photo, PoiOnRoute, Route, Trip } from '../../types'
import {
  ActionRow,
  BackIcon,
  Button,
  DownloadIcon,
  EditIcon,
  EmptyState,
  IconButton,
  MoreIcon,
  Notice,
  PhotoIcon,
  PlayIcon,
  RouteIcon,
  Screen,
  Sheet,
  StatTile,
  TextField,
  TrashIcon,
  Dialog,
  Ridge,
  formatDateRange,
  formatDuration,
  formatKm,
  formatMetres,
  toast,
} from '../../ui'
import { useTripActions } from './actions'
import { routeSections } from './sections'
import { short } from './text'
import { applyDrafts } from './drafts'
import { useBackToClose, useOverlayHome } from './overlays'
import { Diary } from './Diary'
import { MapHero, type Scrub } from './MapHero'
import { Profile } from './Profile'
import { Timeline } from './Timeline'
import { Viewer } from './Viewer'
import s from './journal.module.css'

export interface JournalScreenProps {
  tripId: string
}

interface Data {
  trip: Trip
  photos: Photo[]
  route: Route
  profile: ElevationProfile | null
}

type State = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; data: Data }

async function read(id: string, withDrafts: boolean): Promise<Data | null> {
  let trip = await getTrip(id)
  if (!trip) return null

  let [track, photos] = await Promise.all([getTrack(id), listPhotos(id)])

  if (withDrafts && (await applyDrafts(trip, photos))) {
    trip = (await getTrip(id)) ?? trip
    photos = await listPhotos(id)
  }

  const route = buildRoute(track, photos)

  return { trip, photos, route, profile: elevationProfile(route) }
}

export function JournalScreen({ tripId }: JournalScreenProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const seq = useRef(0)
  const drafted = useRef(false)

  const reload = useCallback(async () => {
    const mine = ++seq.current

    try {
      const data = await read(tripId, !drafted.current)
      drafted.current = true
      if (mine === seq.current) setState(data ? { status: 'ready', data } : { status: 'missing' })
    } catch (e) {
      if (mine === seq.current) setState({ status: 'error', message: (e as Error).message })
    }
  }, [tripId])

  useEffect(() => {
    void reload()
  }, [reload])

  if (state.status === 'loading') return <Skeleton />

  if (state.status === 'missing') {
    return (
      <Screen>
        <EmptyState
          art={<Ridge variant="banner" />}
          title="找不到這篇回憶"
          action={
            <Button variant="dark" href={href({ name: 'home' })} icon={<BackIcon size={20} />}>
              回首頁
            </Button>
          }
        >
          它可能已經被刪除，或連結不完整。
        </EmptyState>
      </Screen>
    )
  }

  if (state.status === 'error') {
    return (
      <Screen>
        <IconButton label="回首頁" onClick={() => goBack({ name: 'home' })}>
          <BackIcon />
        </IconButton>
        <Notice
          tone="error"
          title="日誌打不開"
          action={
            <Button variant="dark" onClick={() => void reload()}>
              再試一次
            </Button>
          }
        >
          {state.message}
        </Notice>
      </Screen>
    )
  }

  return <Journal data={state.data} reload={reload} />
}

function Journal({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const { trip, photos, route, profile } = data

  const [pois, setPois] = useState<PoiOnRoute[]>([])
  const routeKey = `${route.points.length}:${route.totalDistanceM}`

  useEffect(() => {
    let gone = false
    setPois([])

    poisAlongRoute(route).then(
      (hits) => !gone && setPois(hits),
      () => {},
    )

    return () => {
      gone = true
    }
  }, [routeKey])

  const timeline = useMemo(() => buildTimeline(route, photos, pois), [route, photos, pois])
  const ordered = useMemo(() => timeline.flatMap((item) => (item.kind === 'photo' ? [item.photo] : [])), [timeline])

  const [menu, setMenu] = useState(false)
  const [editTitle, setEditTitle] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)

  const collapse = useCallback(() => setExpanded(false), [])
  const closeViewer = useCallback(() => setViewing(null), [])

  useOverlayHome(trip.id)
  useBackToClose(expanded, collapse)
  useBackToClose(viewing !== null, closeViewer)
  useBackToClose(menu, () => setMenu(false))
  useBackToClose(editTitle, () => setEditTitle(false))

  const scrub = useRef<Scrub | null>(null)
  const actions = useTripActions(trip, reload)

  const first = route.points[0]
  const last = route.points.at(-1)
  const loop = !!first && !!last && route.points.length > 1 && distanceM(first, last) < 150
  const hasMap = route.points.length > 0
  const stats = trip.stats
  const hasEle = route.points.some((p) => p.ele !== null)
  const gaps = useMemo(() => routeSections(route).slice(1).map(([p]) => p!.distanceM), [route])

  const menuAction = (fn: () => void) => () => {
    setMenu(false)
    fn()
  }

  const controls = (
    <>
      <IconButton label="回首頁" onClick={() => goBack({ name: 'home' })}>
        <BackIcon />
      </IconButton>
      <span className={s.controlsEnd}>
        {route.points.length >= 2 && (
          <Button variant="dark" href={href({ name: 'fly', id: trip.id })} icon={<PlayIcon size={18} />}>
            立體播放
          </Button>
        )}
        <IconButton label="更多選項" onClick={() => setMenu(true)}>
          <MoreIcon />
        </IconButton>
      </span>
    </>
  )

  return (
    <Screen bleed>
      {hasMap ? (
        <MapHero
          route={route}
          photos={photos}
          pois={pois}
          expanded={expanded}
          onExpand={() => setExpanded(true)}
          onCollapse={collapse}
          onOpenPhoto={setViewing}
          scrub={scrub}
          controls={controls}
        />
      ) : (
        <section className={s.noRoute} aria-label="路線地圖">
          <Ridge />
          <div className={s.controls}>{controls}</div>
        </section>
      )}

      <div className={s.sheet}>
        <header className={s.header}>
          {trip.startAt !== null && <p className={s.date}>{formatDateRange(trip.startAt, trip.endAt, true)}</p>}
          <div className={s.titleRow}>
            <h1 className={s.title}>{short(trip.title)}</h1>
            <IconButton label="修改名稱" variant="moss" onClick={() => setEditTitle(true)}>
              <EditIcon size={20} />
            </IconButton>
          </div>
        </header>

        {!hasMap && (
          <Notice
            tone="info"
            title="這趟還沒有路線"
            action={
              <Button variant="dark" icon={<RouteIcon size={20} />} onClick={actions.pickGpx}>
                匯入 GPX
              </Button>
            }
          >
            {photos.length > 0
              ? '照片裡沒有位置資訊，所以畫不出路線。匯入當天的 GPX 檔，路線和照片就會出現在地圖上。'
              : '匯入當天的 GPX 檔，或加入有位置資訊的照片，路線就會出現在地圖上。'}
          </Notice>
        )}

        {stats && (
          <div className={s.stats}>
            <StatTile label="距離" value={formatKm(stats.distanceM)} unit="公里" />
            <StatTile label="爬升" value={hasEle ? formatMetres(stats.ascentM) : '—'} unit={hasEle ? '公尺' : undefined} />
            <StatTile label="時間" value={stats.durationMs ? formatDuration(stats.durationMs) : '—'} unit={stats.durationMs ? '小時' : undefined} />
          </div>
        )}

        {route.source === 'photos' && hasMap && (
          <Notice
            tone="info"
            action={
              <Button variant="dark" icon={<RouteIcon size={20} />} onClick={actions.pickGpx}>
                匯入 GPX
              </Button>
            }
          >
            路線由照片位置連成，匯入 GPX 會更準。
          </Notice>
        )}

        {profile && <Profile profile={profile} scrub={scrub} gaps={gaps} />}

        {timeline.length > 0 ? (
          <Timeline items={timeline} loop={loop} onOpen={setViewing} />
        ) : (
          <EmptyState title="還沒有照片">從右上角的選單加入當天的照片，它們會依拍攝時間排進這一天。</EmptyState>
        )}

        <Diary tripId={trip.id} initial={trip.diary} />
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title="這篇回憶">
        <ActionRow icon={<PhotoIcon />} label="加入照片" hint="同一張照片不會重複加入" onClick={menuAction(actions.pickPhotos)} />
        <ActionRow
          icon={<RouteIcon />}
          label={trip.hasTrack ? '更換 GPX' : '匯入 GPX'}
          hint={trip.hasTrack ? '用另一個 GPX 檔取代現在的路線' : '加入當天的 GPX 檔，照片會依時間放上路線'}
          onClick={menuAction(actions.pickGpx)}
        />
        <ActionRow icon={<DownloadIcon />} label="匯出這篇回憶" hint="打包成一個檔案，可以備份或換手機" onClick={menuAction(actions.startExport)} />
        <ActionRow icon={<TrashIcon />} label="刪除這篇回憶" danger onClick={menuAction(actions.askDelete)} />
      </Sheet>

      <TitleDialog open={editTitle} trip={trip} onClose={() => setEditTitle(false)} reload={reload} />

      {actions.ui}

      {viewing !== null && (
        <Viewer
          photos={ordered}
          photoId={viewing}
          tripId={trip.id}
          coverId={trip.coverPhotoId}
          onSelect={setViewing}
          onClose={closeViewer}
          reload={reload}
        />
      )}
    </Screen>
  )
}

function TitleDialog({ open, trip, onClose, reload }: { open: boolean; trip: Trip; onClose: () => void; reload: () => Promise<void> }) {
  const [value, setValue] = useState(trip.title)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setValue(trip.title)
      setError('')
    }
  }, [open, trip.title])

  const save = async () => {
    const title = value.trim()
    if (!title) return setError('請幫這篇回憶取個名字')

    setBusy(true)

    try {
      await updateTrip(trip.id, { title })
      await reload()
      onClose()
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="修改名稱"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="dark" onClick={() => void save()} disabled={busy}>
            儲存
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <TextField
          label="這趟的名字"
          value={value}
          onChange={setValue}
          error={error || undefined}
          hint={value.length >= TEXT_LIMITS.title - 20 ? `${value.length} / ${TEXT_LIMITS.title}` : undefined}
          maxLength={TEXT_LIMITS.title}
          autoFocus
          enterKeyHint="done"
        />
      </form>
    </Dialog>
  )
}

function Skeleton() {
  return (
    <Screen bleed>
      <div className={s.hero} aria-hidden="true" />
      <div className={s.sheet} role="status" aria-label="日誌載入中">
        <span className={`${s.bone} ${s.boneDate}`} />
        <span className={`${s.bone} ${s.boneTitle}`} />
        <div className={s.stats}>
          <span className={`${s.bone} ${s.boneStat}`} />
          <span className={`${s.bone} ${s.boneStat}`} />
          <span className={`${s.bone} ${s.boneStat}`} />
        </div>
        <span className={`${s.bone} ${s.boneCard}`} />
      </div>
    </Screen>
  )
}
