import type { MapOptions } from 'maplibre-gl'

export type MapStyle = Exclude<MapOptions['style'], string | undefined>

export type MapLayer = MapStyle['layers'][number]

export const THUNDERFOREST_ATTRIBUTION =
  'Maps © <a href="https://www.thunderforest.com/">Thunderforest</a>, Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

export const NLSC_ATTRIBUTION = '<a href="https://maps.nlsc.gov.tw/">內政部國土測繪中心</a>'

export const TERRAIN_ATTRIBUTION =
  'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen</a>, U.S. Geological Survey (SRTM, GMTED2010), NOAA (ETOPO1)'

export const NLSC_PHOTO_TILES = 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'

export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

export const TERRAIN_SOURCE_ID = 'terrain'

export const TERRAIN_EXAGGERATION = 1.2

export const ROUTE_COLOR = '#B84A22'

export function thunderforestTiles(key: string): string {
  return `https://tile.thunderforest.com/outdoors/{z}/{x}/{y}@2x.png?apikey=${encodeURIComponent(key)}`
}

export function flatStyle(key: string): MapStyle {
  return {
    version: 8,
    sources: {
      outdoors: {
        type: 'raster',
        tiles: [thunderforestTiles(key)],
        tileSize: 256,
        maxzoom: 22,
        attribution: THUNDERFOREST_ATTRIBUTION,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#E2EAD0' } },
      { id: 'outdoors', type: 'raster', source: 'outdoors' },
    ],
  }
}

export function flyoverStyle(): MapStyle {
  return {
    version: 8,
    sources: {
      photo: {
        type: 'raster',
        tiles: [NLSC_PHOTO_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: NLSC_ATTRIBUTION,
      },
      [TERRAIN_SOURCE_ID]: {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: TERRAIN_ATTRIBUTION,
      },
    },
    terrain: { source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION },
    sky: {
      'sky-color': '#BFD6E6',
      'horizon-color': '#F6EBD3',
      'fog-color': '#EEF1E2',
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1C2A22' } },
      { id: 'photo', type: 'raster', source: 'photo' },
    ],
  }
}

export function routeLayers(sourceId: string): MapLayer[] {
  return [
    {
      id: `${sourceId}-casing`,
      type: 'line',
      source: sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 8 },
    },
    {
      id: `${sourceId}-line`,
      type: 'line',
      source: sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ROUTE_COLOR, 'line-width': 4.5 },
    },
  ]
}
