import type { Poi, PoiOnRoute, Route } from '../types'

export const DEFAULT_POI_RADIUS_M = 100

export function loadPois(): Promise<Poi[]> {
  throw new Error('not implemented')
}

export function poisAlongRoute(route: Route, withinM: number = DEFAULT_POI_RADIUS_M): Promise<PoiOnRoute[]> {
  throw new Error('not implemented')
}
