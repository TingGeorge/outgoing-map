import { Component, Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react'
import { getKey } from './key'
import { keepFontsOffline } from './pwa'
import { navigate, parseRoute, useRoute } from './router'
import { HomeScreen } from './screens/home'
import { WelcomeScreen } from './screens/welcome'
import { Button, EmptyState, Ridge, Screen, Spinner, Toaster } from './ui'

keepFontsOffline()

const RELOAD_MARK = 'chunk-reload'
const RELOAD_WINDOW_MS = 60_000

let current = parseRoute(location.hash).name
let origin = current

addEventListener('hashchange', () => {
  origin = current
  current = parseRoute(location.hash).name
})

function mayReload() {
  if (navigator.onLine === false || origin === 'new') return false

  try {
    const mark = JSON.parse(sessionStorage.getItem(RELOAD_MARK) ?? 'null')
    if (mark?.hash === location.hash && Date.now() - mark.at < RELOAD_WINDOW_MS) return false

    sessionStorage.setItem(RELOAD_MARK, JSON.stringify({ hash: location.hash, at: Date.now() }))
  } catch {
    return false
  }

  return true
}

function lazyScreen<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e) => {
      if (!mayReload()) throw e

      location.reload()
      return new Promise<never>(() => {})
    }),
  )
}

const NewTripScreen = lazyScreen(() => import('./screens/new-trip').then((m) => ({ default: m.NewTripScreen })))
const JournalScreen = lazyScreen(() => import('./screens/journal').then((m) => ({ default: m.JournalScreen })))
const FlyoverScreen = lazyScreen(() => import('./screens/flyover').then((m) => ({ default: m.FlyoverScreen })))
const SettingsScreen = lazyScreen(() => import('./screens/settings').then((m) => ({ default: m.SettingsScreen })))

function Loading() {
  return (
    <Screen className="screen-loading">
      <Spinner label="載入中" />
    </Screen>
  )
}

class ScreenError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <Screen>
        <EmptyState art={<Ridge variant="banner" />} title="這個畫面沒有打開" action={<Button onClick={() => location.reload()}>重新載入</Button>}>
          {navigator.onLine === false
            ? '現在沒有連上網路，這個畫面還沒載入。連上網路後重新載入就好，你的回憶都還在這台裝置裡。'
            : '可能是網路斷了，或登山回憶剛好更新。連上網路後重新載入就好，你的回憶都還在這台裝置裡。'}
        </EmptyState>
      </Screen>
    )
  }
}

function Routes() {
  const route = useRoute()
  const needsKey = !getKey() && route.name !== 'welcome' && route.name !== 'settings'

  useEffect(() => {
    if (needsKey) navigate({ name: 'welcome' }, { replace: true })
    else if (route.name === 'not-found') navigate({ name: 'home' }, { replace: true })
  }, [needsKey, route.name])

  const routeId = 'id' in route ? route.id : null

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.name, routeId])

  if (needsKey) return null

  switch (route.name) {
    case 'welcome':
      return <WelcomeScreen />
    case 'home':
      return <HomeScreen />
    case 'new':
      return <NewTripScreen />
    case 'trip':
      return <JournalScreen key={route.id} tripId={route.id} />
    case 'fly':
      return <FlyoverScreen key={route.id} tripId={route.id} />
    case 'settings':
      return <SettingsScreen />
    case 'not-found':
      return null
  }
}

export function App() {
  const route = useRoute()

  return (
    <>
      <ScreenError key={route.name}>
        <Suspense fallback={<Loading />}>
          <Routes />
        </Suspense>
      </ScreenError>
      <Toaster />
    </>
  )
}
