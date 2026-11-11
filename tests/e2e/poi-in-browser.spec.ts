import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('poisAlongRoute fetches poi.json in the browser and finds the Hehuan North summit', async ({ page }) => {
  await page.goto('./')

  const xml = readFileSync('tests/fixtures/hehuan-north.gpx', 'utf8')

  const hits = await page.evaluate(
    async ({ xml, poiPath, corePath }) => {
      const core = await import(corePath)
      const poi = await import(poiPath)
      const route = core.buildRoute(core.parseGpx(xml).points, [])
      const found = await poi.poisAlongRoute(route)

      return found.map((h: { poi: { name: string; ele: number | null } }) => ({ name: h.poi.name, ele: h.poi.ele }))
    },
    { xml, poiPath: '/src/poi/index.ts', corePath: '/src/core/index.ts' },
  )

  expect(hits).toContainEqual({ name: '合歡北峰', ele: 3422 })
})
