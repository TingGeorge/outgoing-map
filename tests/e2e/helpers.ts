import type { Page } from '@playwright/test'

const key = process.env.THUNDERFOREST_API_KEY

function clean(text: string) {
  const noKey = key ? text.replaceAll(key, '<key>') : text
  return noKey.replace(/(https?:)?\/\/\S+|\S*thunderforest\S*/g, '<url>')
}

function where(url: string, origin: string) {
  const u = new URL(url)
  return u.origin === origin ? u.pathname : u.host
}

export function watch(page: Page, origin: string) {
  const problems: string[] = []

  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${clean(m.text())}`)
  })
  page.on('pageerror', (e) => problems.push(`uncaught at ${new URL(page.url()).hash}: ${clean(e.message)}`))
  page.on('requestfailed', (r) => {
    const reason = r.failure()?.errorText ?? ''
    const cancelled = /ERR_ABORTED|cancelled|Load request cancelled/i.test(reason)
    if (!cancelled && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`failed: ${where(r.url(), origin)} ${reason}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${where(r.url(), origin)}`)
  })

  return problems
}

export async function routePixels(page: Page, canvas = page.locator('section[aria-label="路線地圖"] canvas')) {
  const png = await canvas.screenshot()

  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)

    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    let count = 0

    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]! - 0xb8) < 24 && Math.abs(data[i + 1]! - 0x4a) < 24 && Math.abs(data[i + 2]! - 0x22) < 24) count++
    }

    return count
  }, png.toString('base64'))
}
