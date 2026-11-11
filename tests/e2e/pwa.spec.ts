import { expect, test } from '@playwright/test'

test('manifest has the install fields and its icons resolve', async ({ page, request }) => {
  await page.goto('')

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const url = new URL(href!, page.url()).href
  const manifest = await (await request.get(url)).json()

  expect(manifest).toMatchObject({
    name: '登山回憶',
    lang: 'zh-Hant',
    display: 'standalone',
    start_url: './',
    scope: './',
    background_color: '#EEF1E2',
  })
  expect(manifest.icons.map((i: { purpose: string; sizes: string }) => `${i.sizes}:${i.purpose}`)).toEqual(
    expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']),
  )

  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, url).href)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  }

  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
})

test('service worker registers under the sub-path and the shell reloads offline', async ({ page, context }) => {
  await page.goto('')

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(scope).toBe(new URL('', page.url()).href)

  await page.reload()
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await context.setOffline(true)
  await page.reload()

  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page).toHaveTitle('登山回憶')

  await context.setOffline(false)
})
