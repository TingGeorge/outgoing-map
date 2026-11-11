import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateKey } from '.'

const GOOD = 'a'.repeat(32)

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const mock = vi.fn((url: string) => Promise.resolve(handler(url)))
  vi.stubGlobal('fetch', mock)
  return mock
}

function offline() {
  return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
}

afterEach(() => vi.unstubAllGlobals())

describe('validateKey', () => {
  it.each(['', '   ', 'short', 'has space inside 0123456789abcdef', 'x'.repeat(100), `${GOOD}&x=1`])(
    'rejects malformed input %j without a request',
    async (input) => {
      const mock = stubFetch(() => new Response(null, { status: 200 }))

      expect(await validateKey(input)).toBe('invalid')
      expect(mock).not.toHaveBeenCalled()
    },
  )

  it('accepts a key the tile server answers with 200, trimming whitespace', async () => {
    const mock = stubFetch(() => new Response('png', { status: 200 }))

    expect(await validateKey(`  ${GOOD}\n`)).toBe('valid')
    expect(mock.mock.calls[0]![0]).toContain(`apikey=${GOOD}`)
  })

  it('treats a readable 401 or 403 as invalid', async () => {
    stubFetch(() => new Response('{}', { status: 401 }))
    expect(await validateKey(GOOD)).toBe('invalid')

    stubFetch(() => new Response('{}', { status: 403 }))
    expect(await validateKey(GOOD)).toBe('invalid')
  })

  it('treats a server error as a network problem', async () => {
    stubFetch(() => new Response('', { status: 503 }))
    expect(await validateKey(GOOD)).toBe('network-error')
  })

  it('reads a CORS-blocked rejection as invalid when the service itself is reachable', async () => {
    const mock = vi.fn((url: string, _init?: RequestInit) =>
      url.includes('apikey=') ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response('png')),
    )
    vi.stubGlobal('fetch', mock)

    expect(await validateKey(GOOD)).toBe('invalid')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('reports network-error when nothing is reachable', async () => {
    vi.stubGlobal('fetch', offline())

    expect(await validateKey(GOOD)).toBe('network-error')
  })

  it('offline with a warm HTTP cache: network-error, never invalid', async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.cache !== 'no-store' && !url.includes('apikey=')) return Promise.resolve(new Response('cached png'))
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    vi.stubGlobal('fetch', mock)

    expect(await validateKey(GOOD)).toBe('network-error')
    expect(mock.mock.calls.map(([, init]) => init?.cache)).toEqual(['no-store', 'no-store'])
  })

  it('reports network-error on timeout without probing', async () => {
    const mock = vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    vi.stubGlobal('fetch', mock)

    expect(await validateKey(GOOD)).toBe('network-error')
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
