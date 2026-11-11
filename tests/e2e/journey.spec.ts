import { expect, test, type Page } from '@playwright/test'
import { routePixels, watch } from './helpers'

const key = process.env.THUNDERFOREST_API_KEY
const SHOTS = process.env.JOURNEY_SHOTS
const fixture = (name: string) => `tests/fixtures/${name}`
const PHOTOS = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg'].map(fixture)
const DIARY = '風很大，但雲海值得。'
const CAPTION = '登頂！'

test.skip(!key, 'needs THUNDERFOREST_API_KEY')

async function shot(page: Page, name: string, { desktop = true, end = false } = {}) {
  if (!SHOTS) return

  const project = test.info().project.name
  const take = async (width: number) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${SHOTS}/${project}-${width}-${name}.png` })
    if (!end) return
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/${project}-${width}-${name}-end.png` })
    await page.evaluate(() => window.scrollTo(0, 0))
  }

  await take(390)
  if (!desktop) return

  await page.setViewportSize({ width: 1280, height: 800 })
  await take(1280)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
}

const photoButtons = (page: Page) => page.locator('ol').getByRole('button', { name: /^打開照片/ })

test('a new user walks the whole product', async ({ page, baseURL }) => {
  test.setTimeout(300_000)

  const problems = watch(page, new URL(baseURL!).origin)
  let tiles = 0
  page.on('response', (r) => {
    if (r.url().startsWith('https://tile.thunderforest.com/') && r.ok()) tiles++
  })

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined })
  })

  await page.goto('./')
  await expect(page).toHaveURL(/#\/welcome$/)
  await expect(page.getByText('第 1 步，共 4 步')).toBeVisible()
  await shot(page, 'welcome-1')

  await page.getByRole('button', { name: '開始領取' }).click()
  await expect(page.getByRole('link', { name: '開啟註冊頁' })).toBeVisible()
  await shot(page, 'welcome-2', { end: true })

  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await shot(page, 'welcome-3')

  await page.getByLabel('地圖鑰匙（API Key）').fill(key!)
  await expect(page.getByText('鑰匙可以用了！')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '都準備好了' })).toBeVisible()
  await shot(page, 'welcome-4')
  await page.getByRole('button', { name: '進入 App' }).click()

  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { name: '把走過的山，變成一篇日誌' })).toBeVisible()
  await shot(page, 'home-empty', { end: true })

  await page.getByRole('link', { name: '新的回憶' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '新的回憶' })).toBeVisible()
  await shot(page, 'new-empty')
  await page.locator('input[type=file]').nth(0).setInputFiles(fixture('hehuan-north.gpx'))
  await page.locator('input[type=file]').nth(1).setInputFiles(PHOTOS)
  await expect(page.getByText('已選 4 張照片')).toBeVisible()
  await expect(page.getByLabel('這趟的名字')).toHaveValue('合歡北峰')
  await shot(page, 'new-filled', { end: true })

  await page.evaluate(() => {
    const seen: string[] = ((window as { progressSeen?: string[] }).progressSeen = [])
    new MutationObserver(() => {
      const now = document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')
      if (now && seen.at(-1) !== now) seen.push(now)
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  })
  await page.getByRole('button', { name: '建立回憶' }).click()
  if (SHOTS) {
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /[1-3]/, { timeout: 5_000 }).catch(() => {})
    await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-390-new-saving.png` })
  }

  await expect(page.getByRole('heading', { level: 1, name: '回憶存好了' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('加入了 4 張照片')).toBeVisible()
  expect(await page.evaluate(() => (window as { progressSeen?: string[] }).progressSeen)).toEqual(expect.arrayContaining(['1', '2', '3', '4']))
  await shot(page, 'new-result')
  await page.getByRole('button', { name: '看這趟日誌' }).click()

  await expect(page).toHaveURL(/#\/trip\/[^/]+$/)
  const journal = page.url()
  await expect(page.getByRole('heading', { level: 1, name: '合歡北峰' })).toBeVisible()
  await expect(page.getByText('3.7 公里')).toBeVisible()
  await expect(page.getByText('429 公尺')).toBeVisible()
  await expect(page.getByText('5:00 小時')).toBeVisible()
  await expect(page.locator('ol > li').filter({ hasText: '合歡北峰' }).filter({ hasText: '山頂' })).toHaveCount(1)
  await expect(photoButtons(page)).toHaveCount(4)

  await expect.poll(() => tiles, { timeout: 20_000 }).toBeGreaterThan(0)
  await expect.poll(() => routePixels(page), { timeout: 15_000 }).toBeGreaterThan(100)
  await expect(page.getByText('地圖暫時打不開')).toHaveCount(0)
  await shot(page, 'journal-top')

  await page.getByLabel('日記').fill(DIARY)
  await expect(page.getByText('已自動儲存')).toBeVisible()
  await page.getByLabel('日記').blur()
  await page.evaluate(() => window.scrollTo(0, 700))
  await shot(page, 'journal-timeline')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await shot(page, 'journal-diary')

  await photoButtons(page).nth(2).click()
  const viewer = page.getByRole('dialog', { name: '照片' })
  await viewer.getByLabel('照片說明').fill(CAPTION)
  await expect(viewer.getByText('已儲存')).toBeVisible()
  await shot(page, 'journal-viewer')
  await viewer.getByRole('button', { name: '關閉照片' }).click()
  await expect(viewer).toBeHidden()
  await expect(page).toHaveURL(journal)

  await page.getByRole('button', { name: '更多選項' }).click()
  await shot(page, 'journal-menu')
  await page.keyboard.press('Escape')

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole('link', { name: '立體播放' }).click()
  const flight = page.locator('[data-phase]')
  await expect(flight).toHaveAttribute('data-phase', 'ready', { timeout: 60_000 })
  await expect(flight).toHaveAttribute('data-state', 'playing')
  await expect(page.getByRole('button', { name: '放大這張照片' })).toBeVisible({ timeout: 45_000 })
  await shot(page, 'flyover-photo', { desktop: false })
  await page.getByRole('button', { name: '關閉播放' }).click()
  await expect(page).toHaveURL(journal)

  await page.getByRole('button', { name: '回首頁' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('img', { name: '合歡北峰的封面照片' })).toBeVisible()
  await shot(page, 'home-trip')

  await page.getByRole('link', { name: /合歡北峰/ }).first().click()
  await page.getByRole('button', { name: '更多選項' }).click()
  await page.getByRole('button', { name: '匯出這篇回憶' }).click()
  const exporting = page.getByRole('dialog', { name: '匯出這篇回憶' })
  await expect(exporting.getByText('檔案準備好了')).toBeVisible({ timeout: 15_000 })
  await shot(page, 'journal-export', { desktop: false })
  const download = page.waitForEvent('download')
  await exporting.getByRole('button', { name: '儲存匯出檔' }).click()
  const zip = test.info().outputPath('trip.hiking.zip')
  await (await download).saveAs(zip)

  await page.getByRole('button', { name: '更多選項' }).click()
  await page.getByRole('button', { name: '刪除這篇回憶' }).click()
  await shot(page, 'journal-delete', { desktop: false })
  await page.getByRole('dialog', { name: '刪除這篇回憶？' }).getByRole('button', { name: '刪除回憶' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { name: '把走過的山，變成一篇日誌' })).toBeVisible()

  await page.getByRole('link', { name: '設定' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible()
  await shot(page, 'settings', { end: true })
  await page.locator('input[type=file]').setInputFiles(zip)

  await expect(page).toHaveURL(/#\/trip\/[^/]+$/, { timeout: 30_000 })
  const check = async () => {
    await expect(page.getByRole('heading', { level: 1, name: '合歡北峰' })).toBeVisible()
    await expect(page.getByLabel('日記')).toHaveValue(DIARY)
    await expect(photoButtons(page)).toHaveCount(4)
    await expect(page.locator('ol').getByText(CAPTION)).toBeVisible()
    await expect(page.getByText(/地圖暫時打不開|地圖需要網路|地圖沒有載入|無法顯示地圖/)).toHaveCount(0)
    await expect.poll(() => routePixels(page), { timeout: 30_000 }).toBeGreaterThan(100)
  }
  await check()

  await page.reload()
  await check()

  await page.getByRole('button', { name: '回首頁' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('img', { name: '合歡北峰的封面照片' })).toBeVisible()

  expect(problems).toEqual([])
})
