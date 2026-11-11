import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { deleteDB, openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseGpx } from '../core'
import * as storage from './index'
import { IMPORT_LIMITS, PHOTO_FAILURE, TEXT_LIMITS, sniffImage } from './index'

vi.mock('./image', () => ({
  renderImage: vi.fn(async (file: Blob, _orientation: number, withFull: boolean) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('decode failed')

    return {
      width: 480,
      height: 360,
      full: withFull ? new Blob([bytes], { type: 'image/jpeg' }) : null,
      thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
    }
  }),
}))

const track = parseGpx(readFileSync('tests/fixtures/hehuan-north.gpx', 'utf8')).points
const noTimeTrack = parseGpx(readFileSync('tests/fixtures/no-time.gpx', 'utf8')).points

const PHOTOS = ['hehuan-0720-gps.jpg', 'hehuan-0850-gps.jpg', 'hehuan-0926-summit.jpg', 'hehuan-1015-nogps.jpg']

const jpeg = (name: string, as = name) => new File([readFileSync(`tests/fixtures/${name}`)], as, { type: 'image/jpeg' })

const local = (h: number, m: number, s: number) => Date.UTC(2026, 10, 7, h - 8, m, s)

async function readZip(blob: Blob) {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

beforeEach(async () => {
  for (const trip of await storage.listTrips()) await storage.deleteTrip(trip.id)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('trips', () => {
  test('create, get, update keep the record and maintain updatedAt', async () => {
    const trip = await storage.createTrip({ title: '合歡北峰' })

    expect(trip).toMatchObject({ title: '合歡北峰', diary: '', photoCount: 0, coverPhotoId: null, hasTrack: false, stats: null })
    expect(await storage.getTrip(trip.id)).toEqual(trip)

    await new Promise((r) => setTimeout(r, 5))
    const updated = await storage.updateTrip(trip.id, { diary: '風很大' })

    expect(updated).toMatchObject({ title: '合歡北峰', diary: '風很大' })
    expect(updated.updatedAt).toBeGreaterThan(trip.updatedAt)
    expect(await storage.getTrip(trip.id)).toEqual(updated)
  })

  test('unknown ids reject with a clear message', async () => {
    await expect(storage.updateTrip('nope', { title: 'x' })).rejects.toThrow('找不到這篇回憶')
    await expect(storage.updatePhoto('nope', { caption: 'x' })).rejects.toThrow('找不到這張照片')
    await expect(storage.saveTrack('nope', track)).rejects.toThrow('找不到這篇回憶')
    await expect(storage.addPhotos('nope', [])).rejects.toThrow('找不到這篇回憶')
    await expect(storage.exportTrip('nope')).rejects.toThrow('找不到這篇回憶')
    expect(await storage.getTrip('nope')).toBeUndefined()
    expect(await storage.getTrack('nope')).toBeNull()
  })

  test('a cover photo from another trip is refused', async () => {
    const a = await storage.createTrip({ title: 'a' })
    const b = await storage.createTrip({ title: 'b' })
    const { added } = await storage.addPhotos(a.id, [jpeg(PHOTOS[0]!)])

    await expect(storage.updateTrip(b.id, { coverPhotoId: added[0]!.id })).rejects.toThrow('封面照片不在這篇回憶裡')
  })

  test('listTrips puts the newest trip first, by trip date then createdAt', async () => {
    const old = await storage.createTrip({ title: 'old trip, created last' })
    await storage.saveTrack(old.id, track)

    await new Promise((r) => setTimeout(r, 5))
    const undated = await storage.createTrip({ title: 'no date' })

    const trips = await storage.listTrips()
    expect(trips.map((t) => t.title)).toEqual(['no date', 'old trip, created last'])
    expect(trips[1]!.id).toBe(old.id)
    expect(undated.startAt).toBeNull()
  })
})

describe('track', () => {
  test('saveTrack stores the points and derives dates and stats', async () => {
    const trip = await storage.createTrip({ title: 't' })
    const saved = await storage.saveTrack(trip.id, track)

    expect(saved.hasTrack).toBe(true)
    expect(saved.startAt).toBe(Date.UTC(2026, 10, 6, 22, 40))
    expect(saved.endAt).toBe(Date.UTC(2026, 10, 7, 3, 40))
    expect(saved.stats!.distanceM).toBeGreaterThan(1000)
    expect(saved.stats!.durationMs).toBe(5 * 3600_000)
    expect(await storage.getTrip(trip.id)).toEqual(saved)
    expect(await storage.getTrack(trip.id)).toEqual(track)
  })

  test('saveTrack with no points removes the track', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.saveTrack(trip.id, track)
    const cleared = await storage.saveTrack(trip.id, [])

    expect(cleared).toMatchObject({ hasTrack: false, stats: null, startAt: null, endAt: null })
    expect(await storage.getTrack(trip.id)).toBeNull()
  })
})

describe('photos', () => {
  test('addPhotos reads EXIF, places photos, sets a cover and reports progress', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.saveTrack(trip.id, track)

    const progress: [number, number][] = []
    const files = [...PHOTOS].reverse().map((n) => jpeg(n))
    const result = await storage.addPhotos(trip.id, files, (d, t) => progress.push([d, t]))

    expect(result.failed).toEqual([])
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]])

    const photos = await storage.listPhotos(trip.id)
    expect(photos.map((p) => p.fileName)).toEqual(PHOTOS)
    expect(result.added).toHaveLength(4)
    expect(result.added.every((p) => photos.some((q) => q.id === p.id && q.placement.source === p.placement.source))).toBe(true)

    const [first, second, , nogps] = photos
    expect(first!.takenAt).toBe(local(7, 20, 10))
    expect(nogps!.takenAt).toBe(local(10, 15, 20))
    expect(first!.gps).toMatchObject({ ele: 3074, heading: null })
    expect(first!.gps!.lat).toBeCloseTo(24 + 10 / 60 + 10.96 / 3600, 9)
    expect(first!.gps!.lon).toBeCloseTo(121 + 17 / 60 + 16.55 / 3600, 9)
    expect(second!.gps!.heading).toBe(300)
    expect(nogps!.gps).toBeNull()
    expect(photos.every((p) => p.placement.source === 'track')).toBe(true)
    expect('sourceKey' in first!).toBe(false)

    const saved = (await storage.getTrip(trip.id))!
    expect(saved.photoCount).toBe(4)
    expect(saved.coverPhotoId).toBe(photos.find((p) => p.fileName === PHOTOS[3])!.id)
    expect(saved.startAt).toBe(Date.UTC(2026, 10, 6, 22, 40))

    expect((await storage.getPhotoBlob(first!.id, 'full'))!.size).toBe(readFileSync(`tests/fixtures/${PHOTOS[0]}`).length)
    expect(await (await storage.getPhotoBlob(first!.id, 'thumb'))!.text()).toBe('thumb')
  })

  test('without a GPX the route comes from photo GPS, dates from photo times', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.addPhotos(trip.id, PHOTOS.map((n) => jpeg(n)))

    const saved = (await storage.getTrip(trip.id))!
    expect(saved.hasTrack).toBe(false)
    expect(saved.stats!.distanceM).toBeGreaterThan(0)
    expect(saved.startAt).toBe(local(7, 20, 10))
    expect(saved.endAt).toBe(local(9, 26, 0))

    const photos = await storage.listPhotos(trip.id)
    expect(photos.slice(0, 3).every((p) => p.placement.source === 'exif')).toBe(true)
    expect(photos[3]!.placement.source).toBe('none')
  })

  test('a GPX without times still gets dates from the photos', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.saveTrack(trip.id, noTimeTrack)
    const saved = await storage.addPhotos(trip.id, [jpeg(PHOTOS[1]!), jpeg(PHOTOS[3]!)]).then(() => storage.getTrip(trip.id))

    expect(saved).toMatchObject({ startAt: local(8, 50, 3), endAt: local(10, 15, 20), hasTrack: true })
  })

  test('the same photo twice is reported once as a duplicate, even under another name', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!)])

    const again = await storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!, 'IMG_0001.JPG'), jpeg(PHOTOS[1]!), jpeg(PHOTOS[1]!)])

    expect(again.added.map((p) => p.fileName)).toEqual([PHOTOS[1]])
    expect(again.failed).toEqual([
      { fileName: 'IMG_0001.JPG', reason: PHOTO_FAILURE.duplicate },
      { fileName: PHOTOS[1], reason: PHOTO_FAILURE.duplicate },
    ])
    expect((await storage.getTrip(trip.id))!.photoCount).toBe(2)

    const other = await storage.createTrip({ title: 'other trip' })
    expect((await storage.addPhotos(other.id, [jpeg(PHOTOS[0]!)])).added).toHaveLength(1)
  })

  test('undecodable files go into failed with a reason and the rest continue', async () => {
    const trip = await storage.createTrip({ title: 't' })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

    const result = await storage.addPhotos(trip.id, [
      new File(['not a jpeg'], 'broken.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0, 0, 0, 0x18]), 'ftypheic', new Uint8Array(12)], 'IMG_0002.HEIC', { type: 'image/heic' }),
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      new File([png], 'damaged.png', { type: 'image/png' }),
      jpeg(PHOTOS[2]!),
    ])

    expect(result.failed).toEqual([
      { fileName: 'broken.jpg', reason: PHOTO_FAILURE.notImage },
      { fileName: 'IMG_0002.HEIC', reason: PHOTO_FAILURE.heic },
      { fileName: 'notes.txt', reason: PHOTO_FAILURE.notImage },
      { fileName: 'damaged.png', reason: PHOTO_FAILURE.unreadable },
    ])
    expect(result.added.map((p) => p.fileName)).toEqual([PHOTOS[2]])
  })

  test('a photo is recognised by its leading bytes, not by its name or the decoder', async () => {
    const bytes = (...parts: (string | number[])[]) =>
      new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)))
    const box = (brand: string) => bytes([0, 0, 0, 0x18], 'ftyp', brand, [0, 0, 0, 0])

    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe1]))).toBe('jpeg')
    expect(sniffImage(bytes([0x89], 'PNG\r\n\x1a\n'))).toBe('png')
    expect(sniffImage(bytes('GIF89a'))).toBe('gif')
    expect(sniffImage(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('webp')
    expect(sniffImage(bytes('II*', [0]))).toBe('tiff')
    expect(sniffImage(bytes('MM', [0], '*'))).toBe('tiff')
    for (const brand of ['heic', 'heix', 'mif1', 'avif']) expect(sniffImage(box(brand)), brand).toBe('heif')

    for (const other of [box('isom'), box('mp42'), box('qt  '), bytes([0xff, 0xd8]), bytes('RIFF', [0, 0, 0, 0], 'WAVE'), bytes('%PDF-1.7'), bytes()]) {
      expect(sniffImage(other)).toBeNull()
    }

    const trip = await storage.createTrip({ title: 't' })
    const video = new File([box('isom'), new Uint8Array(64)], 'IMG_0003.jpg', { type: 'image/jpeg' })
    const result = await storage.addPhotos(trip.id, [video, new File([video], 'IMG_0003.mp4', { type: 'video/mp4' })])

    expect(result.failed.map((f) => f.reason)).toEqual([PHOTO_FAILURE.notImage, PHOTO_FAILURE.notImage])
  })

  test('updatePhoto changes the caption and returns the photo', async () => {
    const trip = await storage.createTrip({ title: 't' })
    const { added } = await storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!)])

    const updated = await storage.updatePhoto(added[0]!.id, { caption: '日出' })
    expect(updated).toEqual({ ...added[0], caption: '日出' })
    expect((await storage.listPhotos(trip.id))[0]).toEqual(updated)
  })

  test('deletePhoto removes blobs, recounts and moves the cover', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.addPhotos(trip.id, PHOTOS.slice(0, 2).map((n) => jpeg(n)))

    const [first, second] = await storage.listPhotos(trip.id)
    expect((await storage.getTrip(trip.id))!.coverPhotoId).toBe(first!.id)

    await storage.deletePhoto(first!.id)
    await storage.deletePhoto(first!.id)

    expect(await storage.getTrip(trip.id)).toMatchObject({ photoCount: 1, coverPhotoId: second!.id, startAt: local(8, 50, 3) })
    expect(await storage.getPhotoBlob(first!.id, 'full')).toBeUndefined()
    expect(await storage.getPhotoBlob(first!.id, 'thumb')).toBeUndefined()
    expect(await storage.getPhotoUrl(first!.id, 'full')).toBeUndefined()
  })

  test('getPhotoUrl returns an object URL for the stored image', async () => {
    const trip = await storage.createTrip({ title: 't' })
    const { added } = await storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!)])

    const url = await storage.getPhotoUrl(added[0]!.id, 'thumb')
    expect(url).toMatch(/^blob:/)
    URL.revokeObjectURL(url!)
  })
})

describe('transactions and failures', () => {
  test('deleteTrip removes trip, track, photos and blobs together', async () => {
    const trip = await storage.createTrip({ title: 't' })
    await storage.saveTrack(trip.id, track)
    const { added } = await storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!)])

    await storage.deleteTrip(trip.id)

    expect(await storage.getTrip(trip.id)).toBeUndefined()
    expect(await storage.getTrack(trip.id)).toBeNull()
    expect(await storage.listPhotos(trip.id)).toEqual([])
    expect(await storage.getPhotoBlob(added[0]!.id, 'full')).toBeUndefined()
  })

  test('a failure in the middle of deleteTrip leaves the trip whole', async () => {
    const trip = await storage.createTrip({ title: 't' })
    const { added } = await storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!)])

    const original = IDBObjectStore.prototype.delete
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'blobs') throw new DOMException('boom', 'UnknownError')
      return original.call(this, key)
    })

    await expect(storage.deleteTrip(trip.id)).rejects.toThrow('無法存取裝置上的資料')
    vi.restoreAllMocks()

    expect(await storage.getTrip(trip.id)).toBeDefined()
    expect(await storage.listPhotos(trip.id)).toHaveLength(1)
    expect(await storage.getPhotoBlob(added[0]!.id, 'full')).toBeDefined()
  })

  test('storage full surfaces as a Traditional Chinese error and saves nothing of the photo', async () => {
    const trip = await storage.createTrip({ title: 't' })

    const original = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'blobs') throw new DOMException('full', 'QuotaExceededError')
      return original.call(this, value, key)
    })

    await expect(storage.addPhotos(trip.id, [jpeg(PHOTOS[0]!)])).rejects.toThrow('裝置的儲存空間不足')
    await expect(storage.createTrip({ title: 'x' })).resolves.toBeDefined()
    vi.restoreAllMocks()

    expect(await storage.listPhotos(trip.id)).toEqual([])
    expect((await storage.getTrip(trip.id))!.photoCount).toBe(0)
  })
})

describe('export and import', () => {
  test('round trip yields an equal, independent trip with new ids', async () => {
    localStorage.setItem('thunderforest-key', 'SECRET-KEY-123')

    const trip = await storage.createTrip({ title: '合歡北峰', diary: '晴' })
    await storage.saveTrack(trip.id, track)
    await storage.addPhotos(trip.id, PHOTOS.map((n) => jpeg(n)))
    const photos = await storage.listPhotos(trip.id)
    await storage.updatePhoto(photos[1]!.id, { caption: '主峰' })
    await storage.updateTrip(trip.id, { coverPhotoId: photos[2]!.id })

    const source = (await storage.getTrip(trip.id))!
    const sourcePhotos = await storage.listPhotos(trip.id)
    const zip = await storage.exportTrip(trip.id)

    const entries = await readZip(zip)
    expect(Object.keys(entries).sort()).toEqual(['manifest.json', ...sourcePhotos.map((p) => `photos/${p.id}.jpg`)].sort())
    expect(new TextDecoder().decode(new Uint8Array(await zip.arrayBuffer()))).not.toContain('SECRET-KEY-123')

    const a = await storage.importTrip(zip)
    const b = await storage.importTrip(zip)

    expect(new Set([source.id, a.id, b.id]).size).toBe(3)

    const strip = ({ id: _i, createdAt: _c, updatedAt: _u, coverPhotoId: _p, ...rest }: typeof source) => rest
    expect(strip(a)).toEqual(strip(source))

    const imported = await storage.listPhotos(a.id)
    const stripPhoto = ({ id: _i, tripId: _t, ...rest }: (typeof imported)[number]) => rest
    expect(imported.map(stripPhoto)).toEqual(sourcePhotos.map(stripPhoto))
    expect(imported.every((p) => p.tripId === a.id && !sourcePhotos.some((s) => s.id === p.id))).toBe(true)
    expect(a.coverPhotoId).toBe(imported[2]!.id)
    expect(await storage.getTrack(a.id)).toEqual(track)
    expect(await storage.getPhotoBlob(imported[0]!.id, 'thumb')).toBeDefined()

    await storage.deleteTrip(a.id)
    expect(await storage.listPhotos(b.id)).toHaveLength(4)
    expect(await storage.listPhotos(trip.id)).toHaveLength(4)
  })

  test('invalid archives are refused with clear messages', async () => {
    const manifest = (m: object) => strToU8(JSON.stringify(m))
    const base = { format: 'hiking-memories-trip', version: 1, exportedAt: 0, track: null }
    const trip = { title: 't', diary: '' }
    const photo = { id: 'p', fileName: 'a.jpg', file: 'photos/p.jpg', takenAt: null, gps: null, caption: '' }

    await expect(storage.importTrip(new Blob(['hello']))).rejects.toThrow('這個檔案不是登山回憶的匯出檔')
    await expect(storage.importTrip(new Blob([zipSync({ 'a.txt': strToU8('x') })]))).rejects.toThrow('不是登山回憶的匯出檔')
    await expect(storage.importTrip(new Blob([zipSync({ 'manifest.json': strToU8('{') })]))).rejects.toThrow('不是登山回憶')
    await expect(
      storage.importTrip(new Blob([zipSync({ 'manifest.json': manifest({ ...base, version: 99, trip, photos: [] }) })])),
    ).rejects.toThrow('較新版本')
    await expect(
      storage.importTrip(new Blob([zipSync({ 'manifest.json': manifest({ ...base, trip, photos: [photo] }) })])),
    ).rejects.toThrow('匯出檔不完整，缺少照片 a.jpg')

    const notJpeg = zipSync({ 'manifest.json': manifest({ ...base, trip, photos: [photo] }), 'photos/p.jpg': strToU8('GIF89a') })
    await expect(storage.importTrip(new Blob([notJpeg]))).rejects.toThrow('匯出檔裡有照片無法讀取')

    expect(await storage.listTrips()).toEqual([])
  })

  test('a crafted manifest of any wrong shape is refused as not an export', async () => {
    const point = { lat: 24, lon: 121, ele: null, time: null }
    const photo = { id: 'p', fileName: 'a.jpg', file: 'photos/p.jpg', takenAt: null, gps: null, caption: '' }
    const good = { format: 'hiking-memories-trip', version: 1, exportedAt: 0, trip: { title: 't', diary: '', coverPhotoId: null }, track: [point], photos: [] }

    const crafted: unknown[] = [
      null,
      [],
      { ...good, version: '1' },
      { ...good, trip: null },
      { ...good, trip: { title: 7, diary: '' } },
      { ...good, trip: { title: 't' } },
      { ...good, trip: { ...good.trip, coverPhotoId: 5 } },
      { ...good, track: {} },
      { ...good, track: [null] },
      { ...good, track: [{ ...point, lat: 91 }] },
      { ...good, track: [{ ...point, lon: '121' }] },
      { ...good, track: [{ ...point, ele: 'high' }] },
      { ...good, track: [{ ...point, time: 'noon' }] },
      { ...good, photos: {} },
      { ...good, photos: [null] },
      { ...good, photos: ['photos/p.jpg'] },
      { ...good, photos: [{ ...photo, file: '../../etc/passwd' }] },
      { ...good, photos: [{ ...photo, file: '/photos/p.jpg' }] },
      { ...good, photos: [{ ...photo, file: 7 }] },
      { ...good, photos: [{ ...photo, fileName: null }] },
      { ...good, photos: [{ ...photo, caption: undefined }] },
      { ...good, photos: [{ ...photo, takenAt: '2026' }] },
      { ...good, photos: [{ ...photo, gps: { lat: 24 } }] },
      { ...good, photos: [{ ...photo, gps: { lat: 24, lon: 121, ele: null, heading: 'N' } }] },
      { ...good, photos: [{ ...photo, sourceKey: 3 }] },
      { ...good, photos: [photo, { ...photo, id: 'q' }] },
    ]

    for (const m of crafted) {
      const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(m)), 'photos/p.jpg': readFileSync(`tests/fixtures/${PHOTOS[0]}`) })
      await expect(storage.importTrip(new Blob([zip])), JSON.stringify(m)).rejects.toThrow('這個檔案不是登山回憶的匯出檔')
    }

    expect(await storage.listTrips()).toEqual([])
    await expect(storage.importTrip(new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(good)) })]))).resolves.toMatchObject({ title: 't' })
  })

  test('over-long text is trimmed and truncated at every entry point', async () => {
    const long = '山'.repeat(200_000)
    const title = `  ${'🏔️'.repeat(TEXT_LIMITS.title)}  `

    const created = await storage.createTrip({ title: long, diary: long })
    expect(created.title).toBe('山'.repeat(TEXT_LIMITS.title))
    expect(created.diary).toHaveLength(TEXT_LIMITS.diary)

    const renamed = await storage.updateTrip(created.id, { title: '  合歡北峰 ', diary: '  空白留著 ' })
    expect(renamed).toMatchObject({ title: '合歡北峰', diary: '  空白留著 ' })
    const emoji = (await storage.updateTrip(created.id, { title })).title
    expect(emoji.length).toBeLessThanOrEqual(TEXT_LIMITS.title)
    expect(emoji).toBe('🏔️'.repeat(26) + '🏔')

    const { added } = await storage.addPhotos(created.id, [jpeg(PHOTOS[0]!)])
    expect((await storage.updatePhoto(added[0]!.id, { caption: long })).caption).toHaveLength(TEXT_LIMITS.caption)

    const manifest = {
      format: 'hiking-memories-trip',
      version: 1,
      exportedAt: 0,
      trip: { title: long, diary: long, coverPhotoId: null },
      track: null,
      photos: [{ id: 'p', fileName: long, file: 'photos/p.jpg', takenAt: null, gps: null, caption: long }],
    }
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'photos/p.jpg': readFileSync(`tests/fixtures/${PHOTOS[0]}`) })
    const imported = await storage.importTrip(new Blob([zip]))
    const [p] = await storage.listPhotos(imported.id)

    expect(imported.title).toHaveLength(TEXT_LIMITS.title)
    expect(imported.diary).toHaveLength(TEXT_LIMITS.diary)
    expect(p!.caption).toHaveLength(TEXT_LIMITS.caption)
    expect(p!.fileName).toHaveLength(TEXT_LIMITS.fileName)
  })

  test('hostile archives are refused before they are inflated', async () => {
    const m = { format: 'hiking-memories-trip', version: 1, exportedAt: 0, trip: { title: 't', diary: '' }, track: null, photos: [] }
    const manifest = strToU8(JSON.stringify(m))

    const huge = { size: IMPORT_LIMITS.archiveBytes + 1 } as Blob
    await expect(storage.importTrip(huge)).rejects.toThrow('這個匯出檔太大')

    const many: Record<string, Uint8Array> = { 'manifest.json': manifest }
    for (let i = 0; i < IMPORT_LIMITS.entries; i++) many[`x/${i}`] = new Uint8Array(0)
    await expect(storage.importTrip(new Blob([zipSync(many)]))).rejects.toThrow('這個匯出檔太大')

    const bomb = zipSync({ 'manifest.json': manifest, 'photos/p.jpg': new Uint8Array(IMPORT_LIMITS.entryBytes + 1) }, { level: 9 })
    expect(bomb.length).toBeLessThan(1024 * 1024)
    await expect(storage.importTrip(new Blob([bomb]))).rejects.toThrow('這個匯出檔太大')

    const claim = (zip: Uint8Array<ArrayBuffer>, originalSize: number) => {
      const view = new DataView(zip.buffer)
      for (let o = 0; o < zip.length - 4; o++) {
        if (view.getUint32(o, true) !== 0x02014b50) continue
        const name = new TextDecoder().decode(zip.subarray(o + 46, o + 46 + view.getUint16(o + 28, true)))
        if (name.startsWith('photos/')) view.setUint32(o + 24, originalSize, true)
      }
      return new Blob([zip])
    }

    const lying = zipSync({ 'manifest.json': manifest, 'photos/p.jpg': new Uint8Array(10) }, { level: 9 })
    await expect(storage.importTrip(claim(lying, 0xfffffff0))).rejects.toThrow('這個匯出檔太大')

    const spread: Record<string, Uint8Array> = { 'manifest.json': manifest }
    for (let i = 0; i <= IMPORT_LIMITS.totalBytes / IMPORT_LIMITS.entryBytes; i++) spread[`photos/${i}.jpg`] = new Uint8Array(10)
    await expect(storage.importTrip(claim(zipSync(spread, { level: 9 }), IMPORT_LIMITS.entryBytes))).rejects.toThrow('這個匯出檔太大')

    const traversal = zipSync({ 'manifest.json': manifest, '../evil.jpg': new Uint8Array(1), '/abs.jpg': new Uint8Array(1), 'photos/../../x.jpg': new Uint8Array(1) })
    await expect(storage.importTrip(new Blob([traversal]))).resolves.toMatchObject({ title: 't', photoCount: 0 })
  })

  test('an entry that inflates past its declared size is stopped while inflating', async () => {
    const m = { format: 'hiking-memories-trip', version: 1, exportedAt: 0, trip: { title: 't', diary: '' }, track: null, photos: [] }
    const manifest = strToU8(JSON.stringify(m))

    const lie = (zip: Uint8Array<ArrayBuffer>, originalSize: number) => {
      const view = new DataView(zip.buffer)
      const name = (o: number, at: number, length: number) => new TextDecoder().decode(zip.subarray(o + at, o + at + view.getUint16(o + length, true)))

      for (let o = 0; o < zip.length - 4; o++) {
        const sig = view.getUint32(o, true)
        if (sig === 0x04034b50 && name(o, 30, 26).startsWith('photos/')) view.setUint32(o + 22, originalSize, true)
        if (sig === 0x02014b50 && name(o, 46, 28).startsWith('photos/')) view.setUint32(o + 24, originalSize, true)
      }
      return new Blob([zip])
    }

    const real = 32 * 1024 * 1024
    const lying = lie(zipSync({ 'manifest.json': manifest, 'photos/p.jpg': new Uint8Array(real) }, { level: 9 }), 1000)
    await expect(storage.importTrip(lying)).rejects.toThrow('這個匯出檔太大，無法匯入')

    const atLimit = zipSync({ 'manifest.json': manifest, 'photos/p.jpg': new Uint8Array(IMPORT_LIMITS.entryBytes) }, { level: 9 })
    await expect(storage.importTrip(new Blob([atLimit]))).resolves.toMatchObject({ title: 't' })
    await expect(storage.importTrip(lie(atLimit, IMPORT_LIMITS.entryBytes - 1))).rejects.toThrow('這個匯出檔太大，無法匯入')
  })
})

describe('two tabs', () => {
  test('a newer version in another tab is not blocked, and this tab is told to reload', async () => {
    await storage.listTrips()

    const newer = await openDB('hiking-memories', 2)
    newer.close()

    await expect(storage.listTrips()).rejects.toThrow('請重新整理這個頁面')

    await deleteDB('hiking-memories')
    expect(await storage.listTrips()).toEqual([])
  })
})
