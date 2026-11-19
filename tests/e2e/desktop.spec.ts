import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 })

async function seed(page: Page, trips = 3) {
  await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff'))
  await page.goto('./#/settings')

  return page.evaluate(
    async ({ trips, STORAGE, CORE }) => {
      const storage = await import(STORAGE)
      const core = await import(CORE)
      const gpx = await (await fetch('/tests/fixtures/hehuan-north.gpx')).text()
      const ids: string[] = []

      for (let i = 0; i < trips; i++) {
        const trip = await storage.createTrip({ title: `合歡北峰 ${i + 1}` })
        await storage.saveTrack(trip.id, core.parseGpx(gpx.replaceAll('2026-11-0', `2026-0${i + 1}-0`)).points)
        ids.push(trip.id)
      }

      return ids
    },
    { trips, STORAGE: '/src/storage/index.ts', CORE: '/src/core/index.ts' },
  )
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

test('the journal puts the map beside the story and keeps the map in view while scrolling', async ({ page }) => {
  const [id] = await seed(page, 1)
  await page.goto(`./#/trip/${id}`)

  const map = page.locator('section[aria-label="路線地圖"]')
  const title = page.getByRole('heading', { level: 1 })
  await expect(title).toBeVisible()

  const m = (await map.boundingBox())!
  const t = (await title.boundingBox())!
  expect(m.x).toBe(0)
  expect(m.height).toBeGreaterThan(780)
  expect(m.width).toBeGreaterThan(600)
  expect(t.x).toBeGreaterThan(m.x + m.width)
  expect(t.y).toBeLessThan(200)

  await page.mouse.move(1100, 500)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100)
  expect((await map.boundingBox())!.y).toBe(0)

  await expect(page.getByRole('button', { name: /放大地圖|展開地圖/ })).toHaveCount(0)
  expect(await noSideScroll(page)).toBe(true)
})

test('home uses the width of the window for the trips', async ({ page }) => {
  await seed(page, 5)
  await page.goto('./#/')

  const cards = page.locator('a[href^="#/trip/"]')
  await expect(cards).toHaveCount(5)

  const featured = (await cards.first().boundingBox())!
  expect(featured.width).toBeGreaterThan(900)

  const tops = await cards.evaluateAll((els) => els.slice(1).map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(40)
  expect(await noSideScroll(page)).toBe(true)
})

test('forms stay a readable width', async ({ page }) => {
  await seed(page, 0)

  for (const hash of ['#/settings', '#/new']) {
    await page.goto(`./${hash}`)
    const main = (await page.locator('main').boundingBox())!
    expect(main.width).toBeLessThanOrEqual(600)
    expect(main.x + main.width / 2).toBeCloseTo(640, -1)
    expect(await noSideScroll(page)).toBe(true)
  }
})
