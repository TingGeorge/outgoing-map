import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('parseGpx works with the browser DOMParser', async ({ page }) => {
  await page.goto('./')

  const xml = readFileSync('tests/fixtures/hehuan-north.gpx', 'utf8')

  const parsed = await page.evaluate(
    async ({ xml, path }) => {
      const core = await import(path)
      const { name, points } = core.parseGpx('\uFEFF' + xml)
      const errors = ['not xml <<', xml.slice(0, 2000)].map((bad) => {
        try {
          core.parseGpx(bad)
          return 'parsed'
        } catch (e) {
          return (e as Error).message
        }
      })

      return { name, count: points.length, first: points[0], last: points.at(-1), errors }
    },
    { xml, path: '/src/core/index.ts' },
  )

  expect(parsed.name).toBe('合歡北峰')
  expect(parsed.count).toBe(101)
  expect(parsed.first).toEqual({ lat: 24.1674, lon: 121.28879, ele: 2995, time: Date.UTC(2026, 10, 6, 22, 40) })
  expect(parsed.last).toEqual({ lat: 24.1674, lon: 121.288891, ele: 2994, time: Date.UTC(2026, 10, 7, 3, 40) })
  expect(parsed.errors).toEqual(['這個檔案不是有效的 GPX', '這個檔案不是有效的 GPX'])
})
