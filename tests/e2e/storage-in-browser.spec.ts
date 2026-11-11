import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const STORAGE = '/src/storage/index.ts'
const CORE = '/src/core/index.ts'

async function open(page: Page) {
  await page.goto('./')
  await page.evaluate((path) => import(path), STORAGE).catch(() => {})
  await page.waitForLoadState('networkidle')
}

test('photo pipeline, duplicates, failures, export and import in a real browser', async ({ page }) => {
  await open(page)

  const r = await page.evaluate(
    async ({ STORAGE, CORE }) => {
      const storage = await import(STORAGE)
      const core = await import(CORE)

      const fixture = async (name: string, as = name) => {
        const blob = await (await fetch(`/tests/fixtures/${name}`)).blob()
        return new File([blob], as, { type: 'image/jpeg' })
      }

      const decode = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height

        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)

        const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
        return { width: bitmap.width, height: bitmap.height, top: pixel(bitmap.width / 2, 2), bottom: pixel(bitmap.width / 2, bitmap.height - 3) }
      }

      const big = await new Promise<File>((resolve) => {
        const canvas = document.createElement('canvas')
        canvas.width = 4032
        canvas.height = 3024

        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#3a6'
        ctx.fillRect(0, 0, 4032, 3024)
        ctx.fillStyle = '#fff'
        ctx.fillRect(1000, 1000, 2000, 1000)

        canvas.toBlob((b) => resolve(new File([b!], 'IMG_4032.JPG', { type: 'image/jpeg' })), 'image/jpeg', 0.95)
      })

      const names = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg']
      const gpx = await (await fetch('/tests/fixtures/hehuan-north.gpx')).text()

      const trip = await storage.createTrip({ title: '合歡北峰' })
      await storage.saveTrack(trip.id, core.parseGpx(gpx).points)

      const jpegBytes = new Uint8Array(await (await fixture(names[0]!)).arrayBuffer())
      const corrupt = new File([jpegBytes.slice(0, 600)], 'corrupt.jpg', { type: 'image/jpeg' })

      const progress: number[] = []
      const files = [...(await Promise.all(names.map((n) => fixture(n)))), corrupt, big, await fixture('orientation-6.jpg')]
      const first = await storage.addPhotos(trip.id, files, (done: number) => progress.push(done))

      const again = await storage.addPhotos(trip.id, [await fixture(names[0]!, 'IMG_0001.JPG')])

      const photos = await storage.listPhotos(trip.id)
      const byName = (n: string) => photos.find((p: { fileName: string }) => p.fileName === n)

      const sizes: Record<string, { full: number; thumb: number; fullDim: number[]; thumbDim: number[] }> = {}
      for (const p of photos) {
        const full = await storage.getPhotoBlob(p.id, 'full')
        const thumb = await storage.getPhotoBlob(p.id, 'thumb')
        const [f, t] = [await decode(full), await decode(thumb)]
        sizes[p.fileName] = { full: full.size, thumb: thumb.size, fullDim: [f.width, f.height], thumbDim: [t.width, t.height] }
      }

      const rotated = await decode(await storage.getPhotoBlob(byName('orientation-6.jpg').id, 'full'))

      const url = await storage.getPhotoUrl(byName(names[0]!).id, 'thumb')
      const img = new Image()
      img.src = url
      await img.decode()
      URL.revokeObjectURL(url)

      const source = await storage.getTrip(trip.id)
      const zip = await storage.exportTrip(trip.id)
      const imported = await storage.importTrip(zip)
      const importedPhotos = await storage.listPhotos(imported.id)
      const importedThumb = await decode(await storage.getPhotoBlob(importedPhotos[0].id, 'thumb'))

      return {
        trip: source,
        photos,
        progress,
        first: { added: first.added.length, failed: first.failed },
        again,
        sizes,
        rotated,
        imgLoaded: img.naturalWidth > 0,
        zip: { type: zip.type, size: zip.size },
        imported,
        importedPhotos,
        importedThumb,
        tripCount: (await storage.listTrips()).length,
      }
    },
    { STORAGE, CORE },
  )

  const local = (h: number, m: number, s: number) => Date.UTC(2026, 10, 7, h - 8, m, s)
  const photo = (n: string) => r.photos.find((p: { fileName: string }) => p.fileName === n)

  expect(r.progress).toEqual([1, 2, 3, 4, 5, 6, 7])
  expect(r.first.added).toBe(6)
  expect(r.first.failed).toEqual([{ fileName: 'corrupt.jpg', reason: '照片無法讀取，檔案可能已損毀' }])
  expect(r.again).toEqual({ added: [], failed: [{ fileName: 'IMG_0001.JPG', reason: '這張照片已經加入過了' }] })

  expect(photo('hehuan-0720-gps.jpg').takenAt).toBe(local(7, 20, 10))
  expect(photo('hehuan-1015-nogps.jpg').takenAt).toBe(local(10, 15, 20))
  expect(photo('hehuan-0850-gps.jpg').gps).toEqual({ lat: expect.closeTo(24.180711, 5), lon: expect.closeTo(121.283419, 5), ele: 3390, heading: 300 })
  expect(photo('hehuan-1015-nogps.jpg').gps).toBeNull()
  expect(photo('hehuan-1015-nogps.jpg').placement).toMatchObject({ source: 'track', routeDistanceM: expect.any(Number) })
  expect(photo('IMG_4032.JPG').placement).toEqual({ source: 'none' })

  expect(photo('hehuan-0720-gps.jpg')).toMatchObject({ width: 480, height: 360 })
  expect(photo('IMG_4032.JPG')).toMatchObject({ width: 2048, height: 1536 })
  expect(r.sizes['IMG_4032.JPG']).toMatchObject({ fullDim: [2048, 1536], thumbDim: [480, 360] })
  expect(r.sizes['hehuan-0720-gps.jpg']).toMatchObject({ fullDim: [480, 360], thumbDim: [480, 360] })

  for (const s of Object.values(r.sizes)) {
    expect(s.full).toBeLessThan(1_500_000)
    expect(s.thumb).toBeGreaterThan(0)
    expect(s.thumb).toBeLessThan(150_000)
    expect(Math.max(...s.fullDim)).toBeLessThanOrEqual(2048)
    expect(Math.max(...s.thumbDim)).toBeLessThanOrEqual(480)
  }

  expect(photo('orientation-6.jpg')).toMatchObject({ width: 32, height: 64 })
  expect(r.rotated).toMatchObject({ width: 32, height: 64 })
  expect(r.rotated.top[0]).toBeGreaterThan(200)
  expect(r.rotated.top[2]).toBeLessThan(60)
  expect(r.rotated.bottom[2]).toBeGreaterThan(200)
  expect(r.rotated.bottom[0]).toBeLessThan(60)

  expect(r.imgLoaded).toBe(true)
  expect(r.trip).toMatchObject({ photoCount: 6, hasTrack: true, startAt: Date.UTC(2026, 10, 6, 22, 40) })
  expect(r.trip.coverPhotoId).toBe(photo('hehuan-0720-gps.jpg').id)

  expect(r.zip.type).toBe('application/zip')
  expect(r.imported.id).not.toBe(r.trip.id)
  expect(r.imported).toMatchObject({ title: r.trip.title, photoCount: 6, stats: r.trip.stats, startAt: r.trip.startAt, endAt: r.trip.endAt })

  const strip = ({ id: _i, tripId: _t, ...rest }: Record<string, unknown>) => rest
  expect(r.importedPhotos.map(strip)).toEqual(r.photos.map(strip))
  expect(r.importedPhotos.some((p: { id: string }) => r.photos.some((q: { id: string }) => q.id === p.id))).toBe(false)
  expect(Math.max(r.importedThumb.width, r.importedThumb.height)).toBeLessThanOrEqual(480)
  expect(r.tripCount).toBe(2)
})

test('trips and photos survive a page reload', async ({ page }) => {
  await open(page)

  const tripId = await page.evaluate(async (STORAGE) => {
    const storage = await import(STORAGE)
    const blob = await (await fetch('/tests/fixtures/hehuan-0926-summit.jpg')).blob()

    const trip = await storage.createTrip({ title: '重新載入' })
    await storage.addPhotos(trip.id, [new File([blob], 'summit.jpg', { type: 'image/jpeg' })])
    return trip.id
  }, STORAGE)

  await page.reload()

  const after = await page.evaluate(
    async ({ STORAGE, tripId }) => {
      const storage = await import(STORAGE)
      const trip = await storage.getTrip(tripId)
      const [photo] = await storage.listPhotos(tripId)
      const full = await storage.getPhotoBlob(photo.id, 'full')
      const bitmap = await createImageBitmap(full)

      return { trip, photo, fullType: full.type, width: bitmap.width }
    },
    { STORAGE, tripId },
  )

  expect(after.trip).toMatchObject({ title: '重新載入', photoCount: 1, coverPhotoId: after.photo.id })
  expect(after.photo.takenAt).toBe(Date.UTC(2026, 10, 7, 1, 26, 0))
  expect(after.fullType).toBe('image/jpeg')
  expect(after.width).toBe(480)
})

test('orientation is applied by hand when the browser does not rotate', async ({ page }) => {
  await open(page)

  const r = await page.evaluate(async (STORAGE) => {
    const native = window.createImageBitmap.bind(window)

    window.createImageBitmap = (async (source: Blob) => {
      const bytes = new Uint8Array(await source.arrayBuffer())
      const tag = [0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00]
      const at = bytes.findIndex((_, i) => tag.every((b, j) => bytes[i + j] === b))
      if (at >= 0) bytes[at + 9] = 1
      return native(new Blob([bytes], { type: source.type }))
    }) as typeof createImageBitmap

    const storage = await import(STORAGE)
    const blob = await (await fetch('/tests/fixtures/orientation-6.jpg')).blob()
    const trip = await storage.createTrip({ title: 'o' })
    const { added } = await storage.addPhotos(trip.id, [new File([blob], 'o.jpg', { type: 'image/jpeg' })])

    const bitmap = await native(await storage.getPhotoBlob(added[0].id, 'full'))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height

    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const pixel = (y: number) => Array.from(ctx.getImageData(16, y, 1, 1).data.slice(0, 3))

    return { width: added[0].width, height: added[0].height, top: pixel(2), bottom: pixel(61) }
  }, STORAGE)

  expect(r).toMatchObject({ width: 32, height: 64 })
  expect(r.top[0]).toBeGreaterThan(200)
  expect(r.bottom[2]).toBeGreaterThan(200)
})
