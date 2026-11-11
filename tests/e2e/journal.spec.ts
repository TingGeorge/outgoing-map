import { expect, test, type Page } from '@playwright/test'
import { routePixels } from './helpers'

const FAKE_KEY = 'ffffffffffffffffffffffffffffffff'
const PHOTOS = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg']
const SHOTS = process.env.JOURNAL_SHOTS
const STORAGE = '/src/storage/index.ts'
const CORE = '/src/core/index.ts'

interface Seed {
  title?: string
  gpx?: string | null
  photos?: string[]
  captions?: Record<string, string>
  diary?: string
}

async function useFakeKey(page: Page) {
  await page.addInitScript((key) => localStorage.setItem('thunderforest-key', key), FAKE_KEY)
  await page.route('https://tile.thunderforest.com/**', (route) =>
    route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, body: '' }),
  )
}

async function seed(page: Page, options: Seed = {}): Promise<string> {
  await page.goto('./#/welcome')

  return page.evaluate(
    async ({ title, gpx, photos, captions, diary, STORAGE, CORE }) => {
      const storage = await import(STORAGE)
      const core = await import(CORE)

      const trip = await storage.createTrip({ title, diary })

      if (gpx) {
        const xml = await (await fetch(`/tests/fixtures/${gpx}`)).text()
        await storage.saveTrack(trip.id, core.parseGpx(xml).points)
      }

      const files = await Promise.all(
        photos.map(async (name) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type: 'image/jpeg' })),
      )

      if (files.length) await storage.addPhotos(trip.id, files)

      for (const p of await storage.listPhotos(trip.id)) {
        const caption = captions[p.fileName]
        if (caption) await storage.updatePhoto(p.id, { caption })
      }

      return trip.id
    },
    { title: options.title ?? '合歡北峰', gpx: options.gpx === undefined ? 'hehuan-north.gpx' : options.gpx, photos: options.photos ?? PHOTOS, captions: options.captions ?? {}, diary: options.diary ?? '', STORAGE, CORE },
  )
}

async function openTrip(page: Page, id: string) {
  await page.goto(`./#/trip/${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

const photoButtons = (page: Page) => page.locator('ol').getByRole('button', { name: /^打開照片/ })

const timelineRows = (page: Page) => page.locator('ol > li')

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${page.viewportSize()!.width}-${name}.png`, fullPage })
}

test.describe('with a fake key', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  test('shows stats, title and the day in order', async ({ page }) => {
    const id = await seed(page)
    await openTrip(page, id)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('合歡北峰')
    await expect(page.getByText('2026 年 11 月 7 日')).toBeVisible()
    await expect(page.getByText('距離').locator('..')).toContainText('3.7 公里')
    await expect(page.getByText('爬升').locator('..')).toContainText('429 公尺')
    await expect(page.getByText('時間', { exact: true }).locator('..')).toContainText('5:00')
    await expect(page.getByText('最高 3424 公尺')).toBeVisible()
    await expect(page.getByRole('link', { name: '立體播放' })).toHaveAttribute('href', `#/trip/${id}/fly`)

    await expect(page.getByText('合歡北峰', { exact: true }).nth(1)).toBeVisible({ timeout: 15_000 })

    const rows = await timelineRows(page).evaluateAll((items) =>
      items.map((li) => {
        const time = li.querySelector('time')?.textContent ?? ''
        const button = li.querySelector('button')
        return `${time} ${button ? 'photo' : li.textContent?.replace(time, '').trim()}`
      }),
    )

    expect(rows[0]).toMatch(/^06:40 出發/)
    expect(rows.at(-1)).toMatch(/^11:40 回到出發點/)

    const order = rows.map((r) => (r.includes('photo') ? r.slice(0, 5) : r.includes('合歡北峰山頂') ? 'summit' : null)).filter(Boolean)
    expect(order).toEqual(['07:20', '08:50', '09:26', 'summit', '10:15'])

    await expect(page.getByText('沒放上路線的照片')).toHaveCount(0)
    await expect(photoButtons(page)).toHaveCount(4)
    await noHorizontalScroll(page)
  })

  test('renders the route and shows the key notice when tiles are refused', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await openTrip(page, id)

    const notice = page.getByText('地圖暫時打不開')
    await expect(notice).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '前往設定' })).toHaveAttribute('href', '#/settings')
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Thunderforest')
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')

    expect(await routePixels(page)).toBeGreaterThan(100)
    await shot(page, 'key-notice')
  })

  test('says the map needs a network when tiles cannot load', async ({ page }) => {
    await page.unroute('https://tile.thunderforest.com/**')
    await page.route('https://tile.thunderforest.com/**', (route) => route.abort())

    const id = await seed(page, { photos: [] })
    await openTrip(page, id)
    await expect(page.getByText('地圖需要網路')).toBeVisible({ timeout: 20_000 })
  })

  test('edits the title', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await openTrip(page, id)

    await page.getByRole('button', { name: '修改名稱' }).click()
    const field = page.getByLabel('這趟的名字')
    await expect(field).toHaveValue('合歡北峰')
    await shot(page, 'title-dialog')

    await field.fill('  ')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByText('請幫這篇回憶取個名字')).toBeVisible()

    await field.fill('合歡北峰，看雲去')
    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('合歡北峰，看雲去')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('合歡北峰，看雲去')
  })

  test('autosaves the diary and keeps it after a reload and a fast navigation', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await openTrip(page, id)

    const diary = page.getByLabel('日記')
    await diary.fill('天氣比預報好很多。')
    await expect(page.getByText('已自動儲存')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('日記')).toHaveValue('天氣比預報好很多。')

    await page.getByLabel('日記').fill('天氣比預報好很多。下次帶爸媽來。')
    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page).toHaveURL(/#\/$/)

    await openTrip(page, id)
    await expect(page.getByLabel('日記')).toHaveValue('天氣比預報好很多。下次帶爸媽來。')
  })

  test('opens the viewer, edits a caption, moves between photos and closes with Back', async ({ page }) => {
    const id = await seed(page)
    await openTrip(page, id)

    await photoButtons(page).first().click()
    const viewer = page.getByRole('dialog', { name: '照片' })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByText('第 1 張，共 4 張')).toBeVisible()
    await expect(viewer.getByText('依拍攝時間放上路線')).toBeVisible()
    await expect(viewer.getByRole('img')).toBeVisible()

    await viewer.getByLabel('照片說明').fill('箭竹草原，風很大')
    await viewer.getByRole('button', { name: '下一張' }).click()
    await expect(viewer.getByText('第 2 張，共 4 張')).toBeVisible()

    await page.keyboard.press('ArrowLeft')
    await expect(viewer.getByLabel('照片說明')).toHaveValue('箭竹草原，風很大')

    await page.goBack()
    await expect(viewer).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
    await expect(page.locator('main').getByText('箭竹草原，風很大')).toBeVisible()

    await photoButtons(page).nth(3).click()
    await expect(viewer.getByText('第 4 張，共 4 張')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('deletes a photo and sets a cover', async ({ page }) => {
    const id = await seed(page)
    await openTrip(page, id)

    await photoButtons(page).nth(1).click()
    const viewer = page.getByRole('dialog', { name: '照片' })
    await viewer.getByRole('button', { name: '設為封面' }).click()
    await expect(viewer.getByText('已設為這篇回憶的封面')).toBeVisible()
    await expect(viewer.getByRole('button', { name: '這是封面' })).toBeDisabled()

    await viewer.getByRole('button', { name: '刪除照片' }).click()
    await expect(page.getByRole('dialog', { name: '刪除這張照片？' })).toBeVisible()
    await page.getByRole('button', { name: '刪除', exact: true }).click()

    await expect(viewer.getByText('第 2 張，共 3 張')).toBeVisible()
    await page.getByRole('button', { name: '關閉照片' }).click()
    await expect(photoButtons(page)).toHaveCount(3)

    const count = await page.evaluate(async ([path, tripId]) => (await (await import(path!)).getTrip(tripId))?.photoCount, [STORAGE, id])
    expect(count).toBe(3)
  })

  test('adds photos and reports a duplicate', async ({ page }) => {
    const id = await seed(page, { photos: PHOTOS.slice(0, 2) })
    await openTrip(page, id)
    await expect(photoButtons(page)).toHaveCount(2)

    await page.getByRole('button', { name: '更多選項' }).click()
    await shot(page, 'more-menu')

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '加入照片' }).click()
    await (await chooser).setFiles(['tests/fixtures/hehuan-0720-gps.jpg', 'tests/fixtures/hehuan-0926-summit.jpg', 'tests/fixtures/hehuan-north.gpx'])

    const dialog = page.getByRole('dialog', { name: '加入照片' })
    await expect(dialog.getByText('加入了 1 張照片。')).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('1 張已經在這篇回憶裡')).toBeVisible()
    await expect(dialog.getByText('hehuan-north.gpx')).toBeVisible()
    await shot(page, 'add-result')

    await dialog.getByRole('button', { name: '好' }).click()
    await expect(photoButtons(page)).toHaveCount(3)
  })

  test('replaces the GPX after confirming', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await openTrip(page, id)
    await expect(page.getByText('時間', { exact: true }).locator('..')).toContainText('5:00')

    await page.getByRole('button', { name: '更多選項' }).click()
    let chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '更換 GPX' }).click()
    await (await chooser).setFiles('tests/fixtures/hehuan-0720-gps.jpg')
    await expect(page.getByText('這個檔案不是有效的 GPX')).toBeVisible()

    await page.getByRole('button', { name: '更多選項' }).click()
    chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '更換 GPX' }).click()
    await (await chooser).setFiles('tests/fixtures/no-time.gpx')

    await expect(page.getByRole('dialog', { name: '換成新的 GPX？' })).toBeVisible()
    await shot(page, 'gpx-confirm')
    await page.getByRole('button', { name: '換上新路線' }).click()

    await expect(page.getByText('已換上新的路線')).toBeVisible()
    await expect(page.getByText('時間', { exact: true }).locator('..')).toContainText('—')
  })

  test('exports through the share sheet when files can be shared', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared?: { name: string; head: number[] } }
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { files?: File[] }) => !!d.files?.length })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: { files: File[] }) => {
          const file = d.files[0]!
          w.__shared = { name: file.name, head: Array.from(new Uint8Array(await file.slice(0, 2).arrayBuffer())) }
        },
      })
    })

    const id = await seed(page, { photos: PHOTOS.slice(0, 1) })
    await openTrip(page, id)

    await page.getByRole('button', { name: '更多選項' }).click()
    await page.getByRole('button', { name: '匯出這篇回憶' }).click()
    const dialog = page.getByRole('dialog', { name: '匯出這篇回憶' })
    await expect(dialog.getByText('合歡北峰-2026-11-07.hiking.zip')).toBeVisible()
    await shot(page, 'export-ready')
    await dialog.getByRole('button', { name: '儲存匯出檔' }).click()

    await expect(page.getByText('已交給分享選單')).toBeVisible()
    const shared = await page.evaluate(() => (window as unknown as { __shared?: { name: string; head: number[] } }).__shared)
    expect(shared).toEqual({ name: '合歡北峰-2026-11-07.hiking.zip', head: [0x50, 0x4b] })
  })

  test('exports as a download when sharing files is not possible', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }))

    const id = await seed(page, { photos: [] })
    await openTrip(page, id)

    await page.getByRole('button', { name: '更多選項' }).click()
    await page.getByRole('button', { name: '匯出這篇回憶' }).click()

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '儲存匯出檔' }).click()
    expect((await download).suggestedFilename()).toBe('合歡北峰-2026-11-07.hiking.zip')
    await expect(page.getByText('已下載')).toBeVisible()
  })

  test('deletes the trip and returns home', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await openTrip(page, id)

    await page.getByRole('button', { name: '更多選項' }).click()
    await page.getByRole('button', { name: /刪除這篇回憶/ }).click()
    await expect(page.getByRole('dialog', { name: '刪除這篇回憶？' })).toBeVisible()
    await shot(page, 'delete-confirm')
    await page.getByRole('button', { name: '刪除回憶' }).click()

    await expect(page).toHaveURL(/#\/$/)
    const trip = await page.evaluate(async ([path, tripId]) => (await (await import(path!)).getTrip(tripId)) ?? null, [STORAGE, id])
    expect(trip).toBeNull()
  })

  test('shows a friendly page for a missing trip', async ({ page }) => {
    await page.goto('./#/trip/no-such-trip')
    await expect(page.getByRole('heading', { name: '找不到這篇回憶' })).toBeVisible()
    await expect(page.getByRole('link', { name: '回首頁' })).toHaveAttribute('href', '#/')
    await shot(page, 'not-found')
  })

  test('a trip built from photo locations says so; one without any location explains the missing map', async ({ page }) => {
    const id = await seed(page, { gpx: null })
    await openTrip(page, id)

    await expect(page.getByText('路線由照片位置連成，匯入 GPX 會更準')).toBeVisible()
    await expect(page.getByText('沒放上路線的照片')).toBeVisible()

    const bare = await seed(page, { gpx: null, photos: ['hehuan-1015-nogps.jpg'] })
    await openTrip(page, bare)

    await expect(page.getByText('這趟還沒有路線')).toBeVisible()
    await expect(page.getByRole('button', { name: '匯入 GPX' })).toBeVisible()
    await expect(page.getByRole('link', { name: '立體播放' })).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveCount(0)
    await noHorizontalScroll(page)
    await expect(page.locator('ol img')).toBeVisible()
    await shot(page, 'no-route', true)
  })

  test('enlarges the map and Back shrinks it again', async ({ page }) => {
    await page.unroute('https://tile.thunderforest.com/**')
    await page.route('https://tile.thunderforest.com/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }))

    const id = await seed(page)
    await openTrip(page, id)

    await page.getByRole('button', { name: '放大地圖' }).click()
    const hero = page.locator('section[aria-label="路線地圖"]')
    await expect.poll(async () => (await hero.boundingBox())?.height).toBe(844)
    await expect(page.getByRole('button', { name: '縮小地圖' })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('button', { name: '放大地圖' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
  })
})

test.describe('with the real key', () => {
  const key = process.env.THUNDERFOREST_API_KEY

  test.skip(!key, 'needs THUNDERFOREST_API_KEY')

  test('draws the map with tiles and the route', async ({ page }) => {
    await page.goto('./#/welcome')
    await page.evaluate((k) => localStorage.setItem('thunderforest-key', k), key!)

    let tiles = 0
    let refused = 0

    page.on('response', (res) => {
      if (!res.url().startsWith('https://tile.thunderforest.com/')) return
      if (res.ok()) tiles++
      else refused++
    })

    const id = await seed(page)
    await openTrip(page, id)

    await expect(page.locator('section[aria-label="路線地圖"] canvas')).toBeVisible()
    await expect.poll(() => tiles, { timeout: 20_000 }).toBeGreaterThan(0)
    await page.waitForLoadState('networkidle')

    expect(refused).toBe(0)
    await expect(page.getByText('地圖暫時打不開')).toHaveCount(0)
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')
    await page.waitForTimeout(800)
    await shot(page, 'top')
    expect(await routePixels(page)).toBeGreaterThan(100)

    if (SHOTS) {
      await page.getByRole('button', { name: '放大地圖' }).click()
      await page.waitForTimeout(1500)
      await shot(page, 'expanded')
      await page.getByRole('button', { name: '縮小地圖' }).click()

      await page.evaluate(() => window.scrollTo(0, 900))
      await page.waitForTimeout(600)
      await shot(page, 'timeline')

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(400)
      await shot(page, 'diary')

      await photoButtons(page).nth(2).click()
      await page.waitForTimeout(600)
      await shot(page, 'viewer')
      await page.getByRole('button', { name: '關閉照片' }).click()

      await page.setViewportSize({ width: 1280, height: 800 })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(1200)
      await shot(page, 'top')
      await noHorizontalScroll(page)

      await page.getByRole('button', { name: '放大地圖' }).click()
      await page.waitForTimeout(1500)
      await shot(page, 'expanded')
      await page.getByRole('button', { name: '縮小地圖' }).click()

      await photoButtons(page).nth(1).click()
      await page.waitForTimeout(600)
      await shot(page, 'viewer')
    }
  })
})

test('shows a skeleton while the trip is read', async ({ page }) => {
  await useFakeKey(page)
  const id = await seed(page, { photos: [] })

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('hiking-memories')

        req.onsuccess = () => {
          const store = req.result.transaction('trips', 'readwrite').objectStore('trips')
          const end = Date.now() + 2500
          const spin = () => {
            if (Date.now() < end) store.count().onsuccess = spin
          }

          spin()
          resolve()
        }
      }),
  )

  await page.evaluate((tripId) => (location.hash = `#/trip/${tripId}`), id)
  await expect(page.getByRole('status', { name: '日誌載入中' })).toBeVisible()
  await shot(page, 'loading')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('合歡北峰', { timeout: 10_000 })
})
