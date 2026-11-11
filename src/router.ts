import { useSyncExternalStore } from 'react'
import type { Id } from './types'

export type AppRoute =
  | { name: 'welcome' }
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'trip'; id: Id }
  | { name: 'fly'; id: Id }
  | { name: 'settings' }
  | { name: 'not-found' }

export function parseRoute(hash: string): AppRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [first, id, extra] = parts

  if (!first) return { name: 'home' }
  if (parts.length === 1 && (first === 'welcome' || first === 'new' || first === 'settings')) return { name: first }
  if (first === 'trip' && id && !extra && parts.length === 2) return { name: 'trip', id }
  if (first === 'trip' && id && extra === 'fly' && parts.length === 3) return { name: 'fly', id }
  return { name: 'not-found' }
}

export function href(route: Exclude<AppRoute, { name: 'not-found' }>): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'trip':
      return `#/trip/${encodeURIComponent(route.id)}`
    case 'fly':
      return `#/trip/${encodeURIComponent(route.id)}/fly`
    default:
      return `#/${route.name}`
  }
}

export function navigate(route: Exclude<AppRoute, { name: 'not-found' }>, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    location.replace(href(route))
  } else {
    location.hash = href(route)
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): AppRoute {
  return parseRoute(useSyncExternalStore(subscribe, () => location.hash))
}
