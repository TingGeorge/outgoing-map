import { useEffect } from 'react'
import { getKey } from './key'
import { navigate, useRoute } from './router'
import { FlyoverScreen } from './screens/flyover'
import { HomeScreen } from './screens/home'
import { JournalScreen } from './screens/journal'
import { NewTripScreen } from './screens/new-trip'
import { SettingsScreen } from './screens/settings'
import { WelcomeScreen } from './screens/welcome'

export function App() {
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
