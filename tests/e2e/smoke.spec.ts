import { expect, test, type Page } from '@playwright/test'
import { watch } from './helpers'

const FAKE_KEY = 'ffffffffffffffffffffffffffffffff'

async function seedTrip(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const storage = await import('/src/storage/index.ts' as string)
    const core = await import('/src/core/index.ts' as string)
    const trip = await storage.createTrip({ title: '合歡北峰' })
    await storage.saveTrack(trip.id, core.parseGpx(await (await fetch('/tests/fixtures/hehuan-north.gpx')).text()).points)
    return trip.id as string
  })
}

test('without a key, the app opens the key tutorial', async ({ page }) => {
  await page.goto('./#/')
  await expect(page).toHaveURL(/#\/welcome$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('鑰匙')
})

test.describe('with a stored key', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem('thunderforest-key', key), FAKE_KEY)
    await page.route('https://tile.thunderforest.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: '' }))
  })

  test('every route renders its screen, survives a reload, and an unknown route goes home', async ({ page }) => {
    await page.goto('./#/')
    await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()
    const id = await seedTrip(page)

    for (const [hash, heading] of [
      ['#/new', '新的回憶'],
      [`#/trip/${id}`, '合歡北峰'],
      [`#/trip/${id}/fly`, '立體播放'],
      ['#/settings', '設定'],
    ] as const) {
      await page.goto(`./${hash}`)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached()
      await page.reload()
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached()
    }

    await page.goto('./#/nowhere')
    await expect(page).toHaveURL(/#\/$/)
  })

  test('Back walks the screens in order and the in-app back buttons match it', async ({ page }) => {
    await page.goto('./#/')
    const id = await seedTrip(page)
    await page.reload()

    await page.getByRole('link', { name: /合歡北峰/ }).click()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
    await page.getByRole('link', { name: '立體播放' }).click()
    await expect(page).toHaveURL(/\/fly$/)

    await page.getByRole('button', { name: '關閉播放' }).click()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))
    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page).toHaveURL(/#\/$/)

    await page.getByRole('link', { name: '設定' }).click()
    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page).toHaveURL(/#\/$/)

    await page.goForward()
    await expect(page).toHaveURL(/#\/settings$/)
    await page.goBack()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()
  })

  test('from a deep link, the in-app back buttons land on the parent screen', async ({ page }) => {
    await page.goto('./#/')
    const id = await seedTrip(page)

    const deepLink = async (hash: string) => {
      await page.goto('about:blank')
      await page.goto(`./${hash}`)
    }

    await deepLink(`#/trip/${id}/fly`)
    await page.getByRole('button', { name: '關閉播放' }).click()
    await expect(page).toHaveURL(new RegExp(`#/trip/${id}$`))

    await deepLink(`#/trip/${id}`)
    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page).toHaveURL(/#\/$/)

    await deepLink('#/settings')
    await page.getByRole('button', { name: '回首頁' }).click()
    await expect(page).toHaveURL(/#\/$/)
  })

  test('a malformed link like #/trip/% goes home instead of a blank screen', async ({ context, baseURL }) => {
    for (const bad of ['#/trip/%', '#/trip/%E0%A4%A/fly', '#/%zz']) {
      const page = await context.newPage()
      await page.addInitScript((key) => localStorage.setItem('thunderforest-key', key), FAKE_KEY)
      const problems = watch(page, new URL(baseURL!).origin)

      await page.goto(`./${bad}`)
      await expect(page).toHaveURL(/#\/$/)
      await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()
      expect(problems).toEqual([])
      await page.close()
    }
  })

  test('on #/new with picked files, every Back asks again until 離開 is chosen', async ({ page }) => {
    await page.goto('./#/')
    await page.getByRole('link', { name: '新的回憶' }).click()
    await page.locator('input[type=file]').nth(0).setInputFiles('tests/fixtures/hehuan-north.gpx')
    await expect(page.getByText('hehuan-north.gpx')).toBeVisible()

    const dialog = page.getByRole('heading', { name: '要離開嗎？' })

    await page.goBack()
    await expect(dialog).toBeVisible()
    await page.goBack()
    await page.goBack()
    await expect(page).toHaveURL(/#\/new$/)
    await expect(dialog).toBeVisible()

    await page.getByRole('button', { name: '留下來' }).click()
    await expect(dialog).toBeHidden()
    await Promise.all([page.goBack(), page.goBack()])
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/#\/new$/)

    await page.getByRole('button', { name: '離開' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()
  })

  test('on #/new while saving, quick Backs stay on the screen and the save finishes', async ({ page }) => {
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle)
      let release = () => {}
      const held = new Promise<void>((r) => (release = r))
      ;(window as { releaseSave?: () => void }).releaseSave = release
      crypto.subtle.digest = async (...args: Parameters<SubtleCrypto['digest']>) => {
        await held
        return digest(...args)
      }
    })

    await page.goto('./#/')
    await page.getByRole('link', { name: '新的回憶' }).click()
    await page.locator('input[type=file]').nth(1).setInputFiles('tests/fixtures/hehuan-0720-gps.jpg')
    await page.getByRole('button', { name: '建立回憶' }).click()
    await expect(page.getByText('正在處理照片')).toBeVisible()

    await Promise.all([page.goBack(), page.goBack()])
    await page.goBack()
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(/#\/new$/)
    await expect(page.getByText('正在處理照片')).toBeVisible()

    await page.evaluate(() => (window as { releaseSave?: () => void }).releaseSave!())
    await expect(page.getByRole('button', { name: '看這趟日誌' })).toBeVisible({ timeout: 30_000 })
  })

  test.describe('a lazy screen whose chunk is gone after an update', () => {
    const CHUNK = '**/src/screens/new-trip/index.tsx*'
    const failed = (page: Page) => page.getByText('這個畫面沒有打開')

    test('reloads once to the intended route and lands on the screen', async ({ page }) => {
      await page.goto('./#/')
      await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()

      let hits = 0
      await page.route(CHUNK, (route) => (hits++ === 0 ? route.abort() : route.continue()))

      await page.getByRole('link', { name: '新的回憶' }).click()
      await expect(page.getByRole('heading', { level: 1, name: '新的回憶' })).toBeAttached()
      await expect(page).toHaveURL(/#\/new$/)
      await expect(failed(page)).toHaveCount(0)
    })

    test('reloads exactly once when the chunk keeps failing, then shows the error screen', async ({ page }) => {
      await page.goto('./#/')
      await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()

      let loads = 0
      page.on('load', () => loads++)
      await page.route(CHUNK, (route) => route.abort())

      await page.getByRole('link', { name: '新的回憶' }).click()
      await expect(failed(page)).toBeVisible()
      await page.waitForTimeout(1500)
      expect(loads).toBe(1)
      await expect(failed(page)).toBeVisible()
      await expect(page).toHaveURL(/#\/new$/)
      await expect(page.getByRole('button', { name: '重新載入' })).toBeVisible()
    })

    test('does not reload while offline and says so', async ({ page }) => {
      await page.goto('./#/')
      await expect(page.getByRole('heading', { level: 1, name: /想回味哪一座山/ })).toBeVisible()

      let loads = 0
      page.on('load', () => loads++)
      await page.route(CHUNK, (route) => route.abort())
      await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))

      await page.getByRole('link', { name: '新的回憶' }).click()
      await expect(page.getByText('現在沒有連上網路')).toBeVisible()
      await page.waitForTimeout(1000)
      expect(loads).toBe(0)
    })

    test('reloads to the journal after a completed create', async ({ page }) => {
      await page.goto('./#/')
      await page.getByRole('link', { name: '新的回憶' }).click()
      await page.locator('input[type=file]').nth(0).setInputFiles('tests/fixtures/hehuan-north.gpx')
      await page.getByRole('button', { name: '建立回憶' }).click()
      await expect(page.getByRole('button', { name: '看這趟日誌' })).toBeVisible({ timeout: 30_000 })

      let hits = 0
      let loads = 0
      page.on('load', () => loads++)
      await page.route('**/src/screens/journal/index.tsx*', (route) => (hits++ === 0 ? route.abort() : route.continue()))

      await page.getByRole('button', { name: '看這趟日誌' }).click()
      await expect(page).toHaveURL(/#\/trip\//)
      await expect(page.getByRole('heading', { level: 1 })).toBeAttached()
      await expect(failed(page)).toHaveCount(0)
      expect(loads).toBe(Math.min(hits, 1))
    })

    test('does not reload from under a half-filled create form', async ({ page }) => {
      await page.goto('./#/')
      await page.getByRole('link', { name: '新的回憶' }).click()
      await page.locator('input[type=file]').nth(0).setInputFiles('tests/fixtures/hehuan-north.gpx')
      await expect(page.getByText('hehuan-north.gpx')).toBeVisible()

      let loads = 0
      page.on('load', () => loads++)
      await page.route('**/src/screens/settings/index.tsx*', (route) => route.abort())
      await page.evaluate(() => (location.hash = '#/settings'))

      await expect(failed(page)).toBeVisible()
      await page.waitForTimeout(1000)
      expect(loads).toBe(0)
    })
  })

  test('a sheet opened by tap shows no focus ring, by keyboard it does, and a toast shows above it', async ({ page }) => {
    await page.goto('./#/')
    const id = await seedTrip(page)
    await page.goto(`./#/trip/${id}`)

    await page.getByRole('button', { name: '更多選項' }).click()
    const sheet = page.getByRole('dialog', { name: '這篇回憶' })
    await expect(sheet).toBeVisible()
    const ring = () => page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
    expect(await ring()).toBe('none')

    await page.evaluate(async () => (await import('/src/ui/toast.ts' as string)).toast('測試訊息'))
    const toast = page.getByText('測試訊息')
    await expect(toast).toBeVisible()
    expect(await toast.evaluate((el) => el.closest('[popover]')!.matches(':popover-open'))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await page.getByRole('button', { name: '更多選項' }).focus()
    await page.keyboard.press('Enter')
    await expect(sheet).toBeVisible()
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
    expect(await ring()).toBe('solid')
  })
})
