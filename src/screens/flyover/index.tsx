import { useEffect, useState } from 'react'
import { buildRoute, elevationProfile } from '../../core'
import { href } from '../../router'
import { getTrack, getTrip, listPhotos } from '../../storage'
import type { ElevationProfile, Photo, Trip } from '../../types'
import { BackIcon, Button, EmptyState, Ridge, Screen } from '../../ui'
import { buildTimeline, resamplePath, type Path, type Timeline } from './flight'
import { Player } from './player'

export interface FlyoverScreenProps {
  tripId: string
}

export interface FlightData {
  trip: Trip
  path: Path
  timeline: Timeline
  stops: Photo[]
  profile: ElevationProfile | null
}

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'short'; trip: Trip } | { kind: 'error'; message: string } | { kind: 'ready'; data: FlightData }

async function load(tripId: string): Promise<Load> {
  const [trip, track, photos] = await Promise.all([getTrip(tripId), getTrack(tripId), listPhotos(tripId)])
  if (!trip) return { kind: 'missing' }

  const route = buildRoute(track, photos)
  if (route.points.length < 2 || route.totalDistanceM < 1) return { kind: 'short', trip }

  const stops = photos
    .filter((p) => p.placement.source !== 'none')
    .sort((a, b) => routeDistance(a) - routeDistance(b))

  return {
    kind: 'ready',
    data: {
      trip,
      path: resamplePath(route),
      timeline: buildTimeline(route.totalDistanceM, stops.map(routeDistance)),
      stops,
      profile: elevationProfile(route, 160),
    },
  }
}

const routeDistance = (p: Photo) => (p.placement.source === 'none' ? 0 : p.placement.routeDistanceM)

export function FlyoverScreen({ tripId }: FlyoverScreenProps) {
  const [state, setState] = useState<Load>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    load(tripId)
      .then((s) => live && setState(s))
      .catch((e: unknown) => live && setState({ kind: 'error', message: e instanceof Error ? e.message : '無法讀取這篇回憶。' }))

    return () => {
      live = false
    }
  }, [tripId])

  if (state.kind === 'ready') return <Player tripId={tripId} data={state.data} />

  if (state.kind === 'loading') return <Player tripId={tripId} data={null} />

  const journal = href({ name: 'trip', id: tripId })

  return (
    <Screen>
      <h1 className="visually-hidden">立體播放</h1>
      {state.kind === 'missing' && (
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
      )}
      {state.kind === 'short' && (
        <EmptyState
          art={<Ridge variant="banner" />}
          title="路線太短，沒辦法播放"
          action={
            <Button variant="dark" href={journal} icon={<BackIcon size={20} />}>
              回到日誌
            </Button>
          }
        >
          「{state.trip.title}」的路線少於兩個點。匯入這趟的 GPX 檔，或加入幾張有定位的照片，就能在立體地形上重播。
        </EmptyState>
      )}
      {state.kind === 'error' && (
        <EmptyState
          art={<Ridge variant="banner" />}
          title="沒辦法打開這篇回憶"
          action={
            <Button variant="dark" href={journal} icon={<BackIcon size={20} />}>
              回到日誌
            </Button>
          }
        >
          {state.message}
        </EmptyState>
      )}
    </Screen>
  )
}
