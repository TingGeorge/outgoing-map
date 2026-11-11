import { expect, test, vi } from 'vitest'
import { goBack, guardBack, href, isBackGuarded, parseRoute } from '../../src/router'

const fake = vi.hoisted(() => {
  const entries: { state: unknown }[] = [{ state: { depth: 0 } }, { state: null }]
  let index = 1
  let lowest = index

  const history = {
    get state() {
      return entries[index]!.state as Record<string, unknown> | null
    },
    pushState(state: unknown) {
      entries.splice(index + 1)
      entries.push({ state })
      index++
    },
    replaceState(state: unknown) {
      entries[index]!.state = state
    },
    back() {
      setTimeout(() => {
        index--
        lowest = Math.min(lowest, index)
        dispatchEvent(new Event('popstate'))
      })
    },
  }

  vi.stubGlobal('history', history)

  return {
    history,
    get index() {
      return index
    },
    get length() {
      return entries.length
    },
    get lowest() {
      return lowest
    },
  }
})

const settle = () => new Promise((r) => setTimeout(r, 5))

test('parses every route and round-trips href', () => {
  expect(parseRoute('')).toEqual({ name: 'home' })
  expect(parseRoute('#/')).toEqual({ name: 'home' })
  expect(parseRoute('#/welcome')).toEqual({ name: 'welcome' })
  expect(parseRoute('#/new')).toEqual({ name: 'new' })
  expect(parseRoute('#/settings')).toEqual({ name: 'settings' })
  expect(parseRoute('#/trip/a%20b')).toEqual({ name: 'trip', id: 'a b' })
  expect(parseRoute('#/trip/abc/fly')).toEqual({ name: 'fly', id: 'abc' })
  expect(parseRoute('#/trip')).toEqual({ name: 'not-found' })
  expect(parseRoute('#/trip/abc/x')).toEqual({ name: 'not-found' })
  expect(parseRoute(href({ name: 'fly', id: 'a/b' }))).toEqual({ name: 'fly', id: 'a/b' })
})

test('malformed escapes are not-found, never a throw', () => {
  for (const bad of ['#/trip/%', '#/trip/%E0%A4%A', '#/%zz', '#/trip/abc/%']) expect(parseRoute(bad)).toEqual({ name: 'not-found' })
})

test('leave guard: every Back is intercepted and re-armed until released', async () => {
  const onBack = vi.fn()
  const release = guardBack(onBack)
  expect([fake.index, fake.length]).toEqual([2, 3])

  fake.history.back()
  await settle()
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(fake.index).toBe(2)

  fake.history.back()
  fake.history.back()
  await settle()
  expect(onBack).toHaveBeenCalledTimes(3)
  expect(fake.lowest).toBe(1)
  expect(fake.index).toBe(2)

  release()
  await settle()
  expect(fake.index).toBe(1)

  release()
  await settle()
  expect(fake.index).toBe(1)
  expect(onBack).toHaveBeenCalledTimes(3)
})

test('leave guard: release and re-arm in one tick (StrictMode) keeps a single guard entry', async () => {
  const onBack = vi.fn()
  guardBack(() => {})()
  const release = guardBack(onBack)
  await settle()
  expect([fake.index, fake.length]).toEqual([2, 3])

  fake.history.back()
  await settle()
  expect(onBack).toHaveBeenCalledTimes(1)
  expect(fake.index).toBe(2)

  release()
  await settle()
  expect(fake.index).toBe(1)
})

test('leave guard: goBack releases the guard first, then leaves', async () => {
  const onBack = vi.fn()
  guardBack(onBack)

  goBack({ name: 'home' })
  await settle()

  expect(onBack).not.toHaveBeenCalled()
  expect(fake.index).toBe(1)
  expect(location.hash).toBe('#/')
})

test('isBackGuarded is true only while a guard is armed', async () => {
  expect(isBackGuarded()).toBe(false)

  const release = guardBack(() => {})
  expect(isBackGuarded()).toBe(true)

  release()
  expect(isBackGuarded()).toBe(false)
  await settle()
})
