import { expect, test, type Page } from '@playwright/test'
import { fakeImagery, watch } from './helpers'

const FAKE_KEY = 'ffffffffffffffffffffffffffffffff'

async function setup(page: Page) {
  await page.addInitScript((key) => {
    localStorage.setItem('thunderforest-key', key)

    const live = new Set<string>()
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (o) => {
      const url = create(o)
      live.add(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      live.delete(url)
      revoke(url)
    }
    ;(window as { liveUrls?: () => number }).liveUrls = () => live.size

    let lost = 0
    addEventListener('webglcontextlost', () => lost++, true)
    ;(window as { lostContexts?: () => number }).lostContexts = () => lost
  }, FAKE_KEY)
  await page.route('https://tile.thunderforest.com/**', (route) => route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, body: '' }))
  await fakeImagery(page)
}

async function seed(page: Page): Promise<string> {
  await page.goto('./#/')
  return page.evaluate(async () => {
    const storage = await import('/src/storage/index.ts' as string)
    const core = await import('/src/core/index.ts' as string)
    const trip = await storage.createTrip({ title: '合歡北峰' })
    await storage.saveTrack(trip.id, core.parseGpx(await (await fetch('/tests/fixtures/hehuan-north.gpx')).text()).points)
    const names = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg']
    const files = await Promise.all(names.map(async (n) => new File([await (await fetch(`/tests/fixtures/${n}`)).blob()], n, { type: 'image/jpeg' })))
    await storage.addPhotos(trip.id, files)
    return trip.id as string
  })
}

test('home, journal and flyover ten times over leak no object URLs or WebGL contexts and log no errors', async ({ page, baseURL }) => {
  test.setTimeout(240_000)
  await setup(page)
  const id = await seed(page)
  await page.reload()
  const problems = watch(page, new URL(baseURL!).origin)

  for (let i = 0; i < 10; i++) {
    await page.getByRole('link', { name: /合歡北峰/ }).first().click()
    await expect(page.locator('section[aria-label="路線地圖"] canvas')).toBeVisible()
    await expect(page.locator('ol').getByRole('button', { name: /^打開照片/ })).toHaveCount(4)

    await page.getByRole('link', { name: '立體播放' }).click()
    await expect(page.locator('[data-phase]')).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
    await expect(page.locator('[data-phase]')).toHaveAttribute('data-state', 'playing')
    await expect.poll(() => page.locator('[data-distance-m]').getAttribute('data-distance-m').then(Number), { timeout: 10_000 }).toBeGreaterThan(0)

    await page.getByRole('button', { name: '關閉播放' }).click()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page.getByRole('img', { name: '合歡北峰的封面照片' })).toBeVisible()
  }

  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as { lostContexts?: () => number }).lostContexts!())).toBe(0)
  expect(await page.evaluate(() => (window as { liveUrls?: () => number }).liveUrls!())).toBeLessThanOrEqual(1)
  // ponytail: WebKit counts released (loseContext'd, detached) contexts until GC and warns after 16; live maps are guarded by lostContexts above.
  const webkitGcNoise = /too many active WebGL contexts|loseContext: context already lost/
  expect(problems.filter((p) => !p.includes('tile.thunderforest.com') && !/console: .*(401|Failed to load resource|AJAXError)/.test(p) && !webkitGcNoise.test(p))).toEqual([])
})

test('two tabs editing the same memory keep both edits', async ({ page, context }) => {
  await setup(page)
  const id = await seed(page)

  const other = await context.newPage()
  await setup(other)

  await page.goto(`./#/trip/${id}`)
  await other.goto(`./#/trip/${id}`)

  await page.getByLabel('日記').fill('第一個分頁寫的日記。')
  await expect(page.getByText('已自動儲存')).toBeVisible()

  await other.locator('ol').getByRole('button', { name: /^打開照片/ }).first().click()
  await other.getByLabel('照片說明').fill('第二個分頁寫的說明')
  await expect(other.getByText('已儲存')).toBeVisible()
  await other.getByRole('button', { name: '關閉照片' }).click()

  for (const tab of [page, other]) {
    await tab.reload()
    await expect(tab.getByLabel('日記')).toHaveValue('第一個分頁寫的日記。')
    await expect(tab.locator('ol').getByText('第二個分頁寫的說明')).toBeVisible()
  }
})
