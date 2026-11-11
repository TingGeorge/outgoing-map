import { crc32, deflateSync } from 'node:zlib'
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

export function solidPng(r: number, g: number, b: number, size = 256): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 2, 0, 0, 0], 8)

  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))

  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
}

export async function fakeImagery(page: Page) {
  const photo = solidPng(0x5a, 0x7a, 0x4a)
  const flat = solidPng(128, 0, 0)

  await page.route('https://wmts.nlsc.gov.tw/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: photo }))
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: flat }))
}
