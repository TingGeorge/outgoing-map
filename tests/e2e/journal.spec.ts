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
  gpxXml?: string
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
    async ({ title, gpx, gpxXml, photos, captions, diary, STORAGE, CORE }) => {
      const storage = await import(STORAGE)
      const core = await import(CORE)

      const trip = await storage.createTrip({ title, diary })

      if (gpx || gpxXml) {
        const xml = gpxXml ?? (await (await fetch(`/tests/fixtures/${gpx}`)).text())
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
    { title: options.title ?? '合歡北峰', gpx: options.gpx === undefined ? 'hehuan-north.gpx' : options.gpx, gpxXml: options.gpxXml, photos: options.photos ?? PHOTOS, captions: options.captions ?? {}, diary: options.diary ?? '', STORAGE, CORE },
  )
}

const getTitle = (page: Page, id: string) =>
  page.evaluate(async ({ id, STORAGE }) => (await (await import(STORAGE)).getTrip(id)).title as string, { id, STORAGE })

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

  test('the title, diary and caption fields share the storage limits', async ({ page }) => {
    const id = await seed(page, { photos: [PHOTOS[0]!] })
    await openTrip(page, id)

    await page.getByRole('button', { name: '修改名稱' }).click()
    const field = page.getByLabel('這趟的名字')
    await expect(field).toHaveAttribute('maxlength', '80')

    await field.fill('山'.repeat(59))
    await expect(page.getByText('/ 80')).toHaveCount(0)

    await field.fill('山'.repeat(60))
    await expect(page.getByText('60 / 80')).toBeVisible()

    await field.pressSequentially('山'.repeat(30))
    await expect(field).toHaveValue('山'.repeat(80))
    await expect(page.getByText('80 / 80')).toBeVisible()
    await shot(page, 'title-limit')

    await page.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('山'.repeat(10))
    expect((await getTitle(page, id)).length).toBe(80)

    await expect(page.getByLabel('日記')).toHaveAttribute('maxlength', '100000')

    await photoButtons(page).first().click()
    await expect(viewer(page).getByLabel('照片說明')).toHaveAttribute('maxlength', '2000')
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

function multiDayGpx(fromUtc: string, toUtc: string) {
  const from = Date.parse(fromUtc)
  const to = Date.parse(toUtc)
  const n = 60
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const t = new Date(from + ((to - from) * i) / n).toISOString()
    return `<trkpt lat="${(24.1674 + i * 0.0004).toFixed(6)}" lon="${(121.2888 + i * 0.0003).toFixed(6)}"><ele>${3000 + i * 3}</ele><time>${t}</time></trkpt>`
  })

  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`
}

const viewer = (page: Page) => page.getByRole('dialog', { name: '照片' })

const mapPins = (page: Page) => page.locator('section[aria-label="路線地圖"] .maplibregl-marker[aria-label^="打開照片"]:visible')

const overlayLevel = (page: Page) => page.evaluate(() => (history.state?.journalOverlay as number | undefined) ?? 0)

async function fromHome(page: Page, id: string) {
  await page.goto('./#/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate((tripId) => (location.hash = `#/trip/${tripId}`), id)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/合歡北峰|兩天|三天/)
}

async function backToHome(page: Page) {
  await page.goBack()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('link', { name: /新的回憶|新增/ }).or(page.locator('main')).first()).toBeVisible()
}

async function useOkTiles(page: Page) {
  await page.unroute('https://tile.thunderforest.com/**')
  await page.route('https://tile.thunderforest.com/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' }))
}

test.describe('overlays and Back', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
    await useOkTiles(page)
  })

  for (const how of ['Escape', 'X', 'Back'] as const) {
    test(`a photo opened from the enlarged map closes alone with ${how}`, async ({ page }) => {
      const id = await seed(page)
      await fromHome(page, id)

      await page.getByRole('button', { name: '放大地圖' }).click()
      await expect(page.getByRole('button', { name: '縮小地圖' })).toBeVisible()
      await expect(mapPins(page).first()).toBeVisible({ timeout: 15_000 })
      await mapPins(page).first().click()
      await expect(viewer(page)).toBeVisible()
      expect(await overlayLevel(page)).toBe(2)

      if (how === 'Escape') await page.keyboard.press('Escape')
      if (how === 'X') await page.getByRole('button', { name: '關閉照片' }).click()
      if (how === 'Back') await page.goBack()

      await expect(viewer(page)).toBeHidden()
      await expect(page.getByRole('button', { name: '縮小地圖' })).toBeVisible()
      await expect.poll(() => overlayLevel(page)).toBe(1)
      await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))

      await page.goBack()
      await expect(page.getByRole('button', { name: '放大地圖' })).toBeVisible()
      await expect.poll(() => overlayLevel(page)).toBe(0)

      await backToHome(page)
    })
  }

  test('closing with the X and then Back goes to the previous page', async ({ page }) => {
    const id = await seed(page)
    await fromHome(page, id)

    await photoButtons(page).first().click()
    await expect(viewer(page)).toBeVisible()
    await page.getByRole('button', { name: '關閉照片' }).click()
    await expect(viewer(page)).toBeHidden()

    await mapPins(page).first().click()
    await expect(viewer(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toBeHidden()

    await backToHome(page)
    await expect(viewer(page)).toHaveCount(0)
  })

  test('menu then dialog: each Back closes one thing, then leaves the page', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await fromHome(page, id)

    await page.getByRole('button', { name: '更多選項' }).click()
    await expect(page.getByRole('dialog', { name: '這篇回憶' })).toBeVisible()
    await page.getByRole('button', { name: /刪除這篇回憶/ }).click()
    await expect(page.getByRole('dialog', { name: '刪除這篇回憶？' })).toBeVisible()
    await expect.poll(() => overlayLevel(page)).toBe(1)

    await page.goBack()
    await expect(page.getByRole('dialog', { name: '刪除這篇回憶？' })).toBeHidden()
    await expect(page.getByRole('dialog', { name: '這篇回憶' })).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))

    await page.getByRole('button', { name: '修改名稱' }).click()
    await expect(page.getByLabel('這趟的名字')).toBeVisible()
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByLabel('這趟的名字')).toBeHidden()

    await backToHome(page)
  })

  test('deleting the trip from the menu returns to the page before it', async ({ page }) => {
    const id = await seed(page, { photos: [] })
    await fromHome(page, id)

    await page.getByRole('button', { name: '更多選項' }).click()
    await page.getByRole('button', { name: /刪除這篇回憶/ }).click()
    await page.getByRole('button', { name: '刪除回憶' }).click()

    await expect(page).toHaveURL(/#\/$/)
    await page.waitForTimeout(400)
    await expect(page).toHaveURL(/#\/$/)
  })

  test('a rapid double Back closes the viewer and the enlarged map, and stays on the journal', async ({ page }) => {
    const id = await seed(page)
    await fromHome(page, id)

    await page.getByRole('button', { name: '放大地圖' }).click()
    await mapPins(page).first().click()
    await expect(viewer(page)).toBeVisible()

    await page.evaluate(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 30))
      history.back()
    })

    await expect(viewer(page)).toBeHidden()
    await expect(page.getByRole('button', { name: '放大地圖' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
    await expect.poll(() => overlayLevel(page)).toBe(0)

    await backToHome(page)
  })

  test('a reload with an overlay open leaves no dead history entry', async ({ page }) => {
    const id = await seed(page)
    await fromHome(page, id)

    await page.getByRole('button', { name: '放大地圖' }).click()
    await mapPins(page).first().click()
    await expect(viewer(page)).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(viewer(page)).toHaveCount(0)
    await expect.poll(() => overlayLevel(page)).toBe(0)
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))

    await backToHome(page)
  })

  test('a deep link opens and closes overlays, then the back button goes home inside the app', async ({ page }) => {
    const id = await seed(page)
    await page.goto('about:blank')
    await page.goto(`./#/trip/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await photoButtons(page).first().click()
    await page.getByRole('button', { name: '關閉照片' }).click()
    await page.getByRole('button', { name: '放大地圖' }).click()
    await page.goBack()
    await expect(page.getByRole('button', { name: '放大地圖' })).toBeVisible()
    await page.getByRole('button', { name: '更多選項' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => overlayLevel(page)).toBe(0)

    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(/#\/$/)
  })
})

test.describe('nothing typed is lost', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  for (const wait of [0, 150, 300]) {
    test(`the diary survives a reload ${wait} ms after typing`, async ({ page }) => {
      const id = await seed(page, { photos: [], diary: '原本的日記' })
      await openTrip(page, id)

      await page.getByLabel('日記').fill(`原本的日記，再補一句 ${wait}`)
      if (wait) await page.waitForTimeout(wait)
      await page.reload()

      await expect(page.getByLabel('日記')).toHaveValue(`原本的日記，再補一句 ${wait}`)
      await expect.poll(() => page.evaluate(async ([path, tripId]) => (await (await import(path!)).getTrip(tripId))?.diary, [STORAGE, id])).toBe(`原本的日記，再補一句 ${wait}`)
      await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('journal-draft:')).length)).toBe(0)
    })

    test(`a caption survives a reload ${wait} ms after typing`, async ({ page }) => {
      const id = await seed(page)
      await openTrip(page, id)

      await photoButtons(page).first().click()
      await viewer(page).getByLabel('照片說明').fill(`caption before home ${wait}`)
      if (wait) await page.waitForTimeout(wait)
      await page.reload()

      await expect(page.locator('main').getByText(`caption before home ${wait}`)).toBeVisible()
      await photoButtons(page).first().click()
      await expect(viewer(page).getByLabel('照片說明')).toHaveValue(`caption before home ${wait}`)
    })
  }

  test('text typed while the tab is hidden and then closed comes back', async ({ page, context }) => {
    const id = await seed(page)
    await openTrip(page, id)

    await page.getByLabel('日記').fill('關掉分頁前寫的')
    await photoButtons(page).first().click()
    await viewer(page).getByLabel('照片說明').fill('關掉分頁前的說明')

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.close({ runBeforeUnload: false })

    const next = await context.newPage()
    await next.goto(`./#/trip/${id}`)
    await expect(next.getByLabel('日記')).toHaveValue('關掉分頁前寫的')
    await expect(next.locator('main').getByText('關掉分頁前的說明')).toBeVisible()
  })

  test('typing fast in the caption never drops words while saves land', async ({ page }) => {
    const id = await seed(page)
    await openTrip(page, id)

    await photoButtons(page).first().click()
    const field = viewer(page).getByLabel('照片說明')
    await field.click()

    for (const word of ['caption ', 'before ', 'home ', 'and ', 'after']) {
      await page.keyboard.type(word, { delay: 30 })
      await page.waitForTimeout(820)
    }

    await expect(field).toHaveValue('caption before home and after')
    await expect(viewer(page).getByText('已儲存')).toBeVisible()
    await page.reload()
    await expect(page.locator('main').getByText('caption before home and after')).toBeVisible()
  })

  test('stale and orphan drafts are discarded, a newer one is applied', async ({ page }) => {
    const id = await seed(page, { photos: [], diary: '另一個分頁後來存的' })

    await page.evaluate((tripId) => {
      localStorage.setItem(`journal-draft:${tripId}/diary`, JSON.stringify({ trip: tripId, text: '很久以前的草稿', at: 1, base: '0:0' }))
      localStorage.setItem('journal-draft:gone/diary', JSON.stringify({ trip: 'gone', text: '已刪除的回憶', at: Date.now(), base: '0:0' }))
      localStorage.setItem(`journal-draft:${tripId}/gone-photo`, JSON.stringify({ trip: tripId, photo: 'gone-photo', text: '已刪除的照片', at: Date.now(), base: '0:0' }))
    }, id)

    await openTrip(page, id)
    await expect(page.getByLabel('日記')).toHaveValue('另一個分頁後來存的')
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('journal-draft:')).length)).toBe(0)

    await page.evaluate((tripId) => {
      localStorage.setItem(`journal-draft:${tripId}/diary`, JSON.stringify({ trip: tripId, text: '比存檔新的草稿', at: Date.now() + 1000, base: '0:0' }))
    }, id)
    await page.reload()
    await expect(page.getByLabel('日記')).toHaveValue('比存檔新的草稿')
  })

  test('without localStorage the diary still autosaves', async ({ page }) => {
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith('journal-draft:')) throw new DOMException('full', 'QuotaExceededError')
        return set.call(this, k, v)
      }
    })

    const id = await seed(page, { photos: [] })
    await openTrip(page, id)
    await page.getByLabel('日記').fill('沒有草稿也存得起來')
    await expect(page.getByText('已自動儲存')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('日記')).toHaveValue('沒有草稿也存得起來')
  })

  test('typing into a 50,000-character diary stays quick', async ({ page }) => {
    const long = '山'.repeat(50_000)
    const id = await seed(page, { photos: [], diary: long })
    await openTrip(page, id)

    const field = page.getByLabel('日記')
    await field.focus()
    await page.evaluate(() => {
      const w = window as unknown as { __lag: number[] }
      w.__lag = []
      document.addEventListener('input', () => {
        const start = performance.now()
        queueMicrotask(() => setTimeout(() => w.__lag.push(performance.now() - start)))
      }, true)
    })
    await field.evaluate((t: HTMLTextAreaElement) => t.setSelectionRange(t.value.length, t.value.length))
    await page.keyboard.type('abcdefghijklmnopqrst', { delay: 20 })
    await expect(page.getByText('已自動儲存')).toBeVisible()

    const lag = await page.evaluate(() => (window as unknown as { __lag: number[] }).__lag)
    const draftCost = await field.evaluate((t: HTMLTextAreaElement) => {
      const times: number[] = []

      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        localStorage.setItem('journal-draft:measure', JSON.stringify({ trip: 'measure', text: t.value + i, at: Date.now(), base: '0:0' }))
        times.push(performance.now() - start)
      }

      localStorage.removeItem('journal-draft:measure')
      return times.sort((a, b) => a - b)[10]!
    })

    lag.sort((a, b) => a - b)
    console.log(`[${test.info().project.name}] keystroke to next task ${lag[Math.floor(lag.length / 2)]!.toFixed(1)} ms median; draft write ${draftCost.toFixed(2)} ms`)
    expect(draftCost).toBeLessThan(4)

    await page.reload()
    await expect(page.getByLabel('日記')).toHaveValue(`${long}abcdefghijklmnopqrst`)
  })
})

function walkGpx(sections: { lat: number; from: string }[]) {
  const segs = sections.map(({ lat, from }) => {
    const points = Array.from({ length: 6 }, (_, i) => {
      const t = new Date(Date.parse(from) + i * 60_000).toISOString()
      return `<trkpt lat="${(lat + i * 0.0003).toFixed(6)}" lon="121.2888"><ele>${3000 + i * 4}</ele><time>${t}</time></trkpt>`
    })

    return `<trkseg>${points.join('')}</trkseg>`
  })

  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk>${segs.join('')}</trk></gpx>`
}

async function recordRoute(page: Page) {
  await page.goto('./#/welcome')
  await page.evaluate(async () => {
    const lib = await (await import('/src/map/maplibre.ts' as string)).loadMapLibre()
    const w = window as unknown as { __route: unknown }
    const add = lib.Map.prototype.addSource

    lib.Map.prototype.addSource = function (this: any, id: string, spec: unknown) {
      const result = add.call(this, id, spec)

      if (id === 'route') {
        const source = this.getSource(id)
        const set = source.setData.bind(source)
        source.setData = (data: any, ...rest: unknown[]) => ((w.__route = data), set(data, ...rest))
      }

      return result
    }
  })
}

const recordedRoute = (page: Page) => page.evaluate(() => (window as unknown as { __route: any }).__route?.geometry as { type: string; coordinates: number[][] | number[][][] } | undefined)

test.describe('a recording gap', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  test('is not drawn across: the route has two parts, the profile breaks, scrubbing still works', async ({ page }) => {
    await recordRoute(page)
    const xml = walkGpx([
      { lat: 24.1674, from: '2026-11-07T00:00:00Z' },
      { lat: 24.2124, from: '2026-11-07T00:15:00Z' },
    ])

    const id = await seed(page, { photos: [], gpxXml: xml })
    await openTrip(page, id)

    await expect.poll(() => recordedRoute(page).then((g) => g?.type)).toBe('MultiLineString')

    const geometry = (await recordedRoute(page))!
    const parts = geometry.coordinates as number[][][]
    expect(parts.map((part) => part.length)).toEqual([6, 6])

    await expect(page.getByText('距離').locator('..')).toContainText('0.3 公里')
    await expect(page.getByText('爬升').locator('..')).toContainText('40 公尺')

    const chart = page.getByRole('img', { name: /海拔剖面/ })
    const strokes = await chart.locator('path').evaluateAll((paths) => paths.map((p) => (p.getAttribute('d') ?? '').match(/M/g)?.length ?? 0))
    expect(strokes).toEqual([2, 2])

    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
    await expect(page.getByText(/公里・.* 公尺/)).toBeVisible()
    expect(await routePixels(page)).toBeGreaterThan(50)
    await shot(page, 'gap-route')
  })

  test('a route without a gap stays one line', async ({ page }) => {
    await recordRoute(page)
    const id = await seed(page, { photos: [] })
    await openTrip(page, id)

    await expect.poll(() => recordedRoute(page).then((g) => g?.type)).toBe('LineString')
    expect(((await recordedRoute(page))!.coordinates as number[][]).length).toBeGreaterThan(100)

    const chart = page.getByRole('img', { name: /海拔剖面/ })
    const strokes = await chart.locator('path').evaluateAll((paths) => paths.map((p) => (p.getAttribute('d') ?? '').match(/M/g)?.length ?? 0))
    expect(strokes).toEqual([1, 1])
  })
})

test.describe('multi-day trips', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  test('a two-day trip shows the date range and a heading per day', async ({ page }) => {
    const id = await seed(page, { title: '合歡北峰兩天', photos: [], gpxXml: multiDayGpx('2026-11-07T06:00:00Z', '2026-11-08T02:00:00Z') })
    await openTrip(page, id)

    await expect(page.getByText('2026 年 11 月 7 日　週六 – 8 日　週日')).toBeVisible()
    await expect(page.locator('#journal-day')).toHaveText('這兩天')
    await expect(page.getByRole('heading', { level: 3, name: /第 \d 天/ })).toHaveText(['第 1 天11 月 7 日　週六', '第 2 天11 月 8 日　週日'])
    await expect(page.getByText('時間', { exact: true }).locator('..')).toContainText('20:00')
    await noHorizontalScroll(page)
    await shot(page, 'two-days', true)
  })

  test('a three-day trip across a month end', async ({ page }) => {
    const id = await seed(page, { title: '合歡北峰三天', photos: [], gpxXml: multiDayGpx('2026-11-29T00:00:00Z', '2026-12-01T08:00:00Z') })
    await openTrip(page, id)

    await expect(page.getByText('2026 年 11 月 29 日　週日 – 12 月 1 日　週二')).toBeVisible()
    await expect(page.locator('#journal-day')).toHaveText('這三天')
    await expect(page.getByRole('heading', { level: 3, name: /第 \d 天/ })).toHaveText(['第 1 天11 月 29 日　週日', '第 3 天12 月 1 日　週二'])
    await expect(page.getByText('時間', { exact: true }).locator('..')).toContainText('56:00')
  })
})

test.describe('layout details', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
    await useOkTiles(page)
  })

  for (const width of [320, 390, 1280]) {
    test(`map labels and pins stay clear of the controls at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 700 })
      const id = await seed(page)
      await openTrip(page, id)

      await expect(page.locator('section[aria-label="路線地圖"] .maplibregl-marker').getByText('合歡北峰', { exact: true })).toBeAttached({ timeout: 15_000 })
      await page.waitForTimeout(500)

      const clashes = await page.evaluate(() => {
        const hero = document.querySelector('section[aria-label="路線地圖"]')!
        const controls = [...hero.querySelectorAll('button, a')].filter((n) => !n.closest('.maplibregl-marker')).map((n) => n.getBoundingClientRect())
        const marks = [...hero.querySelectorAll('.maplibregl-marker')]
          .filter((m) => getComputedStyle(m).visibility !== 'hidden')
          .flatMap((m) => [...m.querySelectorAll('div')].filter((d) => d.textContent && !d.children.length).map((d) => d.closest('div[class*="poiLabel"]') ?? d))
          .map((n) => n.getBoundingClientRect())

        return marks.filter((r) => controls.some((c) => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top)).length
      })

      expect(clashes).toBe(0)

      const links = await page.locator('.maplibregl-ctrl-attrib a').evaluateAll((as) => as.map((a) => ({ h: a.getBoundingClientRect().height, target: a.getAttribute('target'), size: getComputedStyle(a).fontSize })))
      for (const link of links) {
        expect(link.h).toBeGreaterThanOrEqual(24)
        expect(link.target).toBe('_blank')
        expect(link.size).toBe('11px')
      }

      await noHorizontalScroll(page)
      await shot(page, 'map-top')
    })
  }

  test('an absurdly long title is clamped', async ({ page }) => {
    const id = await seed(page, { photos: [], title: '很長的名字'.repeat(40_000) })
    await openTrip(page, id)

    const box = await page.getByRole('heading', { level: 1 }).boundingBox()
    expect(box!.height).toBeLessThan(140)
    await noHorizontalScroll(page)
    await shot(page, 'long-title')
  })

  test('closing the viewer right after deleting a photo logs nothing', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' || /blob/i.test(m.text())) errors.push(m.text().slice(0, 120))
    })

    const id = await seed(page)
    await openTrip(page, id)

    for (let i = 0; i < 2; i++) {
      await photoButtons(page).first().click()
      await viewer(page).getByRole('button', { name: '刪除照片' }).click()
      await page.getByRole('button', { name: '刪除', exact: true }).click()
      await page.getByRole('button', { name: '關閉照片' }).click()
      await expect(viewer(page)).toBeHidden()
    }

    await expect(photoButtons(page)).toHaveCount(2)
    await page.waitForTimeout(500)
    expect(errors.filter((e) => !/401/.test(e))).toEqual([])
  })
})

test.describe('without the web fonts', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
  })

  for (const width of [390, 320]) {
    test(`headings fall back to a system kai font and nothing overflows at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const id = await seed(page, { title: '合歡北峰兩天一夜縱走看雲海與星空', gpxXml: multiDayGpx('2026-11-07T06:00:00Z', '2026-11-08T02:00:00Z') })
      await openTrip(page, id)

      expect(await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length)).toBe(0)
      await expect(page.getByRole('heading', { level: 3, name: /第 2 天/ })).toBeAttached()
      await noHorizontalScroll(page)
      await shot(page, 'no-webfont-top')

      await page.getByRole('heading', { level: 3, name: /第 2 天/ }).scrollIntoViewIfNeeded()
      await noHorizontalScroll(page)
      await shot(page, 'no-webfont-day2')
    })
  }
})

async function seedDated(page: Page, count: number): Promise<string> {
  const id = await seed(page, { title: '合歡北峰兩天', photos: [], gpxXml: multiDayGpx('2026-11-07T06:00:00Z', '2026-11-08T02:00:00Z') })

  await page.evaluate(
    async ({ id, count, STORAGE }) => {
      const base = new Uint8Array(await (await fetch('/tests/fixtures/hehuan-0720-gps.jpg')).arrayBuffer())
      const stamp = '2026:11:07 07:20:10'
      const at = base.findIndex((_, i) => stamp.split('').every((c, k) => base[i + k] === c.charCodeAt(0)))
      const files = []

      for (let n = 0; n < count; n++) {
        const minutes = 14 * 60 + 10 + Math.floor((n * (19 * 60 + 40)) / count)
        const day = minutes >= 24 * 60 ? '08' : '07'
        const m = minutes % (24 * 60)
        const text = `2026:11:${day} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
        const bytes = base.slice()
        bytes.set(Array.from(text, (c) => c.charCodeAt(0)), at)
        files.push(new File([bytes], `p${n}.jpg`, { type: 'image/jpeg' }))
      }

      await (await import(STORAGE)).addPhotos(id, files)
    },
    { id, count, STORAGE },
  )

  return id
}

test.describe('scrolling a long two-day timeline', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  test('rows never change size while scrolling, and returning from the viewer keeps the place', async ({ page }) => {
    const id = await seedDated(page, 24)
    await openTrip(page, id)
    await expect(photoButtons(page)).toHaveCount(24)
    await page.waitForTimeout(1500)

    const before = await page.evaluate(() => document.documentElement.scrollHeight)
    const height = await page.evaluate(() => innerHeight)

    for (let k = 0; k <= Math.ceil(before / height); k++) {
      await page.evaluate((y) => window.scrollTo(0, y), k * height)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-scroll-${String(k).padStart(2, '0')}.png` })
    }

    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(before)

    const target = photoButtons(page).nth(12)
    await target.scrollIntoViewIfNeeded()
    const top = await target.evaluate((n) => n.getBoundingClientRect().top)
    const y = await page.evaluate(() => scrollY)

    await target.click()
    await expect(viewer(page)).toBeVisible()
    await page.goBack()
    await expect(viewer(page)).toBeHidden()

    expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(2)
    expect(Math.abs((await target.evaluate((n) => n.getBoundingClientRect().top)) - top)).toBeLessThan(2)
  })
})

test.describe('keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  test('the viewer, menu and dialogs return focus to what opened them', async ({ page }) => {
    const id = await seed(page)
    await openTrip(page, id)

    const opener = photoButtons(page).nth(1)
    await opener.focus()
    await page.keyboard.press('Enter')
    await expect(viewer(page)).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(viewer(page).getByText('第 3 張，共 4 張')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer(page)).toBeHidden()
    await expect(opener).toBeFocused()

    const more = page.getByRole('button', { name: '更多選項' })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '這篇回憶' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '這篇回憶' })).toBeHidden()
    await expect(more).toBeFocused()

    const edit = page.getByRole('button', { name: '修改名稱' })
    await edit.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('這趟的名字')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(edit).toBeFocused()
    expect(await overlayLevel(page)).toBe(0)
  })
})

type Box = { x: number; y: number; width: number; height: number }

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const SIZES = [
  [568, 320],
  [667, 375],
  [844, 390],
  [932, 430],
  [390, 844],
  [320, 568],
] as const

test.describe('the photo viewer on short and small screens', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  for (const [width, height] of SIZES) {
    test(`${width}x${height}: photo, details and controls never overlap and every control is reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      const id = await seed(page, { photos: PHOTOS.slice(0, 2) })
      await openTrip(page, id)

      await photoButtons(page).first().click()
      const viewer = page.getByRole('dialog', { name: '照片' })
      const photo = viewer.getByRole('img')
      await expect(photo).toBeVisible()
      await page.waitForFunction(() => document.querySelector<HTMLImageElement>('dialog img')?.complete)

      const box = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!
      const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.width <= width + 0.5 && b.y + b.height <= height + 0.5

      for (const target of [viewer.getByLabel('照片說明'), viewer.getByRole('button', { name: /設為封面|這是封面/ }), viewer.getByRole('button', { name: '刪除照片' })]) {
        await target.scrollIntoViewIfNeeded()
        await expect(target).toBeVisible()
        const b = await box(target)
        expect(inside(b), 'control is inside the viewport').toBe(true)
        expect(overlaps(await box(photo), b), 'photo does not cover the control').toBe(false)
      }

      const caption = await box(viewer.getByLabel('照片說明'))
      const photoBox = await box(photo)
      expect(overlaps(photoBox, caption)).toBe(false)

      const close = await box(viewer.getByRole('button', { name: '關閉照片' }))
      const count = await box(viewer.getByText('第 1 張，共 2 張'))
      const next = await box(viewer.getByRole('button', { name: '下一張' }))

      for (const b of [close, count, next]) expect(inside(b)).toBe(true)
      expect(overlaps(close, count)).toBe(false)
      expect(overlaps(close, photoBox)).toBe(false)
      expect(overlaps(count, photoBox)).toBe(false)
      expect(photoBox.width).toBeGreaterThan(100)
      expect(photoBox.height).toBeGreaterThan(100)

      await viewer.getByLabel('照片說明').fill('橫放也能寫')
      await expect(viewer.getByLabel('照片說明')).toHaveValue('橫放也能寫')
      await shot(page, `viewer-${width}x${height}`)
    })
  }

  test('1280x800: the desktop layout keeps a centred panel under the photo', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const id = await seed(page, { photos: PHOTOS.slice(0, 2) })
    await openTrip(page, id)

    await photoButtons(page).first().click()
    const viewer = page.getByRole('dialog', { name: '照片' })
    await expect(viewer.getByRole('img')).toBeVisible()

    const photo = (await viewer.getByRole('img').boundingBox())!
    const caption = (await viewer.getByLabel('照片說明').boundingBox())!
    expect(overlaps(photo, caption)).toBe(false)
    expect(caption.y).toBeGreaterThan(photo.y + photo.height - 1)
    await shot(page, 'viewer-1280x800')
  })
})

test.describe('keyboard focus is visible on the journal controls', () => {
  test.beforeEach(async ({ page }) => {
    await useFakeKey(page)
  })

  const focused = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const ring = el.matches('button') && el.firstElementChild ? (el.firstElementChild as HTMLElement) : el
      const c = getComputedStyle(ring)
      return { outline: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2, shadow: c.boxShadow !== 'none' }
    })

  test('photo pins on the map and the diary and caption fields', async ({ page }) => {
    const id = await seed(page, { photos: PHOTOS.slice(0, 2), diary: '天氣很好' })
    await openTrip(page, id)

    await page.keyboard.press('Tab')

    const pin = page.locator('section[aria-label="路線地圖"]').getByRole('button', { name: /^打開照片/ }).first()
    await expect(pin).toBeVisible()
    await pin.focus()
    expect((await focused(page)).outline).toBe(true)
    await shot(page, 'focus-pin')

    const diary = page.getByLabel('日記')
    await diary.scrollIntoViewIfNeeded()
    await page.keyboard.press('Tab')
    await diary.focus()
    expect((await focused(page)).outline).toBe(true)
    await shot(page, 'focus-diary')
    await diary.blur()

    await photoButtons(page).first().click()
    const caption = page.getByRole('dialog', { name: '照片' }).getByLabel('照片說明')
    await page.keyboard.press('Tab')
    await caption.focus()
    expect((await focused(page)).outline).toBe(true)
    await shot(page, 'focus-caption')
  })
})
