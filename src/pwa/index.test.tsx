import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallHint, requestPersistentStorage, warmFonts } from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'

function setNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true })
  }
}

function setStandalone(on: boolean) {
  window.matchMedia = ((query: string) => ({ matches: on && query.includes('standalone') })) as typeof window.matchMedia
}

async function render() {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  await act(async () => root.render(<InstallHint />))

  return { el, root }
}

beforeEach(() => {
  localStorage.clear()
  setStandalone(false)
  setNavigator({ userAgent: DESKTOP, platform: 'MacIntel', maxTouchPoints: 0, standalone: undefined })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('requestPersistentStorage', () => {
  it('returns false when the API is missing', async () => {
    setNavigator({ storage: undefined })
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('does not ask again when already persisted', async () => {
    const persist = vi.fn()
    setNavigator({ storage: { persisted: async () => true, persist } })
    expect(await requestPersistentStorage()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('returns the answer of persist()', async () => {
    setNavigator({ storage: { persisted: async () => false, persist: async () => true } })
    expect(await requestPersistentStorage()).toBe(true)
    setNavigator({ storage: { persisted: async () => false, persist: async () => false } })
    expect(await requestPersistentStorage()).toBe(false)
  })

  it('never throws', async () => {
    setNavigator({ storage: { persisted: async () => { throw new Error('x') }, persist: async () => true } })
    expect(await requestPersistentStorage()).toBe(false)
  })
})

describe('InstallHint', () => {
  it('renders nothing on a desktop browser without an install prompt', async () => {
    const { el } = await render()
    expect(el.innerHTML).toBe('')
  })

  it('shows the share instructions on iOS Safari', async () => {
    setNavigator({ userAgent: IPHONE })
    const { el } = await render()
    expect(el.textContent).toContain('加入主畫面')
    expect(el.querySelector('svg[aria-label="分享"]')).not.toBeNull()
  })

  it('renders nothing when standalone', async () => {
    setNavigator({ userAgent: IPHONE })
    setStandalone(true)
    expect((await render()).el.innerHTML).toBe('')
    setStandalone(false)
    setNavigator({ standalone: true })
    expect((await render()).el.innerHTML).toBe('')
  })

  it('shows an install button after beforeinstallprompt and calls prompt()', async () => {
    const { el } = await render()
    const prompt = vi.fn(async () => ({}))
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt })
    await act(async () => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)

    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('安裝'))!
    await act(async () => button.click())
    expect(prompt).toHaveBeenCalled()
    expect(el.innerHTML).toBe('')
  })

  it('remembers the dismissal', async () => {
    setNavigator({ userAgent: IPHONE })
    const first = await render()
    await act(async () => first.el.querySelector<HTMLButtonElement>('button[aria-label="關閉提示"]')!.click())
    expect(first.el.innerHTML).toBe('')
    expect((await render()).el.innerHTML).toBe('')
  })
})

describe('warmFonts', () => {
  it('swallows rejected, aborted and unreadable fetches without an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    const body = { arrayBuffer: () => Promise.reject(new TypeError('body')) }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('due to access control checks'))
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockResolvedValueOnce(body)
    vi.stubGlobal('fetch', fetchMock)

    await warmFonts(['https://fonts.gstatic.com/a', 'https://fonts.gstatic.com/b', 'https://fonts.gstatic.com/c', 'https://fonts.gstatic.com/a'], new AbortController().signal)
    await new Promise((r) => setTimeout(r, 20))

    process.off('unhandledRejection', unhandled)
    vi.unstubAllGlobals()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(unhandled).not.toHaveBeenCalled()
  })
})
