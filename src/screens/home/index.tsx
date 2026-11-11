import { useEffect, useState } from 'react'
import { InstallHint, requestPersistentStorage } from '../../pwa'
import { href } from '../../router'
import { getPhotoUrl, listTrips } from '../../storage'
import type { Trip } from '../../types'
import {
  Button,
  Card,
  Chip,
  IconButton,
  Notice,
  PlusIcon,
  Polaroid,
  Ridge,
  Screen,
  SectionTitle,
  SettingsIcon,
  Spinner,
  formatDate,
  formatKm,
  formatMetres,
  formatTime,
} from '../../ui'
import s from './home.module.css'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; trips: Trip[] }

function greeting(now: number): string {
  const hour = Number(formatTime(now).slice(0, 2))

  if (hour >= 5 && hour < 11) return '早安，'
  if (hour >= 11 && hour < 17) return '午安，'
  if (hour >= 17 && hour < 22) return '晚上好，'
  return '夜深了，'
}

function tripDate(trip: Trip): number {
  return trip.startAt ?? trip.createdAt
}

function useCover(trip: Trip, size: 'full' | 'thumb'): string | undefined {
  const [url, setUrl] = useState<string>()
  const photoId = trip.coverPhotoId

  useEffect(() => {
    if (!photoId) return

    let cancelled = false
    let made: string | undefined

    getPhotoUrl(photoId, size)
      .then((next) => {
        if (cancelled) {
          if (next) URL.revokeObjectURL(next)
          return
        }
        made = next
        setUrl(next)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
      setUrl(undefined)
    }
  }, [photoId, size])

  return url
}

function Scene({ seed }: { seed: string }) {
  const warm = seed.charCodeAt(0) % 2 === 1

  if (warm) {
    return (
      <svg aria-hidden="true" viewBox="0 0 140 104" preserveAspectRatio="xMidYMid slice">
        <rect width="140" height="104" fill="#F6E2C6" />
        <circle cx="104" cy="34" r="14" fill="#F3C48D" />
        <path d="M0 78 L40 50 L72 72 L106 54 L140 76 L140 104 L0 104 Z" fill="#C7B48F" />
        <path d="M0 90 Q70 76 140 92 L140 104 L0 104 Z" fill="#A9B98E" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 140 104" preserveAspectRatio="xMidYMid slice">
      <rect width="140" height="104" fill="#D5E3EA" />
      <path d="M0 70 L34 38 L58 60 L88 26 L140 74 L140 104 L0 104 Z" fill="#9DB7A0" />
      <path d="M88 26 L98 36 L90 40 L82 34 Z" fill="#FBFBF4" />
      <path d="M0 84 Q70 66 140 88 L140 104 L0 104 Z" fill="#7C9A7A" />
    </svg>
  )
}

function Cover({ trip, url }: { trip: Trip; url: string | undefined }) {
  return url ? <img className={s.coverImage} src={url} alt={`${trip.title}的封面照片`} /> : <Scene seed={trip.id} />
}

function FeaturedTrip({ trip }: { trip: Trip }) {
  const url = useCover(trip, 'full')
  const stats = trip.stats

  return (
    <Card href={href({ name: 'trip', id: trip.id })} radius="lg" elevated className={s.recent}>
      <div className={s.cover}>
        <Cover trip={trip} url={url} />
        <span className={s.badge}>
          <Chip tone="paper">最近一趟</Chip>
        </span>
      </div>
      <div className={s.recentBody}>
        <div className={s.recentTitleRow}>
          <h2 className={s.recentTitle}>{trip.title}</h2>
          <span className={s.muted}>{formatDate(tripDate(trip))}</span>
        </div>
        <div className={s.chips}>
          {stats && stats.distanceM > 0 && <Chip>{formatKm(stats.distanceM)} 公里</Chip>}
          {stats && stats.ascentM > 0 && <Chip>爬升 {formatMetres(stats.ascentM)} 公尺</Chip>}
          {trip.photoCount > 0 && <Chip tone="sun">{trip.photoCount} 張照片</Chip>}
        </div>
      </div>
    </Card>
  )
}

function EarlierTrip({ trip, index }: { trip: Trip; index: number }) {
  const url = useCover(trip, 'thumb')

  return (
    <a className={s.polaroidLink} href={href({ name: 'trip', id: trip.id })}>
      <Polaroid
        alt={trip.title}
        size="sm"
        tilt={index % 2 === 0 ? -2.5 : 2}
        caption={trip.title}
        meta={formatDate(tripDate(trip))}
      >
        <div className={s.thumb}>
          {url ? <img src={url} alt={`${trip.title}的封面照片`} loading="lazy" decoding="async" /> : <Scene seed={trip.id} />}
        </div>
      </Polaroid>
    </a>
  )
}

function FirstRun() {
  return (
    <section className={s.welcome} aria-labelledby="first-run">
      <h2 id="first-run" className={s.welcomeTitle}>
        把走過的山，變成一篇日誌
      </h2>
      <p className={s.welcomeText}>不用在山上開這個 App，照平常的方式爬山就好。</p>
      <ol className={s.steps}>
        <li>
          <span className={s.num} aria-hidden="true">
            1
          </span>
          <span>爬山時，用自己的登山 App 記錄路線、用手機或相機拍照。</span>
        </li>
        <li>
          <span className={s.num} aria-hidden="true">
            2
          </span>
          <span>回到家，把 GPX 檔和照片匯入這裡。</span>
        </li>
        <li>
          <span className={s.num} aria-hidden="true">
            3
          </span>
          <span>照片會依拍攝時間放到路線上，得到一篇日誌。</span>
        </li>
      </ol>
      <div className={s.scene}>
        <Ridge variant="banner" />
      </div>
    </section>
  )
}

function Skeleton() {
  return (
    <div className={s.skeleton}>
      <Spinner label="正在讀取你的回憶" />
    </div>
  )
}

export function HomeScreen() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [now] = useState(Date.now)

  useEffect(() => {
    let cancelled = false

    listTrips().then(
      (trips) => {
        if (!cancelled) setLoad({ status: 'ready', trips })
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: error instanceof Error ? error.message : '讀取失敗' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [attempt])

  const hasTrips = load.status === 'ready' && load.trips.length > 0

  useEffect(() => {
    if (hasTrips) void requestPersistentStorage()
  }, [hasTrips])

  const retry = () => {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  return (
    <Screen
      bottom={
        <Button href={href({ name: 'new' })} icon={<PlusIcon size={20} />}>
          新的回憶
        </Button>
      }
    >
      <Ridge />

      <header className={s.header}>
        <div className={s.titles}>
          <div className={s.date}>{formatDate(now)}</div>
          <h1 className={s.title}>
            {greeting(now)}
            <br />
            想回味哪一座山？
          </h1>
        </div>
        <IconButton label="設定" href={href({ name: 'settings' })}>
          <SettingsIcon />
        </IconButton>
      </header>

      {load.status === 'loading' && <Skeleton />}

      {load.status === 'error' && (
        <Notice
          tone="error"
          title="讀不到你的回憶"
          action={
            <Button variant="dark" onClick={retry}>
              再試一次
            </Button>
          }
        >
          {load.message}
        </Notice>
      )}

      {load.status === 'ready' && load.trips.length === 0 && <FirstRun />}

      {load.status === 'ready' && load.trips.length > 0 && (
        <>
          <FeaturedTrip trip={load.trips[0]!} />

          {load.trips.length > 1 && (
            <section className={s.earlier}>
              <SectionTitle>更早的回憶</SectionTitle>
              <div className={s.polaroids}>
                {load.trips.slice(1).map((trip, i) => (
                  <EarlierTrip key={trip.id} trip={trip} index={i} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <InstallHint />
    </Screen>
  )
}
