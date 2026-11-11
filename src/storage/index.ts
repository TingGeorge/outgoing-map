import type { AddPhotosResult, Id, Photo, PhotoPatch, PhotoSize, TrackPoint, Trip, TripPatch } from '../types'

export function listTrips(): Promise<Trip[]> {
  throw new Error('not implemented')
}

export function getTrip(id: Id): Promise<Trip | undefined> {
  throw new Error('not implemented')
}

export function createTrip(input: { title: string; diary?: string }): Promise<Trip> {
  throw new Error('not implemented')
}

export function updateTrip(id: Id, patch: TripPatch): Promise<Trip> {
  throw new Error('not implemented')
}

export function deleteTrip(id: Id): Promise<void> {
  throw new Error('not implemented')
}

export function saveTrack(tripId: Id, points: TrackPoint[]): Promise<Trip> {
  throw new Error('not implemented')
}

export function getTrack(tripId: Id): Promise<TrackPoint[] | null> {
  throw new Error('not implemented')
}

export function addPhotos(
  tripId: Id,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<AddPhotosResult> {
  throw new Error('not implemented')
}

export function listPhotos(tripId: Id): Promise<Photo[]> {
  throw new Error('not implemented')
}

export function updatePhoto(id: Id, patch: PhotoPatch): Promise<Photo> {
  throw new Error('not implemented')
}

export function deletePhoto(id: Id): Promise<void> {
  throw new Error('not implemented')
}

export function getPhotoBlob(id: Id, size: PhotoSize): Promise<Blob | undefined> {
  throw new Error('not implemented')
}

export function getPhotoUrl(id: Id, size: PhotoSize): Promise<string | undefined> {
  throw new Error('not implemented')
}

export function exportTrip(id: Id): Promise<Blob> {
  throw new Error('not implemented')
}

export function importTrip(file: Blob): Promise<Trip> {
  throw new Error('not implemented')
}
