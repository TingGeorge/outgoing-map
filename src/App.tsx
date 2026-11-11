import { Component, Suspense, lazy, useEffect, type ReactNode } from 'react'
import { getKey } from './key'
import { keepFontsOffline } from './pwa'
import { navigate, useRoute } from './router'
import { HomeScreen } from './screens/home'
import { WelcomeScreen } from './screens/welcome'
import { Button, EmptyState, Ridge, Screen, Spinner, Toaster } from './ui'

keepFontsOffline()

const NewTripScreen = lazy(() => import('./screens/new-trip').then((m) => ({ default: m.NewTripScreen })))
const JournalScreen = lazy(() => import('./screens/journal').then((m) => ({ default: m.JournalScreen })))
const FlyoverScreen = lazy(() => import('./screens/flyover').then((m) => ({ default: m.FlyoverScreen })))
const SettingsScreen = lazy(() => import('./screens/settings').then((m) => ({ default: m.SettingsScreen })))

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
          可能是網路斷了，或登山回憶剛好更新。連上網路後重新載入就好，你的回憶都還在這台裝置裡。
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
