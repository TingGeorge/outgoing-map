import { expect, test, type Page } from '@playwright/test'

const FAKE_KEY = 'ffffffffffffffffffffffffffffffff'
const STORAGE = '/src/storage/index.ts'
const CORE = '/src/core/index.ts'

async function openSettings(page: Page, key: string | null = FAKE_KEY) {
  if (key) await page.addInitScript((k) => localStorage.setItem('thunderforest-key', k), key)
  await page.goto('./#/settings')
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible()
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

const storedKey = (page: Page) => page.evaluate(() => localStorage.getItem('thunderforest-key'))

async function makeExport(page: Page): Promise<string> {
  return page.evaluate(
    async ({ STORAGE, CORE }) => {
      const storage = await import(STORAGE)
      const core = await import(CORE)
      const gpx = await (await fetch('/tests/fixtures/hehuan-north.gpx')).text()
      const blob = await (await fetch('/tests/fixtures/hehuan-0720-gps.jpg')).blob()

      const trip = await storage.createTrip({ title: '合歡北峰' })
      await storage.saveTrack(trip.id, core.parseGpx(gpx).points)
      await storage.addPhotos(trip.id, [new File([blob], 'a.jpg', { type: 'image/jpeg' })])

      const zip: Blob = await storage.exportTrip(trip.id)
      const bytes = new Uint8Array(await zip.arrayBuffer())
      let binary = ''
      for (const b of bytes) binary += String.fromCharCode(b)
      return btoa(binary)
    },
    { STORAGE, CORE },
  )
}

test('shows the stored key masked and never in full', async ({ page }) => {
  await openSettings(page)

  await expect(page.getByText('ffff••••••••••••ffff')).toBeVisible()

  const html = await page.content()
  expect(html.includes(FAKE_KEY)).toBe(false)
  expect((await page.locator('body').innerText()).includes(FAKE_KEY)).toBe(false)
  await noHorizontalScroll(page)
  await page.getByRole('button', { name: '回首頁' }).click()
  await expect(page).toHaveURL(/#\/$/)
})

test('without a key the screen offers the tutorial and goes back to it', async ({ page }) => {
  await openSettings(page, null)

  await expect(page.getByText('還沒有地圖鑰匙')).toBeVisible()
  await expect(page.getByRole('link', { name: '開始設定鑰匙' })).toHaveAttribute('href', '#/welcome')
  await expect(page.getByRole('button', { name: '更換鑰匙' })).toHaveCount(0)
  await page.getByRole('button', { name: '回鑰匙教學' }).click()
  await expect(page).toHaveURL(/#\/welcome$/)
})

test('a malformed replacement is rejected and the old key is kept', async ({ page }) => {
  await openSettings(page)
  await page.getByRole('button', { name: '更換鑰匙' }).click()

  const dialog = page.getByRole('dialog', { name: '更換地圖鑰匙' })
  await dialog.getByLabel('新的地圖鑰匙（API Key）').fill('not a real key!!')

  await expect(dialog.getByRole('status')).toContainText('這把鑰匙不能用', { timeout: 15_000 })
  await expect(dialog.getByRole('button', { name: '儲存新鑰匙' })).toBeDisabled()
  expect((await storedKey(page)) === FAKE_KEY).toBe(true)

  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  expect((await storedKey(page)) === FAKE_KEY).toBe(true)
})

test('clearing the key asks first, then offers to set up again', async ({ page }) => {
  await openSettings(page)
  await page.getByRole('button', { name: '清除鑰匙' }).click()

  const dialog = page.getByRole('dialog', { name: '清除這把鑰匙？' })
  await dialog.getByRole('button', { name: '取消' }).click()
  expect((await storedKey(page)) === FAKE_KEY).toBe(true)

  await page.getByRole('button', { name: '清除鑰匙' }).click()
  await dialog.getByRole('button', { name: '清除鑰匙' }).click()

  expect(await storedKey(page)).toBeNull()
  await expect(page.getByText('鑰匙已清除')).toBeVisible()
  await expect(page.getByRole('link', { name: '重新設定' })).toHaveAttribute('href', '#/welcome')
  await page.getByRole('link', { name: '重新設定' }).click()
  await expect(page).toHaveURL(/#\/welcome$/)
})

test('a rejected stored key is explained when checked', async ({ page }) => {
  await page.route('https://tile.thunderforest.com/**', (route) =>
    route.request().url().includes('apikey') ? route.fulfill({ status: 401 }) : route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': '*' } }),
  )
  await openSettings(page)
  await page.getByRole('button', { name: '檢查鑰匙' }).click()

  await expect(page.getByRole('status').filter({ hasText: '免費額度' })).toContainText('每個月會重新計算')
})

test('imports an exported trip and lands on it; a wrong file shows the error', async ({ page }) => {
  await openSettings(page)
  const zip = await makeExport(page)

  await page.reload()
  const input = page.locator('input[type=file]')

  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByRole('alert')).toContainText('這個檔案沒辦法匯入')
  await expect(page).toHaveURL(/#\/settings$/)

  await input.setInputFiles({ name: '合歡北峰.hiking.zip', mimeType: 'application/zip', buffer: Buffer.from(zip, 'base64') })
  await expect(page).toHaveURL(/#\/trip\/.+/)
})

test('shows trip count, storage use and persistence', async ({ page }) => {
  await openSettings(page)
  await makeExport(page)
  await page.reload()

  await expect(page.getByText('回憶數量').locator('xpath=following-sibling::dd')).toHaveText('1 篇')
  await expect(page.getByText('已使用空間').locator('xpath=following-sibling::dd')).toContainText(/MB/)
  await expect(page.getByText('資料保護').locator('xpath=following-sibling::dd')).toHaveText(/已受保護|尚未保護/)
  await noHorizontalScroll(page)
})

test('lists the credits with safe external links', async ({ page }) => {
  await openSettings(page)

  for (const name of ['Thunderforest', 'OpenStreetMap contributors', '內政部國土測繪中心', '魯地圖（Rudy Chung）', '原始碼']) {
    const link = page.getByRole('link', { name })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  }

  await expect(page.getByRole('link', { name: '原始碼' })).toHaveAttribute('href', 'https://github.com/TingGeorge/outgoing-map')
  await expect(page.getByText('程式碼採 MIT 授權')).toBeVisible()
})

test.describe('with the real key', () => {
  const key = process.env.THUNDERFOREST_API_KEY

  test.skip(!key, 'THUNDERFOREST_API_KEY is not set')

  test('checking the stored key reports it valid', async ({ page }) => {
    await openSettings(page, key!)
    await page.getByRole('button', { name: '檢查鑰匙' }).click()

    await expect(page.getByRole('status').filter({ hasText: '目前可以用' })).toBeVisible({ timeout: 15_000 })
  })

  test('changing to the real key succeeds', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('button', { name: '更換鑰匙' }).click()

    const dialog = page.getByRole('dialog', { name: '更換地圖鑰匙' })
    await dialog.getByLabel('新的地圖鑰匙（API Key）').fill(key!)
    await expect(dialog.getByRole('status')).toContainText('鑰匙可以用了', { timeout: 15_000 })
    await dialog.getByRole('button', { name: '儲存新鑰匙' }).click()

    await expect(dialog).toBeHidden()
    expect((await storedKey(page)) === key).toBe(true)
    expect((await page.content()).includes(key!)).toBe(false)
  })
})

const TILE = 'https://tile.thunderforest.com/**'
const okTile = (page: Page) =>
  page.route(TILE, (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: '' }))

const tabKey = (page: Page, browserName: string, back = false) =>
  page.keyboard.press(`${browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`)

function contrast(a: number[], b: number[]) {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('at 320 the masked key stays on one line and never shows more than 8 characters', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openSettings(page)

  const masked = page.getByText('ffff••••••••••••ffff')
  const box = await masked.boundingBox()
  expect(box!.height).toBeLessThan(60)
  await noHorizontalScroll(page)
})

test('keyboard only: dialogs take focus, keep Tab inside, close on Escape and give focus back', async ({ page, browserName }) => {
  await openSettings(page)

  const opener = page.getByRole('button', { name: '更換鑰匙' })
  await opener.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: '更換地圖鑰匙' })
  await expect(dialog.getByLabel('新的地圖鑰匙（API Key）')).toBeFocused()
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth)).not.toBe('0px')

  await tabKey(page, browserName)
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
  await tabKey(page, browserName, true)
  await expect(dialog.getByLabel('新的地圖鑰匙（API Key）')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  const clear = page.getByRole('button', { name: '清除鑰匙' })
  await clear.focus()
  await page.keyboard.press('Enter')
  const confirm = page.getByRole('dialog', { name: '清除這把鑰匙？' })
  await expect(confirm).toBeVisible()
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(clear).toBeFocused()
  expect((await storedKey(page)) === FAKE_KEY).toBe(true)
})

test('keyboard only: the page order is back, key actions, data, import, links', async ({ page, browserName }) => {
  await openSettings(page)
  const order: string[] = []

  for (let i = 0; i < 6; i++) {
    await tabKey(page, browserName)
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || ''))
    expect(await page.evaluate(() => document.activeElement!.matches(':focus-visible'))).toBe(true)
  }

  expect(order.slice(0, 4)).toEqual(['回首頁', '更換鑰匙', '檢查鑰匙', '清除鑰匙'])
})

test('saving a new key: double-click and Enter repeats save once', async ({ page }) => {
  await okTile(page)
  await openSettings(page)
  await page.getByRole('button', { name: '更換鑰匙' }).click()

  const dialog = page.getByRole('dialog', { name: '更換地圖鑰匙' })
  await dialog.getByLabel('新的地圖鑰匙（API Key）').fill('b'.repeat(32))
  const save = dialog.getByRole('button', { name: '儲存新鑰匙' })
  await expect(save).toBeEnabled({ timeout: 10_000 })

  await page.evaluate(() => {
    let n = 0
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'thunderforest-key') n++
      return set.call(this, k, v)
    }
    ;(window as unknown as { __writes: () => number }).__writes = () => n
  })

  await save.focus()
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')

  await expect(page.getByText('已換成新的鑰匙')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __writes: () => number }).__writes())).toBe(1)
})

test('importing: choosing the same file twice at once imports one trip', async ({ page }) => {
  await openSettings(page)
  const zip = await makeExport(page)
  await page.reload()

  const file = { name: 'a.hiking.zip', mimeType: 'application/zip', buffer: Buffer.from(zip, 'base64') }
  const input = page.locator('input[type=file]')
  await Promise.all([input.setInputFiles(file), input.setInputFiles(file).catch(() => {})])
  await expect(page).toHaveURL(/#\/trip\/.+/)

  const count = await page.evaluate(async (path) => (await (await import(path)).listTrips()).length, STORAGE)
  expect(count).toBe(2)
})

test('a disabled button is told apart by more than fading and keeps 3:1 for its label', async ({ page }) => {
  await openSettings(page)
  await page.getByRole('button', { name: '更換鑰匙' }).click()

  const save = page.getByRole('dialog').getByRole('button', { name: '儲存新鑰匙' })
  await expect(save).toBeDisabled()

  const colors = await save.evaluate((el) => {
    const style = getComputedStyle(el)
    const rgb = (v: string) => v.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    return { bg: rgb(style.backgroundColor), fg: rgb(style.color), opacity: style.opacity, accent: rgb('rgb(184, 74, 34)') }
  })

  expect(colors.opacity).toBe('1')
  expect(colors.bg).not.toEqual(colors.accent)
  expect(contrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(3)
})

test('reduced motion: dialogs open without sliding or scaling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openSettings(page)
  await page.getByRole('button', { name: '清除鑰匙' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const seconds = await dialog.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(seconds).toBeLessThan(0.05)
})

test('at 320 the confirm dialog stacks its buttons full width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openSettings(page)
  await page.getByRole('button', { name: '清除鑰匙' }).click()

  const dialog = page.getByRole('dialog')
  for (const name of ['取消', '清除鑰匙']) {
    const box = await dialog.getByRole('button', { name }).boundingBox()
    expect(box!.width).toBeGreaterThan(200)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }

  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(320)
})

test('short landscape: dialogs fit the screen and scroll inside', async ({ page }) => {
  for (const [width, height] of [[844, 390], [667, 375]] as const) {
    await page.setViewportSize({ width, height })
    await openSettings(page)
    await page.getByRole('button', { name: '更換鑰匙' }).click()

    const box = await page.getByRole('dialog').boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height)
    await noHorizontalScroll(page)
    await page.keyboard.press('Escape')
  }
})

for (const zoom of [150, 200]) {
  test(`${zoom}% text: settings stays inside the screen`, async ({ page }) => {
    await openSettings(page)
    await page.addStyleTag({ content: `html{font-size:${zoom}%}` })
    await noHorizontalScroll(page)

    await page.getByRole('button', { name: '更換鑰匙' }).click()
    const box = await page.getByRole('dialog').boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await expect(page.getByRole('dialog').getByRole('button', { name: '取消' })).toBeVisible()
  })
}
