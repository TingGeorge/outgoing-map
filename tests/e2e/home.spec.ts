import { expect, test, type Page } from '@playwright/test'

const STORAGE = '/src/storage/index.ts'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff')
      sessionStorage.setItem('seeded', '1')
    }
  })
})

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

test('first run: explains the three steps and offers the main button', async ({ page }) => {
  await page.goto('./#/')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('想回味哪一座山？')
  await expect(page.getByRole('heading', { name: '把走過的山，變成一篇日誌' })).toBeVisible()
  await expect(page.getByText('爬山時，用自己的登山 App 記錄路線')).toBeVisible()
  await expect(page.getByText('把 GPX 檔和照片匯入這裡')).toBeVisible()
  await expect(page.getByRole('link', { name: '設定' })).toHaveAttribute('href', '#/settings')
  await noHorizontalScroll(page)

  await page.getByRole('link', { name: '新的回憶' }).click()
  await expect(page).toHaveURL(/#\/new$/)
})

test('a created trip shows on home with title, date and chips, and survives a reload', async ({ page }) => {
  await page.goto('./#/new')
  await page.locator('input[type=file]').nth(0).setInputFiles('tests/fixtures/hehuan-north.gpx')
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg'].map((n) => `tests/fixtures/${n}`))
  await page.getByRole('button', { name: '建立回憶' }).click()
  await page.getByRole('button', { name: '看這趟日誌' }).click()
  await expect(page).toHaveURL(/#\/trip\//)

  await page.goto('./#/')
  const card = page.getByRole('link', { name: /合歡北峰/ })
  await expect(card).toContainText('11 月 7 日')
  await expect(card).toContainText('公里')
  await expect(card).toContainText('4 張照片')
  await expect(card.getByRole('img', { name: '合歡北峰的封面照片' })).toBeVisible()
  await expect(card).toHaveAttribute('href', /#\/trip\//)

  await page.reload()
  await expect(page.getByRole('link', { name: /合歡北峰/ })).toContainText('4 張照片')
  await expect(page.getByRole('heading', { name: '把走過的山，變成一篇日誌' })).toHaveCount(0)
})

test('a trip without photos or route shows a drawn cover and no zero chips', async ({ page }) => {
  await page.goto('./#/')
  await page.evaluate(async (path) => {
    const { createTrip } = await import(path)
    await createTrip({ title: '空白的山' })
  }, STORAGE)
  await page.reload()

  const card = page.getByRole('link', { name: /空白的山/ })
  await expect(card).toBeVisible()
  await expect(card).not.toContainText('公里')
  await expect(card).not.toContainText('張照片')
  await expect(card.locator('img')).toHaveCount(0)
})

test('earlier trips are polaroids, all reachable', async ({ page }) => {
  await page.goto('./#/')
  await page.evaluate(async (path) => {
    const { createTrip } = await import(path)
    for (const title of ['甲山', '乙山', '丙山', '丁山', '戊山']) await createTrip({ title })
  }, STORAGE)
  await page.reload()

  await expect(page.getByRole('heading', { name: '更早的回憶' })).toBeVisible()
  for (const title of ['甲山', '乙山', '丙山', '丁山', '戊山']) {
    await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(1)
  }
  await noHorizontalScroll(page)
})

test('a storage failure shows its message and a retry', async ({ page }) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
      if (!sessionStorage.getItem('healed')) throw new Error('壞掉了')
      return open.apply(this, args)
    }
  })
  await page.goto('./#/')

  await expect(page.getByRole('alert')).toContainText('讀不到你的回憶')
  await expect(page.getByRole('alert')).toContainText('壞掉了')

  await page.evaluate(() => sessionStorage.setItem('healed', '1'))
  await page.getByRole('button', { name: '再試一次' }).click()
  await expect(page.getByRole('heading', { name: '把走過的山，變成一篇日誌' })).toBeVisible()
})

const LONG = '合歡北峰與石門山連走加上奇萊南華日出雲海滿滿的一趟超級長的山行紀錄名稱八十個字剛好滿滿的喔喔喔喔喔喔'.slice(0, 80)

async function seed(page: Page, titles: string[]) {
  await page.goto('./#/')
  await page.evaluate(
    async ({ path, titles }) => {
      const { createTrip } = await import(path)
      for (const title of titles) await createTrip({ title })
    },
    { path: STORAGE, titles },
  )
  await page.reload()
}

test('long titles: clamped to two lines, nothing overflows at 320', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, ['a'.repeat(79), '🏔️⛰️🌄🥾'.repeat(9), 'Hehuan North Peak and Shimen Mountain traverse with sunrise over sea of clouds', LONG])

  await expect(page.getByRole('heading', { name: '更早的回憶' })).toBeVisible()
  await noHorizontalScroll(page)

  const title = page.locator('a h2').first()
  const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
  expect(lines).toBeLessThanOrEqual(2)

  for (const caption of await page.locator('figcaption span:first-child').all()) {
    const box = await caption.boundingBox()
    expect(box!.height).toBeLessThan(120)
  }
})

test('at 320 the greeting is two lines and the featured card chips stay whole', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./#/new')
  await page.locator('input[type=file]').nth(0).setInputFiles('tests/fixtures/hehuan-north.gpx')
  await page.getByRole('button', { name: '建立回憶' }).click()
  await page.getByRole('button', { name: '看這趟日誌' }).click()
  await page.goto('./#/')

  const heading = page.getByRole('heading', { level: 1 })
  const lines = await heading.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
  expect(lines).toBe(2)

  for (const chip of await page.getByRole('link', { name: /公里/ }).locator('span:has-text("公")').all()) {
    expect((await chip.boundingBox())!.height).toBeLessThan(36)
  }
  await noHorizontalScroll(page)
})

test('keyboard only: settings, the card and the new button are reachable with a visible ring', async ({ page, browserName }) => {
  const tab = () => page.keyboard.press(`${browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}Tab`)
  await seed(page, ['甲山'])
  await expect(page.getByRole('link', { name: /甲山/ })).toBeVisible()

  const focusedRing = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return { visible: el.matches(':focus-visible'), width: parseFloat(getComputedStyle(el).outlineWidth) }
    })

  const order: string[] = []

  while (!order.some((name) => name.includes('新的回憶')) && order.length < 5) {
    await tab()
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 4) || ''))
    const ring = await focusedRing()
    expect(ring.visible).toBe(true)
    expect(ring.width).toBeGreaterThanOrEqual(2)
  }

  expect(order[0]).toBe('設定')
  expect(order[1]).toMatch(/甲山|最近一趟/)
  expect(order.some((name) => name.includes('新的回憶'))).toBe(true)
})

test('a half-made trip (no track, no photos, dangling cover) still renders as a normal card', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./#/')
  await page.evaluate(async (path) => {
    const { createTrip, updateTrip } = await import(path)
    const trip = await createTrip({ title: '做到一半' })
    await updateTrip(trip.id, { coverPhotoId: 'no-such-photo' } as never).catch(() => {})
  }, STORAGE)
  await page.reload()

  const card = page.getByRole('link', { name: /做到一半/ })
  await expect(card).toBeVisible()
  await expect(card).not.toContainText(/NaN|undefined|null/)
  expect(errors).toEqual([])
})

test('short landscape: the new-trip button is in the flow and the header art is capped', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await seed(page, ['甲山'])

  const art = await page.locator('svg').first().boundingBox()
  expect(art!.height).toBeLessThanOrEqual(200)
  expect(await page.locator('main + div').evaluate((el) => getComputedStyle(el).position)).toBe('static')
  await noHorizontalScroll(page)
})

for (const zoom of [150, 200]) {
  test(`${zoom}% text: home stays inside the screen and the sticky bar stays small`, async ({ page }) => {
    await seed(page, ['合歡北峰', LONG, '乙山'])
    await page.addStyleTag({ content: `html{font-size:${zoom}%}` })

    await expect(page.getByRole('link', { name: '新的回憶' })).toBeVisible()
    await noHorizontalScroll(page)

    const bar = await page.locator('main + div').boundingBox()
    expect(bar!.height).toBeLessThan(page.viewportSize()!.height * 0.25)
  })
}
