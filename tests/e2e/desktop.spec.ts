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

  await page.setViewportSize({ width: 960, height: 800 })
  const narrow = (await cards.first().boundingBox())!
  const cover = (await cards.first().locator('> div').first().boundingBox())!
  expect(narrow.width).toBeLessThanOrEqual(480)
  expect(cover.width).toBeGreaterThan(narrow.width - 40)
})

test('new memory and settings lay their cards out in two columns, and the create button follows the form', async ({ page }) => {
  await seed(page, 0)

  await page.goto('./#/new')
  const gpx = (await page.getByRole('heading', { name: 'GPX 檔' }).boundingBox())!
  const photos = (await page.getByRole('heading', { name: '照片' }).boundingBox())!
  expect(Math.abs(gpx.y - photos.y)).toBeLessThan(2)
  expect(photos.x).toBeGreaterThan(gpx.x + 400)

  const name = (await page.getByLabel('這趟的名字').boundingBox())!
  const create = (await page.getByRole('button', { name: '建立回憶' }).boundingBox())!
  expect(create.y).toBeGreaterThan(name.y + name.height)
  expect(create.y - (name.y + name.height)).toBeLessThan(160)
  expect(create.x + create.width).toBeCloseTo(name.x + name.width, -1)
  expect(await noSideScroll(page)).toBe(true)

  await page.goto('./#/settings')
  const key = (await page.getByRole('region', { name: '地圖鑰匙' }).boundingBox())!
  const about = (await page.getByRole('region', { name: '關於' }).boundingBox())!
  expect(about.x).toBeGreaterThan(key.x + key.width)
  expect(await noSideScroll(page)).toBe(true)
})

test('home with no memories yet puts the new memory button in the header and the steps beside the picture', async ({ page }) => {
  await seed(page, 0)
  await page.goto('./#/')

  const create = page.getByRole('link', { name: '新的回憶' })
  await expect(create).toHaveCount(1)
  const button = (await create.boundingBox())!
  const settings = (await page.getByRole('link', { name: '設定' }).boundingBox())!
  expect(Math.abs(button.y + button.height / 2 - (settings.y + settings.height / 2))).toBeLessThan(4)

  const steps = (await page.getByRole('list').first().boundingBox())!
  const scene = (await page.locator('section[aria-labelledby="first-run"] svg').last().boundingBox())!
  expect(scene.x).toBeGreaterThan(steps.x + steps.width)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(create).toHaveCount(1)
  expect((await create.boundingBox())!.y).toBeGreaterThan(600)
})

test('narrow screens like the key tutorial sit in the middle of the window', async ({ page }) => {
  await page.goto('./#/welcome')
  const main = (await page.locator('main').boundingBox())!
  expect(main.width).toBeLessThanOrEqual(600)
  expect(main.x + main.width / 2).toBeCloseTo(640, -1)
  const button = (await page.getByRole('button', { name: '開始領取' }).boundingBox())!
  expect(button.y + button.height).toBeLessThan(800)
  expect(await noSideScroll(page)).toBe(true)
})
