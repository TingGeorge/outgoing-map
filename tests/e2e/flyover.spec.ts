import { expect, test, type Page } from '@playwright/test'

const READY = { timeout: 60_000 }

test.describe.configure({ timeout: 120_000 })

interface Seeded {
  id: string
  stops: string[]
}

async function seed(page: Page, { photos = true, points = 'all' as 'all' | 'one' } = {}): Promise<Seeded> {
  await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff'))
  await page.goto('./#/settings')

  return page.evaluate(
    async ({ photos, points, STORAGE, CORE }) => {
      const storage = await import(STORAGE)
      const core = await import(CORE)

      const trip = await storage.createTrip({ title: '合歡北峰' })
      const track = core.parseGpx(await (await fetch('/tests/fixtures/hehuan-north.gpx')).text()).points
      await storage.saveTrack(trip.id, points === 'one' ? track.slice(0, 1) : track)

      if (photos) {
        const names = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg']
        const files = await Promise.all(names.map(async (n) => new File([await (await fetch(`/tests/fixtures/${n}`)).blob()], n, { type: 'image/jpeg' })))
        await storage.addPhotos(trip.id, files)
      }

      const placed = (await storage.listPhotos(trip.id))
        .filter((p: { placement: { source: string } }) => p.placement.source !== 'none')
        .sort((a: { placement: { routeDistanceM: number } }, b: { placement: { routeDistanceM: number } }) => a.placement.routeDistanceM - b.placement.routeDistanceM)

      return { id: trip.id as string, stops: placed.map((p: { id: string }) => p.id) }
    },
    { photos, points, STORAGE: '/src/storage/index.ts', CORE: '/src/core/index.ts' },
  )
}

const root = (page: Page) => page.locator('[data-phase]')
const distance = async (page: Page) => Number(await page.locator('[data-distance-m]').getAttribute('data-distance-m'))
const popup = (page: Page) => page.getByRole('button', { name: '放大這張照片' })

async function open(page: Page, id: string) {
  await page.goto(`./#/trip/${id}/fly`)
  await expect(root(page)).toHaveAttribute('data-phase', 'ready', READY)
}

test('plays, advances, pauses, and a photo pops up when the flight reaches it', async ({ page }) => {
  const { id, stops } = await seed(page)
  await open(page, id)

  await expect(root(page)).toHaveAttribute('data-state', 'playing')
  await expect.poll(() => distance(page), { timeout: 20_000 }).toBeGreaterThan(0)

  await expect(popup(page)).toHaveAttribute('data-photo-id', stops[0]!, { timeout: 30_000 })
  await expect(page.getByText(`第 1 張，共 ${stops.length} 張`)).toBeVisible()

  await page.getByRole('button', { name: '暫停' }).click()
  await expect(root(page)).toHaveAttribute('data-state', 'paused')
  const paused = await distance(page)
  await page.waitForTimeout(2000)
  expect(await distance(page)).toBe(paused)

  await page.keyboard.press('Space')
  await expect(root(page)).toHaveAttribute('data-state', 'playing')
})

test('next and previous jump to the right stop and photo', async ({ page }) => {
  const { id, stops } = await seed(page)
  await open(page, id)
  await page.getByRole('button', { name: '暫停' }).click()

  const next = page.getByRole('button', { name: '下一張照片' })
  const prev = page.getByRole('button', { name: '上一張照片' })

  await next.click()
  await expect(popup(page)).toHaveAttribute('data-photo-id', stops[0]!)
  await next.click()
  await next.click()
  await expect(popup(page)).toHaveAttribute('data-photo-id', stops[2]!)
  await expect(page.getByText(`第 3 張，共 ${stops.length} 張`)).toBeVisible()

  await prev.click()
  await expect(popup(page)).toHaveAttribute('data-photo-id', stops[1]!)

  await page.keyboard.press('ArrowRight')
  await expect(popup(page)).toHaveAttribute('data-photo-id', stops[2]!)
  await expect(root(page)).toHaveAttribute('data-state', 'paused')

  await popup(page).click()
  await expect(page.getByRole('dialog', { name: '照片' })).toBeVisible()
  await page.getByRole('button', { name: '關閉照片' }).click()
  await expect(page.getByRole('dialog', { name: '照片' })).toBeHidden()
  await expect(popup(page)).toBeVisible()
})

test('seeking on the scrubber moves the flight and the end offers a replay', async ({ page }) => {
  const { id } = await seed(page, { photos: false })
  await open(page, id)

  await expect(page.getByText(/共 \d+ 張/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下一張照片' })).toHaveCount(0)

  const slider = page.getByRole('slider', { name: '播放進度與海拔剖面' })
  await page.getByRole('button', { name: '暫停' }).click()

  const box = (await slider.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(slider).toHaveAttribute('aria-valuenow', /^(4[89]|5[0-2])$/)
  expect(await distance(page)).toBeGreaterThan(1600)
  expect(await distance(page)).toBeLessThan(2100)
  await expect(root(page)).toHaveAttribute('data-state', 'paused')

  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.mouse.click(box.x + box.width * 0.995, box.y + box.height / 2)
  await expect(page.getByRole('button', { name: '重新播放' })).toBeVisible({ timeout: 20_000 })
  await expect(root(page)).toHaveAttribute('data-state', 'ended')

  await page.getByRole('button', { name: '重新播放' }).click()
  await expect(root(page)).toHaveAttribute('data-state', 'playing')
  await expect.poll(() => distance(page), { timeout: 10_000 }).toBeLessThan(500)
})

test('with reduced motion it does not auto-play and still steps through photos', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { id, stops } = await seed(page)
  await open(page, id)

  await page.waitForTimeout(2500)
  await expect(root(page)).toHaveAttribute('data-state', 'paused')
  expect(await distance(page)).toBe(0)

  await page.getByRole('button', { name: '下一張照片' }).click()
  await expect(popup(page)).toHaveAttribute('data-photo-id', stops[0]!)
})

test('close and Escape return to the journal, also when the player was opened from a link', async ({ page }) => {
  const { id } = await seed(page, { photos: false })
  await page.goto('about:blank')
  await open(page, id)

  await page.getByRole('button', { name: '關閉播放' }).click()
  await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))

  await open(page, id)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
})

test('a route with fewer than two points explains itself', async ({ page }) => {
  const { id } = await seed(page, { photos: false, points: 'one' })
  await page.goto(`./#/trip/${id}/fly`)

  await expect(page.getByRole('heading', { name: '路線太短，沒辦法播放' })).toBeVisible()
  await expect(page.getByRole('link', { name: '回到日誌' })).toHaveAttribute('href', `#/trip/${id}`)
})

test('an unknown trip is friendly and links home', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff'))
  await page.goto('./#/trip/no-such-trip/fly')

  await expect(page.getByRole('heading', { name: '找不到這篇回憶' })).toBeVisible()
  await expect(page.getByRole('link', { name: '回首頁' })).toHaveAttribute('href', '#/')
})

test('without the tile servers it says the 3D view needs a network connection', async ({ page }) => {
  const { id } = await seed(page, { photos: false })
  await page.route(/wmts\.nlsc\.gov\.tw|elevation-tiles-prod/, (route) => route.abort('internetdisconnected'))
  await page.goto(`./#/trip/${id}/fly`)

  await expect(page.getByText('立體畫面需要網路連線').first()).toBeVisible(READY)
})

test('when no imagery loads at all it does not fly over nothing and offers a retry', async ({ page }) => {
  const { id } = await seed(page, { photos: false })
  await page.route(/wmts\.nlsc\.gov\.tw/, () => {})
  await page.goto(`./#/trip/${id}/fly`)

  await expect(root(page)).toHaveAttribute('data-phase', 'network', READY)
  await expect(page.getByText('立體畫面需要網路連線')).toBeVisible()
  await expect(page.getByText(/部分/)).toHaveCount(0)

  await page.unroute(/wmts\.nlsc\.gov\.tw/)
  await page.getByRole('button', { name: '再試一次' }).click()
  await expect(root(page)).toHaveAttribute('data-phase', 'ready', READY)
})

test('when only some imagery fails it plays and says part of it is missing', async ({ page }) => {
  const { id } = await seed(page, { photos: false })
  let n = 0
  await page.route(/wmts\.nlsc\.gov\.tw/, (route) => (n++ % 2 ? route.abort('internetdisconnected') : route.continue()))
  await open(page, id)

  await expect(page.getByText(/網路不穩，部分地形或空拍影像沒有載入/)).toBeVisible(READY)
})

async function hikerInView(page: Page) {
  const hiker = (await page.locator('.maplibregl-marker').last().boundingBox())!
  const card = (await page.locator('[class*="card"]').first().boundingBox())!
  const top = (await page.getByRole('button', { name: '關閉播放' }).boundingBox())!
  const y = hiker.y + hiker.height / 2
  return { y, cardTop: card.y, topBottom: top.y + top.height, cardHeight: card.height }
}

test('in landscape the controls stay compact and the hiker stays in view, also after rotating mid-flight', async ({ page }) => {
  const { id } = await seed(page, { photos: false })

  for (const [w, h] of [
    [844, 390],
    [932, 430],
  ] as const) {
    await page.setViewportSize({ width: w, height: h })
    await open(page, id)
    await page.waitForTimeout(5500)

    const v = await hikerInView(page)
    expect(v.cardHeight).toBeLessThan(h * 0.36)
    expect(v.y).toBeGreaterThan(v.topBottom)
    expect(v.y).toBeLessThan(v.cardTop - 12)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(1500)
  let v = await hikerInView(page)
  expect(v.y).toBeGreaterThan(v.topBottom)
  expect(v.y).toBeLessThan(v.cardTop - 12)

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(1500)
  v = await hikerInView(page)
  expect(v.y).toBeGreaterThan(v.topBottom)
  expect(v.y).toBeLessThan(v.cardTop - 12)
})

test('attribution links have a comfortable target and open in a new tab', async ({ page }) => {
  const { id } = await seed(page, { photos: false })
  await open(page, id)

  for (const name of ['內政部國土測繪中心', 'Mapzen']) {
    const link = page.getByRole('link', { name })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener')

    const box = (await link.boundingBox())!
    const hit = await page.evaluate(
      ({ x, top, bottom }) => [top, bottom].map((y) => document.elementFromPoint(x, y)?.closest('a')?.textContent ?? ''),
      { x: box.x + box.width / 2, top: box.y + box.height / 2 - 11, bottom: box.y + box.height / 2 + 11 },
    )
    expect(hit).toEqual([name, name])
  }
})
