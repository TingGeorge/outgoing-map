import { expect, test, type Page } from '@playwright/test'

const FAKE_KEY = 'ffffffffffffffffffffffffffffffff'
const SIGN_UP = 'https://manage.thunderforest.com/**'

const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const field = (page: Page) => page.getByLabel('地圖金鑰（API Key）')

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
