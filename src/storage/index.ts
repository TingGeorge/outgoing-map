import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb'
import { buildRoute, exifTimeToEpoch, placePhotos, routeStats } from '../core'
import type {
  AddPhotosResult,
  EpochMs,
  Id,
  Photo,
  PhotoGps,
  PhotoImportFailure,
  PhotoPatch,
  PhotoSize,
  TrackPoint,
  Trip,
  TripPatch,
} from '../types'
import { renderImage } from './image'

const DB_NAME = 'hiking-memories'
const DB_VERSION = 1

const EXPORT_FORMAT = 'hiking-memories-trip'
const EXPORT_VERSION = 1

const MSG = {
  noTrip: '找不到這篇回憶',
  noPhoto: '找不到這張照片',
  coverNotInTrip: '封面照片不在這篇回憶裡',
  full: '裝置的儲存空間不足，請刪除一些照片或回憶後再試',
  otherTab: '登山回憶已在另一個分頁更新，請重新整理這個頁面',
  db: '無法存取裝置上的資料，請重新整理頁面後再試',
  notArchive: '這個檔案不是登山回憶的匯出檔',
  newer: '這個匯出檔來自較新版本的登山回憶，請先更新 App',
  incomplete: '匯出檔不完整，缺少照片',
  badPhoto: '匯出檔裡有照片無法讀取',
  code: 'App 的一部分沒有下載成功，請連上網路後重新載入',
}

function lazyLib<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((e: unknown) => {
      throw new Error(MSG.code, { cause: e })
    })
}

const loadExifr = lazyLib(() => import('exifr').then((m) => m.default))
const loadZip = lazyLib(() => import('fflate'))

export const PHOTO_FAILURE = {
  duplicate: '這張照片已經加入過了',
  heic: '這個瀏覽器無法開啟 HEIC 照片，請改用 JPEG',
  notImage: '這不是照片檔',
  unreadable: '照片無法讀取，檔案可能已損毀',
}

interface PhotoRecord extends Photo {
  sourceKey: string
}

interface BlobRecord {
  photoId: Id
  size: PhotoSize
  type: string
  bytes: ArrayBuffer
}

interface Schema extends DBSchema {
  trips: { key: Id; value: Trip }
  tracks: { key: Id; value: { tripId: Id; points: TrackPoint[] } }
  photos: { key: Id; value: PhotoRecord; indexes: { tripId: Id; source: [Id, string] } }
  blobs: { key: [Id, PhotoSize]; value: BlobRecord }
}

type Store = StoreNames<Schema>
type Tx = IDBPTransaction<Schema, Store[], 'readwrite' | 'readonly'>
type WriteTx = IDBPTransaction<Schema, Store[], 'readwrite'>

const ALL: Store[] = ['trips', 'tracks', 'photos', 'blobs']

let connection: Promise<IDBPDatabase<Schema>> | null = null

function db(): Promise<IDBPDatabase<Schema>> {
  connection ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('trips', { keyPath: 'id' })
        db.createObjectStore('tracks', { keyPath: 'tripId' })

        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('tripId', 'tripId')
        photos.createIndex('source', ['tripId', 'sourceKey'])

        db.createObjectStore('blobs', { keyPath: ['photoId', 'size'] })
      }
    },

    blocking(_current, _next, event) {
      ;(event.target as IDBDatabase).close()
      connection = null
    },

    terminated() {
      connection = null
    },
  }).catch((e) => {
    connection = null
    throw e
  })

  return connection
}

function toError(e: unknown): Error {
  const name = (e as { name?: unknown } | null)?.name

  if (name === 'QuotaExceededError') return new Error(MSG.full, { cause: e })
  if (name === 'VersionError') return new Error(MSG.otherTab, { cause: e })
  if (e instanceof Error && e.constructor === Error) return e

  return new Error(MSG.db, { cause: e })
}

async function run<T>(mode: 'readonly', stores: Store[], fn: (tx: Tx) => Promise<T>): Promise<T>
async function run<T>(mode: 'readwrite', stores: Store[], fn: (tx: WriteTx) => Promise<T>): Promise<T>
async function run<T>(mode: IDBTransactionMode, stores: Store[], fn: (tx: WriteTx) => Promise<T>): Promise<T> {
  let tx: WriteTx | undefined

  try {
    tx = (await db()).transaction(stores, mode as 'readwrite')
    tx.done.catch(() => {})

    const result = await fn(tx)
    await tx.done
    return result
  } catch (e) {
    const cause = tx?.error ?? e

    try {
      tx?.abort()
    } catch {}

    throw toError(cause)
  }
}

function publicPhoto({ sourceKey: _, ...photo }: PhotoRecord): Photo {
  return photo
}

function byTime(a: Photo, b: Photo): number {
  if (a.takenAt !== b.takenAt) {
    if (a.takenAt === null) return 1
    if (b.takenAt === null) return -1
    return a.takenAt - b.takenAt
  }

  return a.fileName.localeCompare(b.fileName) || a.id.localeCompare(b.id)
}

async function refresh(tx: WriteTx, tripId: Id): Promise<Trip> {
  const trip = await tx.objectStore('trips').get(tripId)
  if (!trip) throw new Error(MSG.noTrip)

  const track = (await tx.objectStore('tracks').get(tripId))?.points ?? null
  const photos = (await tx.objectStore('photos').index('tripId').getAll(tripId)).sort(byTime)

  const route = buildRoute(track, photos)
  const placements = placePhotos(photos, route)

  for (const [i, p] of photos.entries()) await tx.objectStore('photos').put({ ...p, placement: placements[i]! })

  const times = photos.flatMap((p) => (p.takenAt === null ? [] : [p.takenAt]))
  const keepCover = photos.some((p) => p.id === trip.coverPhotoId)

  const next: Trip = {
    ...trip,
    hasTrack: track !== null,
    stats: route.points.length > 0 ? routeStats(route) : null,
    startAt: route.startAt ?? (times.length ? Math.min(...times) : null),
    endAt: route.endAt ?? (times.length ? Math.max(...times) : null),
    photoCount: photos.length,
    coverPhotoId: keepCover ? trip.coverPhotoId : (photos[0]?.id ?? null),
    updatedAt: Date.now(),
  }

  await tx.objectStore('trips').put(next)
  return next
}

export async function listTrips(): Promise<Trip[]> {
  const trips = await run('readonly', ['trips'], (tx) => tx.objectStore('trips').getAll())
  const date = (t: Trip) => t.startAt ?? t.createdAt

  return trips.sort((a, b) => date(b) - date(a) || b.createdAt - a.createdAt)
}

export function getTrip(id: Id): Promise<Trip | undefined> {
  return run('readonly', ['trips'], (tx) => tx.objectStore('trips').get(id))
}

export async function createTrip(input: { title: string; diary?: string }): Promise<Trip> {
  const now = Date.now()

  const trip: Trip = {
    id: crypto.randomUUID(),
    title: input.title,
    startAt: null,
    endAt: null,
    diary: input.diary ?? '',
    hasTrack: false,
    stats: null,
    coverPhotoId: null,
    photoCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  await run('readwrite', ['trips'], (tx) => tx.objectStore('trips').add(trip))
  return trip
}

export function updateTrip(id: Id, patch: TripPatch): Promise<Trip> {
  return run('readwrite', ['trips', 'photos'], async (tx) => {
    const trip = await tx.objectStore('trips').get(id)
    if (!trip) throw new Error(MSG.noTrip)

    if (patch.coverPhotoId) {
      const cover = await tx.objectStore('photos').get(patch.coverPhotoId)
      if (cover?.tripId !== id) throw new Error(MSG.coverNotInTrip)
    }

    const next: Trip = {
      ...trip,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.diary !== undefined && { diary: patch.diary }),
      ...(patch.coverPhotoId !== undefined && { coverPhotoId: patch.coverPhotoId }),
      updatedAt: Date.now(),
    }

    await tx.objectStore('trips').put(next)
    return next
  })
}

export function deleteTrip(id: Id): Promise<void> {
  return run('readwrite', ALL, async (tx) => {
    const photoIds = await tx.objectStore('photos').index('tripId').getAllKeys(id)

    await tx.objectStore('trips').delete(id)
    await tx.objectStore('tracks').delete(id)
    for (const photoId of photoIds) await deletePhotoRecords(tx, photoId)
  })
}

async function deletePhotoRecords(tx: WriteTx, photoId: Id) {
  await tx.objectStore('photos').delete(photoId)
  await tx.objectStore('blobs').delete([photoId, 'full'])
  await tx.objectStore('blobs').delete([photoId, 'thumb'])
}

export function saveTrack(tripId: Id, points: TrackPoint[]): Promise<Trip> {
  return run('readwrite', ['trips', 'tracks', 'photos'], async (tx) => {
    if (points.length > 0) await tx.objectStore('tracks').put({ tripId, points })
    else await tx.objectStore('tracks').delete(tripId)

    return refresh(tx, tripId)
  })
}

export async function getTrack(tripId: Id): Promise<TrackPoint[] | null> {
  const track = await run('readonly', ['tracks'], (tx) => tx.objectStore('tracks').get(tripId))
  return track?.points ?? null
}

interface ExifInfo {
  takenAt: EpochMs | null
  gps: PhotoGps | null
  orientation: number
}

type RawExif = Partial<Record<string, unknown>>

async function readExif(exifr: Awaited<ReturnType<typeof loadExifr>>, bytes: ArrayBuffer): Promise<ExifInfo> {
  const tags: RawExif = await exifr
    .parse(bytes, { reviveValues: false, translateValues: false, tiff: true, exif: true, gps: true })
    .catch(() => undefined) ?? {}

  const text = (v: unknown) => (typeof v === 'string' ? v : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const dateTime = text(tags.DateTimeOriginal)
  const takenAt = dateTime ? exifTimeToEpoch(dateTime, text(tags.OffsetTimeOriginal)) : null

  const lat = num(tags.latitude)
  const lon = num(tags.longitude)
  const validFix = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)

  const altitude = num(tags.GPSAltitude)
  const ref = tags.GPSAltitudeRef
  const belowSea = (ArrayBuffer.isView(ref) ? (ref as Uint8Array)[0] : ref) === 1

  const gps: PhotoGps | null = validFix
    ? { lat, lon, ele: altitude === null ? null : belowSea ? -altitude : altitude, heading: num(tags.GPSImgDirection) }
    : null

  return { takenAt, gps, orientation: num(tags.Orientation) ?? 1 }
}

async function sourceKeyOf(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

function failureReason(file: File): string {
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return PHOTO_FAILURE.heic
  if (file.type && !file.type.startsWith('image/')) return PHOTO_FAILURE.notImage
  return PHOTO_FAILURE.unreadable
}

async function toRecord(blob: Blob): Promise<Omit<BlobRecord, 'photoId' | 'size'>> {
  return { type: blob.type || 'image/jpeg', bytes: await blob.arrayBuffer() }
}

function isDuplicate(tx: Tx, tripId: Id, sourceKey: string): Promise<boolean> {
  return tx.objectStore('photos').index('source').count([tripId, sourceKey]).then((n) => n > 0)
}

export async function addPhotos(
  tripId: Id,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<AddPhotosResult> {
  if (!(await getTrip(tripId))) throw new Error(MSG.noTrip)

  const exifr = await loadExifr()
  const addedIds: Id[] = []
  const failed: PhotoImportFailure[] = []

  for (const [i, file] of files.entries()) {
    const fail = (reason: string) => failed.push({ fileName: file.name, reason })

    const bytes = await file.arrayBuffer().catch(() => null)
    const sourceKey = bytes && (await sourceKeyOf(bytes))

    if (!bytes || !sourceKey) {
      fail(PHOTO_FAILURE.unreadable)
    } else if (await run('readonly', ['photos'], (tx) => isDuplicate(tx, tripId, sourceKey))) {
      fail(PHOTO_FAILURE.duplicate)
    } else {
      const exif = await readExif(exifr, bytes)
      const rendered = await renderImage(file, exif.orientation, true).catch(() => null)

      if (!rendered) {
        fail(failureReason(file))
      } else {
        const id = crypto.randomUUID()
        const full = await toRecord(rendered.full!)
        const thumb = await toRecord(rendered.thumb)

        const added = await run('readwrite', ['trips', 'tracks', 'photos', 'blobs'], async (tx) => {
          if (await isDuplicate(tx, tripId, sourceKey)) return false

          await tx.objectStore('photos').add({
            id,
            tripId,
            fileName: file.name,
            takenAt: exif.takenAt,
            gps: exif.gps,
            caption: '',
            width: rendered.width,
            height: rendered.height,
            placement: { source: 'none' },
            sourceKey,
          })

          await tx.objectStore('blobs').add({ photoId: id, size: 'full', ...full })
          await tx.objectStore('blobs').add({ photoId: id, size: 'thumb', ...thumb })

          await refresh(tx, tripId)
          return true
        })

        if (added) addedIds.push(id)
        else fail(PHOTO_FAILURE.duplicate)
      }
    }

    onProgress?.(i + 1, files.length)
  }

  const photos = await listPhotos(tripId)
  return { added: photos.filter((p) => addedIds.includes(p.id)), failed }
}

export async function listPhotos(tripId: Id): Promise<Photo[]> {
  const photos = await run('readonly', ['photos'], (tx) => tx.objectStore('photos').index('tripId').getAll(tripId))
  return photos.sort(byTime).map(publicPhoto)
}

export function updatePhoto(id: Id, patch: PhotoPatch): Promise<Photo> {
  return run('readwrite', ['photos'], async (tx) => {
    const photo = await tx.objectStore('photos').get(id)
    if (!photo) throw new Error(MSG.noPhoto)

    const next = { ...photo, ...(patch.caption !== undefined && { caption: patch.caption }) }
    await tx.objectStore('photos').put(next)
    return publicPhoto(next)
  })
}

export function deletePhoto(id: Id): Promise<void> {
  return run('readwrite', ALL, async (tx) => {
    const photo = await tx.objectStore('photos').get(id)
    if (!photo) return

    await deletePhotoRecords(tx, id)
    await refresh(tx, photo.tripId)
  })
}

export async function getPhotoBlob(id: Id, size: PhotoSize): Promise<Blob | undefined> {
  const record = await run('readonly', ['blobs'], (tx) => tx.objectStore('blobs').get([id, size]))
  return record && new Blob([record.bytes], { type: record.type })
}

export async function getPhotoUrl(id: Id, size: PhotoSize): Promise<string | undefined> {
  const blob = await getPhotoBlob(id, size)
  return blob && URL.createObjectURL(blob)
}

interface Manifest {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: EpochMs
  trip: Trip
  track: TrackPoint[] | null
  photos: (PhotoRecord & { file: string })[]
}

export async function exportTrip(id: Id): Promise<Blob> {
  const { strToU8, zipSync } = await loadZip()
  const { manifest, files } = await run('readonly', ALL, async (tx) => {
    const trip = await tx.objectStore('trips').get(id)
    if (!trip) throw new Error(MSG.noTrip)

    const track = (await tx.objectStore('tracks').get(id))?.points ?? null
    const photos = (await tx.objectStore('photos').index('tripId').getAll(id)).sort(byTime)
    const files: Record<string, [Uint8Array, { level: 0 }]> = {}

    for (const photo of photos) {
      const blob = await tx.objectStore('blobs').get([photo.id, 'full'])
      if (blob) files[`photos/${photo.id}.jpg`] = [new Uint8Array(blob.bytes), { level: 0 }]
    }

    const manifest: Manifest = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      trip,
      track,
      photos: photos.map((p) => ({ ...p, file: `photos/${p.id}.jpg` })),
    }

    return { manifest, files }
  })

  // ponytail: builds the whole zip in memory (about the sum of the full-size photos, ~1 MB each); upgrade path is fflate's streaming Zip writing into a ReadableStream.
  const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...files })
  return new Blob([zip], { type: 'application/zip' })
}

function readManifest(entries: Record<string, Uint8Array>, strFromU8: (data: Uint8Array) => string): Manifest {
  const raw = entries['manifest.json']
  if (!raw) throw new Error(MSG.notArchive)

  let m: Manifest

  try {
    m = JSON.parse(strFromU8(raw))
  } catch {
    throw new Error(MSG.notArchive)
  }

  if (m?.format !== EXPORT_FORMAT || typeof m.version !== 'number') throw new Error(MSG.notArchive)
  if (m.version > EXPORT_VERSION) throw new Error(MSG.newer)
  if (!m.trip || typeof m.trip.title !== 'string' || !Array.isArray(m.photos)) throw new Error(MSG.notArchive)
  const validPoint = (p: TrackPoint) => typeof p?.lat === 'number' && typeof p?.lon === 'number'
  if (m.track !== null && !(Array.isArray(m.track) && m.track.every(validPoint))) throw new Error(MSG.notArchive)

  return m
}

export async function importTrip(file: Blob): Promise<Trip> {
  const { strFromU8, unzipSync } = await loadZip()
  let entries: Record<string, Uint8Array>

  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error(MSG.notArchive)
  }

  const m = readManifest(entries, strFromU8)
  const now = Date.now()
  const tripId = crypto.randomUUID()

  const photos: { record: PhotoRecord; full: BlobRecord; thumb: BlobRecord }[] = []

  for (const p of m.photos) {
    const bytes = entries[p.file]
    if (!bytes) throw new Error(`${MSG.incomplete} ${p.fileName}`)

    const full = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })
    const rendered = await renderImage(full, 1, false).catch(() => {
      throw new Error(MSG.badPhoto)
    })

    const id = crypto.randomUUID()

    photos.push({
      record: {
        id,
        tripId,
        fileName: String(p.fileName),
        takenAt: typeof p.takenAt === 'number' ? p.takenAt : null,
        gps: p.gps ?? null,
        caption: String(p.caption ?? ''),
        width: rendered.width,
        height: rendered.height,
        placement: { source: 'none' },
        sourceKey: String(p.sourceKey ?? id),
      },
      full: { photoId: id, size: 'full', type: 'image/jpeg', bytes: bytes.slice().buffer },
      thumb: { photoId: id, size: 'thumb', ...(await toRecord(rendered.thumb)) },
    })
  }

  const cover = m.photos.findIndex((p) => p.id === m.trip.coverPhotoId)

  const trip: Trip = {
    id: tripId,
    title: m.trip.title,
    diary: String(m.trip.diary ?? ''),
    startAt: null,
    endAt: null,
    hasTrack: false,
    stats: null,
    coverPhotoId: photos[cover]?.record.id ?? null,
    photoCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  return run('readwrite', ALL, async (tx) => {
    await tx.objectStore('trips').add(trip)
    if (m.track?.length) await tx.objectStore('tracks').add({ tripId, points: m.track })

    for (const p of photos) {
      await tx.objectStore('photos').add(p.record)
      await tx.objectStore('blobs').add(p.full)
      await tx.objectStore('blobs').add(p.thumb)
    }

    return refresh(tx, tripId)
  })
}
