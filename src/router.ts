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

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part)
  } catch {
    return null
  }
}

export function parseRoute(hash: string): AppRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decode)
  if (parts.includes(null)) return { name: 'not-found' }

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

let depth = typeof history.state?.depth === 'number' ? history.state.depth : 0
let replacing = false

history.replaceState({ ...history.state, depth }, '')

addEventListener('hashchange', () => {
  if (typeof history.state?.depth === 'number') {
    depth = history.state.depth
  } else {
    if (!replacing) depth++
    history.replaceState({ ...history.state, depth }, '')
  }

  replacing = false
})

export function navigate(route: Exclude<AppRoute, { name: 'not-found' }>, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    replacing = location.hash !== href(route)
    location.replace(href(route))
  } else {
    location.hash = href(route)
  }
}

export function goBack(fallback: Exclude<AppRoute, { name: 'not-found' }>): void {
  if (guard) return guard.release(() => goBack(fallback))

  if (depth > 0) history.back()
  else navigate(fallback, { replace: true })
}

interface Guard {
  onBack: () => void
  release: (then?: () => void) => void
}

let guard: Guard | null = null

export const isBackGuarded = () => guard !== null
let ownPops: (() => void)[] = []

const onGuardEntry = () => history.state?.leaveGuard === true

addEventListener('popstate', () => {
  const own = ownPops.shift()
  if (own) return own()

  if (guard && !onGuardEntry()) {
    history.pushState({ ...history.state, leaveGuard: true }, '')
    guard.onBack()
  }
})

export function guardBack(onBack: () => void): (then?: () => void) => void {
  guard?.release()

  const mine: Guard = {
    onBack,
    release(then) {
      if (guard !== mine) return then?.()
      guard = null

      queueMicrotask(() => {
        if (guard || !onGuardEntry()) return then?.()

        ownPops.push(() => then?.())
        history.back()
      })
    },
  }

  guard = mine
  if (!onGuardEntry()) history.pushState({ ...history.state, leaveGuard: true }, '')

  return mine.release
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): AppRoute {
  return parseRoute(useSyncExternalStore(subscribe, () => location.hash))
}
