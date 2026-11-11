import { expect, test } from '@playwright/test'

test('without a key, the app opens the key tutorial', async ({ page }) => {
  await page.goto('./#/')
  await expect(page).toHaveURL(/#\/welcome$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('鑰匙')
})

test.describe('with a stored key', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('thunderforest-key', 'placeholder'))
  })

  test('home shows its heading and primary action', async ({ page }) => {
    await page.goto('./#/')
    await expect(page.getByRole('heading', { level: 1, name: /今天想回味\s*哪一座山/ })).toBeVisible()
    await expect(page.getByRole('link', { name: '新的回憶' })).toBeVisible()
    await expect(page.getByRole('link', { name: '設定' })).toBeVisible()
  })

  for (const [hash, heading] of [
    ['#/new', '新的回憶'],
    ['#/trip/sample', '日誌'],
    ['#/trip/sample/fly', '立體播放'],
    ['#/settings', '設定'],
  ]) {
    test(`${hash} renders its placeholder`, async ({ page }) => {
      await page.goto(`./${hash}`)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading!)
    })
  }
})
