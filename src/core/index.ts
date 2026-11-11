import type {
  ElevationProfile,
  EpochMs,
  LatLon,
  NearestOnRoute,
  ParsedGpx,
  Photo,
  Placement,
  PoiOnRoute,
  Route,
  RouteSample,
  TimelineItem,
  TrackPoint,
  TripStats,
} from '../types'

export function parseGpx(xml: string): ParsedGpx {
  throw new Error('not implemented')
}

export function exifTimeToEpoch(dateTimeOriginal: string, offsetTimeOriginal?: string | null): EpochMs | null {
  throw new Error('not implemented')
}

export function distanceM(a: LatLon, b: LatLon): number {
  throw new Error('not implemented')
}

export function buildRoute(track: TrackPoint[] | null, photos: Photo[]): Route {
  throw new Error('not implemented')
}

export function routeStats(route: Route): TripStats {
  throw new Error('not implemented')
}

export function sampleAtDistance(route: Route, distanceM: number): RouteSample | null {
  throw new Error('not implemented')
}

export function sampleAtTime(route: Route, time: EpochMs): RouteSample | null {
  throw new Error('not implemented')
}

export function nearestOnRoute(route: Route, point: LatLon): NearestOnRoute | null {
  throw new Error('not implemented')
}

export function placePhotos(photos: Photo[], route: Route): Placement[] {
  throw new Error('not implemented')
}

export function buildTimeline(route: Route, photos: Photo[], pois: PoiOnRoute[]): TimelineItem[] {
  throw new Error('not implemented')
}

export function elevationProfile(route: Route, samples?: number): ElevationProfile | null {
  throw new Error('not implemented')
}
