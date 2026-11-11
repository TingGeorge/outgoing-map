import { expect, test } from 'vitest'
import { href, parseRoute } from '../../src/router'

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
