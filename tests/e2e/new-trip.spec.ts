import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const fixture = (name: string) => `tests/fixtures/${name}`
const PHOTOS = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg'].map(fixture)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('thunderforest-key', 'ffffffffffffffffffffffffffffffff')
      sessionStorage.setItem('seeded', '1')
    }
  })
})

const gpxInput = (page: Page) => page.locator('input[type=file]').nth(0)
const photoInput = (page: Page) => page.locator('input[type=file]').nth(1)

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

test('the create button needs a GPX or a photo', async ({ page }) => {
  await page.goto('./#/new')
  await expect(page.getByRole('heading', { level: 1, name: '新的回憶' })).toBeVisible()
  await expect(page.getByRole('button', { name: '建立回憶' })).toBeDisabled()
  await expect(page.getByText('至少選一個 GPX 檔或一張照片')).toBeVisible()
  await noHorizontalScroll(page)
})

test('a GPX plus the four photos make a trip and land on the journal', async ({ page }) => {
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))

  await expect(page.getByText('hehuan-north.gpx')).toBeVisible()
  await expect(page.getByText(/\d+ 個定位點/)).toBeVisible()
  await expect(page.getByText(/公里/)).toBeVisible()
  await expect(page.getByLabel('這趟的名字')).toHaveValue('合歡北峰')

  await photoInput(page).setInputFiles(PHOTOS)
  await expect(page.getByText('已選 4 張照片')).toBeVisible()
  await noHorizontalScroll(page)

  await page.getByRole('button', { name: '建立回憶' }).click()

  await expect(page.getByRole('heading', { level: 1, name: '回憶存好了' })).toBeVisible()
  await expect(page.getByText('加入了 4 張照片')).toBeVisible()
  await expect(page.getByText('依拍攝時間放上路線')).toBeVisible()

  await page.getByRole('button', { name: '看這趟日誌' }).click()
  await expect(page).toHaveURL(/#\/trip\/[^/]+$/)
})

test('photos only: says the route comes from the photos', async ({ page }) => {
  await page.goto('./#/new')
  await photoInput(page).setInputFiles(PHOTOS)

  await expect(page.getByText('路線會由照片位置連成，匯入 GPX 會更準。')).toBeVisible()
  await expect(page.getByLabel('這趟的名字')).toHaveValue('11 月 7 日的山')

  await page.getByRole('button', { name: '建立回憶' }).click()
  await expect(page.getByText('加入了 4 張照片')).toBeVisible()
  await expect(page.getByText('路線由照片位置連成，匯入 GPX 會更準。可以到日誌裡再匯入。')).toBeVisible()
})

test('GPX only creates a trip without photos', async ({ page }) => {
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
  await page.getByLabel('這趟的名字').fill('只有路線')
  await page.getByRole('button', { name: '建立回憶' }).click()

  await expect(page.getByText('路線已經存好')).toBeVisible()
  await page.getByRole('button', { name: '看這趟日誌' }).click()
  await expect(page).toHaveURL(/#\/trip\//)

  await page.goto('./#/')
  await expect(page.getByRole('heading', { name: '只有路線' })).toBeVisible()
})

test('a file that is not a GPX shows the error and lets you pick again', async ({ page }) => {
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })

  await expect(page.getByRole('alert')).toContainText('notes.txt')
  await expect(page.getByRole('alert')).toContainText('GPX')
  await expect(page.getByRole('button', { name: '建立回憶' })).toBeDisabled()

  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
  await expect(page.getByText('hehuan-north.gpx')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a duplicate and a corrupt photo are listed with their reasons', async ({ page }) => {
  const jpeg = readFileSync(PHOTOS[0]!)

  await page.goto('./#/new')
  await photoInput(page).setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'b-copy.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg]) },
    { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a picture') },
  ])
  await page.getByRole('button', { name: '建立回憶' }).click()

  await expect(page.getByText('加入了 1 張照片')).toBeVisible()
  await expect(page.getByText('2 個檔案沒有加入')).toBeVisible()
  await expect(page.getByText('b-copy.jpg')).toBeVisible()
  await expect(page.getByText('這張照片已經加入過了')).toBeVisible()
  await expect(page.getByText('broken.jpg')).toBeVisible()
})

test('only broken photos: no trip is left behind', async ({ page }) => {
  await page.goto('./#/new')
  await photoInput(page).setInputFiles([{ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('nope') }])
  await page.getByRole('button', { name: '建立回憶' }).click()

  await expect(page.getByRole('alert')).toContainText('沒有建立回憶')
  await expect(page.getByText('broken.jpg')).toBeVisible()

  await page.goto('./#/')
  await expect(page.getByRole('heading', { name: '把走過的山，變成一篇日誌' })).toBeVisible()
})

test('photos from another day than the GPX are flagged but still added', async ({ page }) => {
  const other = readFileSync(fixture('hehuan-north.gpx'), 'utf8').replaceAll('2026-11-06', '2026-10-01').replaceAll('2026-11-07', '2026-10-02')

  await page.goto('./#/new')
  await gpxInput(page).setInputFiles({ name: 'other-day.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(other) })
  await photoInput(page).setInputFiles(PHOTOS)
  await page.getByRole('button', { name: '建立回憶' }).click()

  await expect(page.getByText('照片的時間和這條路線對不上')).toBeVisible()
  await expect(page.getByText('加入了 4 張照片')).toBeVisible()
})

test('leaving with picked files asks first', async ({ page }) => {
  await page.goto('./#/new')
  await photoInput(page).setInputFiles(PHOTOS.slice(0, 1))

  await page.getByRole('button', { name: '回首頁' }).click()
  await expect(page.getByRole('heading', { name: '要離開嗎？' })).toBeVisible()
  await page.getByRole('button', { name: '留下來' }).click()
  await expect(page).toHaveURL(/#\/new$/)

  await page.getByRole('button', { name: '回首頁' }).click()
  await page.getByRole('button', { name: '離開' }).click()
  await expect(page).toHaveURL(/#\/$/)
})

test('the browser Back button asks too, and Stay keeps the picked files', async ({ page }) => {
  await page.goto('./#/')
  await page.getByRole('link', { name: '新的回憶' }).click()
  await photoInput(page).setInputFiles(PHOTOS.slice(0, 2))
  await expect(page.getByText('已選 2 張照片')).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: '要離開嗎？' })).toBeVisible()
  await page.getByRole('button', { name: '留下來' }).click()
  await expect(page).toHaveURL(/#\/new$/)
  await expect(page.getByText('已選 2 張照片')).toBeVisible()

  await page.goBack()
  await page.getByRole('button', { name: '離開' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('link', { name: '新的回憶' })).toBeVisible()

  await page.goBack()
  await expect(page).not.toHaveURL(/#\/new$/)
})

test('after creating, Back from the journal goes home, not to the spent form', async ({ page }) => {
  await page.goto('./#/')
  await page.getByRole('link', { name: '新的回憶' }).click()
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
  await page.getByRole('button', { name: '建立回憶' }).click()
  await page.getByRole('button', { name: '看這趟日誌' }).click()
  await expect(page).toHaveURL(/#\/trip\/[^/]+$/)

  await page.goBack()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('link', { name: '新的回憶' })).toBeVisible()
})

test('leaving an empty form needs no confirmation', async ({ page }) => {
  await page.goto('./#/new')
  await page.getByRole('button', { name: '回首頁' }).click()
  await expect(page).toHaveURL(/#\/$/)
})
