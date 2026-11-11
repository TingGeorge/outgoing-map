import { expect, test, type Page } from '@playwright/test'

const FAKE_KEY = 'ffffffffffffffffffffffffffffffff'
const SIGN_UP = 'https://manage.thunderforest.com/**'

const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const field = (page: Page) => page.getByLabel('地圖鑰匙（API Key）')

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
}

test('walks through the steps and back', async ({ page }) => {
  await page.goto('./#/')
  await expect(page).toHaveURL(/#\/welcome$/)

  await expect(heading(page)).toContainText('小鑰匙')
  await expect(page.getByRole('img', { name: '第 1 步，共 4 步' })).toBeVisible()
  await noHorizontalScroll(page)
  await page.getByRole('button', { name: '開始領取' }).click()

  await expect(heading(page)).toContainText('先去領一把')
  const signUp = page.getByRole('link', { name: '開啟註冊頁' })
  await expect(signUp).toHaveAttribute('href', /^https:\/\/manage\.thunderforest\.com\/users\/sign_up/)
  await expect(signUp).toHaveAttribute('target', '_blank')
  await expect(page.getByText('不會傳給任何人')).toBeVisible()
  await noHorizontalScroll(page)

  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await expect(heading(page)).toContainText('把鑰匙貼上來')
  await expect(field(page)).toHaveAttribute('autocapitalize', 'none')
  await expect(field(page)).toHaveAttribute('spellcheck', 'false')
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()
  await noHorizontalScroll(page)

  await page.getByRole('button', { name: '上一步' }).click()
  await expect(heading(page)).toContainText('先去領一把')
  await page.getByRole('button', { name: '上一步' }).click()
  await expect(heading(page)).toContainText('小鑰匙')
})

test('the shortcut on step 1 jumps to the paste step', async ({ page }) => {
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await expect(heading(page)).toContainText('把鑰匙貼上來')
})

test('a wrong key is rejected with advice and cannot continue', async ({ page }) => {
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await field(page).fill(FAKE_KEY)

  await expect(page.getByRole('status')).toContainText('這把鑰匙不能用', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('thunderforest-key'))).toBeNull()
})

test('a malformed key is rejected without waiting on the network', async ({ page }) => {
  await page.route('https://tile.thunderforest.com/**', (route) => route.abort())
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await field(page).fill('not a key at all')

  await expect(page.getByRole('status')).toContainText('這把鑰匙不能用')
})

test('offline shows a retry instead of calling the key wrong', async ({ page }) => {
  await page.route('https://tile.thunderforest.com/**', (route) => route.abort())
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await field(page).fill(FAKE_KEY)

  await expect(page.getByRole('status')).toContainText('連不上', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: '再試一次' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一步' })).toBeDisabled()
})

test('after opening the sign-up page, a relaunch lands on the paste step', async ({ page, context }) => {
  await context.route(SIGN_UP, (route) => route.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }))
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '開始領取' }).click()

  const popup = page.waitForEvent('popup')
  await page.getByRole('link', { name: '開啟註冊頁' }).click()
  await (await popup).close()

  await page.reload()
  await expect(heading(page)).toContainText('把鑰匙貼上來')
})

test('reload on the paste step stays on the paste step', async ({ page }) => {
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await page.reload()
  await expect(heading(page)).toContainText('把鑰匙貼上來')
})

test('with a stored key, the tutorial sends you home', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'placeholder'))
  await page.goto('./#/welcome')
  await expect(page).toHaveURL(/#\/$/)
})

test('the real key is accepted and stored', async ({ page }) => {
  const key = process.env.THUNDERFOREST_API_KEY
  test.skip(!key, 'THUNDERFOREST_API_KEY is not set')

  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await field(page).fill(key!)

  await expect(page.getByRole('status')).toContainText('鑰匙可以用了', { timeout: 15_000 })
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(heading(page)).toContainText('都準備好了')

  await page.getByRole('button', { name: '進入 App' }).click()
  await expect(page).toHaveURL(/#\/$/)

  const stored = await page.evaluate(() => localStorage.getItem('thunderforest-key'))
  expect(stored === key).toBe(true)
})

const TILE = 'https://tile.thunderforest.com/**'
const okTile = (page: Page) =>
  page.route(TILE, (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: '' }))

const ring = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const style = getComputedStyle(el)
    return { focusVisible: el.matches(':focus-visible'), width: parseFloat(style.outlineWidth), kind: style.outlineStyle }
  })

async function toPasteStep(page: Page) {
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
  await field(page).fill('a'.repeat(32))
}

test('offline during the check, then back online: retry confirms the key', async ({ page }) => {
  await page.route(TILE, (route) => route.abort())
  await toPasteStep(page)
  await expect(page.getByRole('status')).toContainText('連不上', { timeout: 15_000 })

  await page.unroute(TILE)
  await okTile(page)
  await page.getByRole('button', { name: '再試一次' }).click()

  await expect(page.getByRole('status')).toContainText('鑰匙可以用了')
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled()
})

test('double-click and Enter repeats on 下一步 store the key once and move one step', async ({ page }) => {
  await okTile(page)
  await toPasteStep(page)
  await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled({ timeout: 10_000 })

  const writes = await page.evaluate(() => {
    let n = 0
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'thunderforest-key') n++
      return set.call(this, k, v)
    }
    ;(window as unknown as { __writes: () => number }).__writes = () => n
    return 0
  })
  expect(writes).toBe(0)

  await page.getByRole('button', { name: '下一步' }).dblclick()
  await expect(heading(page)).toContainText('都準備好了')
  expect(await page.evaluate(() => (window as unknown as { __writes: () => number }).__writes())).toBe(1)
  await expect(page).toHaveURL(/#\/welcome$/)
})

test('keyboard only: visible focus, sensible order, Enter advances, Back is reachable', async ({ page, browserName }) => {
  const tab = (back = false) =>
    page.keyboard.press(`${browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`)

  await page.goto('./#/welcome')
  await expect(heading(page)).toBeVisible()

  await tab()
  await expect(page.getByRole('button', { name: '開始領取' })).toBeFocused()
  expect(await ring(page)).toMatchObject({ focusVisible: true, kind: 'solid' })
  expect((await ring(page)).width).toBeGreaterThanOrEqual(2)

  await tab()
  await expect(page.getByRole('button', { name: '我已經有鑰匙了' })).toBeFocused()

  await tab(true)
  await page.keyboard.press('Enter')
  await expect(heading(page)).toBeFocused()

  await tab()
  await expect(page.getByRole('link', { name: '開啟註冊頁' })).toBeFocused()
  expect((await ring(page)).width).toBeGreaterThanOrEqual(2)

  await tab()
  await expect(page.getByRole('button', { name: '我已經有鑰匙了' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(heading(page)).toContainText('把鑰匙貼上來')

  await tab(true)
  await expect(page.getByRole('button', { name: '上一步' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(heading(page)).toContainText('先去領一把')

  await tab(true)
  await expect(page.getByRole('button', { name: '上一步' })).toBeFocused()
})

for (const zoom of [150, 200]) {
  test(`${zoom}% text: every step stays inside the screen`, async ({ page }) => {
    await okTile(page)
    await page.goto('./#/welcome')
    await page.addStyleTag({ content: `html{font-size:${zoom}%}` })

    const check = async () => {
      await noHorizontalScroll(page)
      const bar = (await page.locator('main + div').count()) ? await page.locator('main + div').boundingBox() : null
      if (bar) expect(bar.height).toBeLessThan((page.viewportSize()?.height ?? 844) * 0.4)
      for (const b of await page.getByRole('button').all()) {
        const box = await b.boundingBox()
        if (box) expect(box.x + box.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 1)
      }
    }

    await check()
    await page.getByRole('button', { name: '開始領取' }).click()
    await check()
    await page.getByRole('button', { name: '我已經有鑰匙了' }).click()
    await field(page).fill('a'.repeat(32))
    await expect(page.getByRole('button', { name: '下一步' })).toBeEnabled({ timeout: 10_000 })
    await check()
    await page.getByRole('button', { name: '下一步' }).click()
    await check()
  })
}

test('at 320 wide the step label and the paste step fit on one line', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./#/welcome')
  await page.getByRole('button', { name: '開始領取' }).click()

  const label = page.getByText('第 2 步，共 4 步')
  const box = await label.boundingBox()
  expect(box!.height).toBeLessThan(24)
  await noHorizontalScroll(page)
})

test('short landscape screens: the action bar sits in the flow and covers nothing', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('./#/welcome')

  const position = await page.locator('main + div').evaluate((el) => getComputedStyle(el).position)
  expect(position).toBe('static')
  await noHorizontalScroll(page)
})
