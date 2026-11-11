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
