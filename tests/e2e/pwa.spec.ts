import { expect, test, type Page } from '@playwright/test'
import { routePixels, watch } from './helpers'

const key = process.env.THUNDERFOREST_API_KEY
const fixture = (name: string) => `tests/fixtures/${name}`
const PHOTOS = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg'].map(fixture)

async function controlled(page: Page) {
  await page.goto('')
  await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  await page.reload()
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
}

async function createTrip(page: Page) {
  await page.goto('#/new')
  await page.locator('input[type=file]').nth(0).setInputFiles(fixture('hehuan-north.gpx'))
  await page.locator('input[type=file]').nth(1).setInputFiles(PHOTOS)
  await page.getByRole('button', { name: '建立回憶' }).click()
  await page.getByRole('button', { name: '看這趟日誌' }).click({ timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: '合歡北峰' })).toBeVisible()
  return page.url()
}

test('manifest has the install fields and its icons resolve', async ({ page, request }) => {
  await page.goto('')

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const url = new URL(href!, page.url()).href
  const manifest = await (await request.get(url)).json()

  expect(manifest).toMatchObject({
    name: '登山回憶',
    lang: 'zh-Hant',
    display: 'standalone',
    start_url: './',
    scope: './',
    background_color: '#EEF1E2',
  })
  expect(manifest.icons.map((i: { purpose: string; sizes: string }) => `${i.sizes}:${i.purpose}`)).toEqual(
    expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']),
  )

  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, url).href)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  }

  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
})

test('service worker precaches every chunk, so each screen and the map library open offline', async ({ page, context }) => {
  const problems = watch(page, new URL(test.info().project.use.baseURL!).origin)
  await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff'))
  await controlled(page)

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(scope).toBe(new URL('', page.url()).href)

  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls = (await Promise.all(names.map(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname)))).flat()
    return urls
  })
  expect(cached.filter((u) => /maplibre-gl-worker-.*\.js$/.test(u))).toHaveLength(1)
  for (const chunk of ['journal', 'flyover', 'settings', 'new-trip', 'maplibre-gl']) expect(cached.some((u) => new RegExp(`/assets/${chunk}-[^/]+\\.js$`).test(u))).toBe(true)

  const journal = await createTrip(page)
  await expect(page.locator('section[aria-label="路線地圖"] canvas')).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page).toHaveTitle('登山回憶')

  for (const [hash, heading] of [
    ['#/settings', '設定'],
    ['#/new', '新的回憶'],
    ['#/', /想回味哪一座山/],
  ] as const) {
    await page.goto(hash)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }

  await page.goto(journal)
  await expect(page.getByRole('heading', { level: 1, name: '合歡北峰' })).toBeVisible()
  await expect(page.locator('section[aria-label="路線地圖"] canvas')).toBeVisible()
  await expect(page.getByText('地圖需要網路')).toBeVisible({ timeout: 20_000 })

  await context.setOffline(false)

  const ours = problems.filter((p) => p.includes('/outgoing-map/'))
  expect(ours).toEqual([])
})

test.describe('with the real key', () => {
  test.skip(!key, 'needs THUNDERFOREST_API_KEY')

  test('journal map and flyover terrain work from the production build', async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL!).origin
    const problems = watch(page, origin)
    let tiles = 0
    let workers = 0

    page.on('response', (r) => {
      if (r.url().startsWith('https://tile.thunderforest.com/') && r.ok()) tiles++
    })
    page.on('worker', (w) => {
      if (/maplibre-gl-worker-[^/]+\.js$/.test(new URL(w.url()).pathname)) workers++
    })

    await page.addInitScript((k) => localStorage.setItem('thunderforest-key', k), key!)
    await controlled(page)
    const journal = await createTrip(page)

    await expect.poll(() => tiles, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect.poll(() => routePixels(page), { timeout: 10_000 }).toBeGreaterThan(100)
    await expect(page.getByText('地圖暫時打不開')).toHaveCount(0)

    await page.getByRole('link', { name: '立體播放' }).click()
    await expect(page.locator('[data-phase]')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
    await expect(page.locator('[data-phase]')).toHaveAttribute('data-state', 'playing')

    await page.getByRole('button', { name: '關閉播放' }).click()
    await expect(page).toHaveURL(journal)
    expect(workers).toBeGreaterThan(0)

    expect(problems).toEqual([])
  })
})
