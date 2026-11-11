export type Id = string

export type EpochMs = number

export const DEFAULT_PHOTO_UTC_OFFSET = '+08:00'

export const PHOTO_TIME_TOLERANCE_MS = 30 * 60 * 1000

export interface LatLon {
  lat: number
  lon: number
}

export interface TrackPoint extends LatLon {
  time: EpochMs | null
  ele: number | null
}

export interface TripStats {
  distanceM: number
  ascentM: number
  descentM: number
  durationMs: number | null
  maxEleM: number | null
  minEleM: number | null
}

export interface Trip {
  id: Id
  title: string
  startAt: EpochMs | null
  endAt: EpochMs | null
  diary: string
  hasTrack: boolean
  stats: TripStats | null
  coverPhotoId: Id | null
  photoCount: number
  createdAt: EpochMs
  updatedAt: EpochMs
}

export type TripPatch = Partial<Pick<Trip, 'title' | 'diary' | 'coverPhotoId'>>

export interface PhotoGps extends LatLon {
  ele: number | null
  heading: number | null
}

export type PlacementSource = 'track' | 'exif' | 'none'

export type Placement =
  | { source: 'track' | 'exif'; lat: number; lon: number; ele: number | null; routeDistanceM: number }
  | { source: 'none' }

export interface Photo {
  id: Id
  tripId: Id
  fileName: string
  takenAt: EpochMs | null
  gps: PhotoGps | null
  caption: string
  width: number
  height: number
  placement: Placement
}

export type PhotoPatch = Partial<Pick<Photo, 'caption'>>

export type PhotoSize = 'full' | 'thumb'

export interface PhotoImportFailure {
  fileName: string
  reason: string
}

export interface AddPhotosResult {
  added: Photo[]
  failed: PhotoImportFailure[]
}

export interface ParsedGpx {
  name: string | null
  points: TrackPoint[]
}

export interface RoutePoint extends TrackPoint {
  distanceM: number
}

export type RouteSource = 'gpx' | 'photos'

export interface Route {
  source: RouteSource
  points: RoutePoint[]
  totalDistanceM: number
  startAt: EpochMs | null
  endAt: EpochMs | null
}

export interface RouteSample extends LatLon {
  ele: number | null
  time: EpochMs | null
  distanceM: number
}

export interface NearestOnRoute {
  routeDistanceM: number
  offsetM: number
}

export type PoiKind =
  | 'peak'
  | 'trailhead'
  | 'hut'
  | 'shelter'
  | 'campsite'
  | 'viewpoint'
  | 'water'
  | 'waterfall'
  | 'lake'
  | 'hotspring'
  | 'other_hiking'

export interface Poi extends LatLon {
  id: number
  name: string
  kind: PoiKind
  ele: number | null
}

export interface PoiOnRoute {
  poi: Poi
  offsetM: number
  routeDistanceM: number
  passedAt: EpochMs | null
}

export type TimelineItem =
  | { kind: 'start'; time: EpochMs | null; routeDistanceM: number; point: RouteSample }
  | { kind: 'end'; time: EpochMs | null; routeDistanceM: number; point: RouteSample }
  | { kind: 'poi'; time: EpochMs | null; routeDistanceM: number; hit: PoiOnRoute }
  | { kind: 'photo'; time: EpochMs | null; routeDistanceM: number | null; photo: Photo }

export interface ElevationSample {
  distanceM: number
  ele: number
}

export interface ElevationProfile {
  samples: ElevationSample[]
  totalDistanceM: number
  minEleM: number
  maxEleM: number
}

export type KeyCheck = 'valid' | 'invalid' | 'network-error'
