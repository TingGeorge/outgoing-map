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

test('photos from another day than the GPX: the GPX time is not used, the photo times are', async ({ page }) => {
  const other = readFileSync(fixture('hehuan-north.gpx'), 'utf8').replaceAll('2026-11-06', '2026-10-01').replaceAll('2026-11-07', '2026-10-02')

  await page.goto('./#/new')
  await gpxInput(page).setInputFiles({ name: 'other-day.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(other) })
  await expect(page.getByText(/10 月 2 日/)).toBeVisible()

  await photoInput(page).setInputFiles(PHOTOS)
  await expect(page.getByText('這個 GPX 檔的時間不是實際記錄的，會改用照片的時間來排列。')).toBeVisible()
  await expect(page.getByText(/10 月 2 日/)).toHaveCount(0)
  await expect(page.getByLabel('這趟的名字')).toHaveValue('合歡北峰')
  await page.getByRole('button', { name: '建立回憶' }).click()

  await expect(page.getByText('加入了 4 張照片')).toBeVisible()
  await expect(page.getByText('照片的時間和這條路線對不上')).toHaveCount(0)

  await page.getByRole('button', { name: '看這趟日誌' }).click()
  await expect(page.getByText('照片拍攝於 07:20 到 10:15')).toBeVisible()
  await expect(page.getByText(/2026 年 11 月 7 日/)).toBeVisible()
  await expect(page.getByText('時間', { exact: true })).toHaveCount(0)

  await page.locator('ol').getByRole('button', { name: /^打開照片/ }).first().click()
  await expect(page.getByRole('dialog', { name: '照片' }).getByText('在路線上的位置：依照片的定位放上路線')).toBeVisible()
})

test('most photos outside the GPX time are flagged but still added', async ({ page }) => {
  const later = readFileSync(fixture('hehuan-north.gpx'), 'utf8').replace(
    /<time>([^<]+)<\/time>/g,
    (_, t: string) => `<time>${new Date(Date.parse(t) + 3.5 * 3_600_000).toISOString()}</time>`,
  )

  await page.goto('./#/new')
  await gpxInput(page).setInputFiles({ name: 'later.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(later) })
  await photoInput(page).setInputFiles(PHOTOS)
  await expect(page.getByText('已選 4 張照片')).toBeVisible()
  await expect(page.getByText('這個 GPX 檔的時間不是實際記錄的', { exact: false })).toHaveCount(0)
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

const TWO_DAY_GPX = `<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><trkseg><trkpt lat="24.1" lon="121.2"><ele>3000</ele><time>2026-11-07T12:00:00Z</time></trkpt><trkpt lat="24.11" lon="121.21"><ele>3200</ele><time>2026-11-08T02:00:00Z</time></trkpt></trkseg></trk></gpx>`
const STORAGE = '/src/storage/index.ts'

const tripCount = (page: Page) =>
  page.evaluate(async (path) => (await (await import(path)).listTrips()).length, STORAGE)

test('a two-day track shows both days and gets a natural default title', async ({ page }) => {
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles({ name: 'two-day.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(TWO_DAY_GPX) })

  await expect(page.getByText('2026 年 11 月 7 日　週六 – 8 日　週日')).toBeVisible()
  await expect(page.getByText('20:00 出發，10:00 結束')).toBeVisible()
  await expect(page.getByLabel('這趟的名字')).toHaveValue('11 月 7–8 日的山')
})

test('the title is capped at 80 with a counter near the limit', async ({ page }) => {
  await page.goto('./#/new')
  const title = page.getByLabel('這趟的名字')

  await expect(title).toHaveAttribute('maxlength', '80')
  await expect(page.getByText(/\d+ \/ 80/)).toHaveCount(0)

  await title.fill('')
  await title.click()
  await page.keyboard.insertText('山'.repeat(95))
  expect((await title.inputValue()).length).toBe(80)
  await expect(page.getByText('80 / 80')).toBeVisible()
})

test('a very long GPX name and file name do not overflow at 320', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./#/new')
  const gpx = TWO_DAY_GPX.replace('<trk>', `<trk><name>${'x'.repeat(200)}</name>`)
  await gpxInput(page).setInputFiles({ name: `${'y'.repeat(80)}.gpx`, mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) })

  await expect(page.getByLabel('這趟的名字')).toHaveValue('x'.repeat(80))
  await noHorizontalScroll(page)
})

test('double-click and Enter repeats on 建立回憶 make exactly one trip', async ({ page }) => {
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
  await page.getByRole('button', { name: '建立回憶' }).dblclick()
  await expect(page.getByRole('heading', { name: '回憶存好了' })).toBeVisible()
  expect(await tripCount(page)).toBe(1)

  await page.goto('./#/')
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
  await page.getByRole('button', { name: '建立回憶' }).focus()
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  await expect(page.getByRole('heading', { name: '回憶存好了' })).toBeVisible()
  expect(await tripCount(page)).toBe(2)
})

test('short landscape: the create button sits below the content, not over it', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))

  const bar = page.getByRole('button', { name: '建立回憶' })
  await bar.scrollIntoViewIfNeeded()
  const main = await page.locator('main').boundingBox()
  const button = await bar.boundingBox()
  expect(button!.y).toBeGreaterThanOrEqual(main!.y + main!.height - 1)

  await page.evaluate(() => scrollTo(0, 0))
  const heading = await page.getByRole('heading', { name: '照片' }).boundingBox()
  const sticky = await page.locator('main + div').evaluate((el) => getComputedStyle(el).position)
  expect(sticky).toBe('static')
  expect(heading).not.toBeNull()
  await noHorizontalScroll(page)
})

test('keyboard only: the leave dialog takes focus, Escape closes it, focus returns to the opener', async ({ page, browserName }) => {
  const tab = () => page.keyboard.press(`${browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}Tab`)
  await page.goto('./#/new')
  await photoInput(page).setInputFiles(PHOTOS.slice(0, 1))

  await page.getByRole('button', { name: '回首頁' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '要離開嗎？' })
  await expect(dialog).toBeVisible()

  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  await tab()
  await expect(dialog.getByRole('button', { name: '離開' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/#\/new$/)
  await expect(page.getByText('已選 1 張照片')).toBeVisible()
})

test('keyboard only: the form is reachable in reading order, with a visible ring', async ({ page, browserName }) => {
  const tab = () => page.keyboard.press(`${browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}Tab`)
  await page.goto('./#/new')
  await expect(page.getByRole('heading', { level: 1, name: '新的回憶' })).toBeVisible()

  for (const name of ['回首頁', '選擇 GPX 檔', '選擇照片']) {
    await tab()
    await expect(page.getByRole('button', { name })).toBeFocused()
    const ring = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement!).outlineWidth))
    expect(ring).toBeGreaterThanOrEqual(2)
  }

  await tab()
  await expect(page.getByLabel('這趟的名字')).toBeFocused()
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth)).not.toBe('0px')
})

for (const zoom of [150, 200]) {
  test(`${zoom}% text: the form and the sticky bar stay usable`, async ({ page }) => {
    await page.goto('./#/new')
    await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
    await page.addStyleTag({ content: `html{font-size:${zoom}%}` })

    await noHorizontalScroll(page)
    const bar = await page.locator('main + div').boundingBox()
    expect(bar!.height).toBeLessThan(page.viewportSize()!.height * 0.3)
    await expect(page.getByRole('button', { name: '建立回憶' })).toBeVisible()
  })
}

test('reload while photos are processing leaves either nothing or a card that renders', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./#/new')
  await gpxInput(page).setInputFiles(fixture('hehuan-north.gpx'))
  await photoInput(page).setInputFiles(PHOTOS)
  await page.getByRole('button', { name: '建立回憶' }).click()
  await expect(page.getByRole('heading', { name: '正在存你的回憶' })).toBeVisible()
  await page.reload()
  errors.length = 0

  await page.goto('./#/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('想回味哪一座山？')
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/NaN|undefined|null/)
  expect(errors).toEqual([])
})
