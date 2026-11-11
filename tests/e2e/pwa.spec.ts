import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
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

test('after one first visit, the handwritten headings still use the web font offline', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff'))
  await page.goto('')
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const loaded = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith('https://fonts.g'))
          const cached = (await Promise.all((await caches.keys()).map(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url)))).flat()
          return loaded.length > 0 && loaded.every((u) => cached.includes(u))
        }),
      { timeout: 20_000 },
    )
    .toBe(true)

  await context.setOffline(true)
  await page.reload()

  const fonts = await page.evaluate(async () => {
    const h1 = document.querySelector('h1')!
    const faces = await document.fonts.load(`700 ${getComputedStyle(h1).fontSize} "LXGW WenKai TC"`, h1.textContent!)
    await document.fonts.ready
    return { faces: faces.map((f) => f.status), errors: [...document.fonts].filter((f) => f.family === 'LXGW WenKai TC' && f.status === 'error').length }
  })

  await context.setOffline(false)
  expect(fonts.faces.length).toBeGreaterThan(0)
  expect(fonts.faces.every((s) => s === 'loaded')).toBe(true)
  expect(fonts.errors).toBe(0)
})

function buildWithMark(dir: string) {
  mkdirSync(dir, { recursive: true })
  const config = `${dir}.config.ts`

  writeFileSync(
    config,
    `import { mergeConfig } from 'vite'
import base from '${resolve('vite.config.ts')}'
export default mergeConfig(base, {
  plugins: [{
    name: 'build-mark',
    transformIndexHtml: (html: string) => html.replace('</head>', '<meta name="build-mark" content="B" /></head>'),
    transform: (code: string, id: string) => (/src\\/screens\\/[^/]+\\/index\\.tsx$/.test(id) ? code + ';globalThis.buildMark = "B"' : null),
  }],
})
`,
  )

  execFileSync('npx', ['vite', 'build', '--config', config, '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], { stdio: 'inherit' })
}

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
}

async function serve() {
  const state = { root: process.env.E2E_DIST ?? 'dist' }

  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname)
    const file = path.startsWith('/outgoing-map/') && join(state.root, path.slice('/outgoing-map/'.length) || 'index.html')

    if (!file || file.includes('..') || !existsSync(file) || !extname(file)) {
      res.writeHead(404).end()
      return
    }

    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(readFileSync(file))
  })

  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  return { state, port, close: () => new Promise((r) => server.close(r)) }
}

async function settingsAfterUpdate(page: Page) {
  await page.getByRole('link', { name: '設定' }).click()
  const settings = page.getByRole('heading', { level: 1, name: '設定' })
  const failed = page.getByText('這個畫面沒有打開')
  await expect(settings.or(failed)).toBeVisible()

  if (await failed.isVisible()) {
    test.info().annotations.push({ type: 'path', description: 'old chunk failed, reload recovered' })
    await page.getByRole('button', { name: '重新載入' }).click()
    await expect(settings).toBeVisible()
  }

  await expect(page.locator('meta[name=build-mark]')).toHaveCount(1)
}

test('an open app and a relaunched app both move to a new build without a stale shell or a white screen', async ({ page, context, browser }, info) => {
  test.setTimeout(180_000)

  const B = resolve('node_modules/.cache/update-build', `${info.project.name}-${info.parallelIndex}`)
  buildWithMark(B)
  const settingsChunk = (dir: string) => readdirSync(join(dir, 'assets')).find((f) => /^settings-.*\.js$/.test(f))!
  const chunks = { now: settingsChunk(B), old: settingsChunk(process.env.E2E_DIST ?? 'dist') }
  expect(chunks.now).not.toBe(chunks.old)

  const server = await serve()
  const app = `http://localhost:${server.port}/outgoing-map/`

  const closed = await browser.newContext(info.project.use)

  try {
    for (const p of [page, await closed.newPage()]) {
      await p.addInitScript(() => localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff'))
      await p.goto(app)
      await p.evaluate(async () => (await navigator.serviceWorker.ready).scope)
      await p.reload()
      await expect(p.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()
      await expect(p.locator('meta[name=build-mark]')).toHaveCount(0)
    }

    await closed.pages()[0]!.close()

    server.state.root = B

    const updated = (p: Page) =>
      p.evaluate(async ({ now, old }) => {
        await (await navigator.serviceWorker.getRegistration())?.update().catch(() => {})
        const urls = (await Promise.all((await caches.keys()).map(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url)))).flat()
        return urls.some((u) => u.endsWith(now)) && !urls.some((u) => u.endsWith(old))
      }, chunks)

    await expect.poll(() => updated(page), { timeout: 30_000 }).toBe(true)

    await settingsAfterUpdate(page)
    await page.close()

    const relaunched = await context.newPage()
    await relaunched.goto(app)
    await expect(relaunched.locator('meta[name=build-mark]')).toHaveCount(1)
    await expect(relaunched.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()

    for (const [hash, heading] of [['#/new', '新的回憶'], ['#/settings', '設定']] as const) {
      await relaunched.goto(app + hash)
      await expect(relaunched.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    }

    const stale = await closed.newPage()
    await stale.goto(app)
    await expect(stale.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()
    await expect.poll(() => updated(stale), { timeout: 30_000 }).toBe(true)
    await settingsAfterUpdate(stale)
  } finally {
    await closed.close()
    await server.close()
  }
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
