import type { Photo, PlacementSource, PoiKind } from '../../types'
import { formatTime } from '../../ui'

export const POI_KIND: Record<PoiKind, string> = {
  peak: '山頂',
  trailhead: '登山口',
  hut: '山屋',
  shelter: '避難小屋',
  campsite: '營地',
  viewpoint: '觀景點',
  water: '水源',
  waterfall: '瀑布',
  lake: '湖泊',
  hotspring: '溫泉',
  other_hiking: '沿途景點',
}

export const PLACEMENT: Record<PlacementSource, string> = {
  track: '依時間放在軌跡上',
  exif: '照片自己的定位',
  none: '無法放到路線上',
}

export function photoAlt(photo: Photo): string {
  if (photo.caption.trim()) return photo.caption.trim()
  return photo.takenAt === null ? '照片' : `${formatTime(photo.takenAt)} 拍的照片`
}

export function photoEle(photo: Photo): number | null {
  return (photo.placement.source !== 'none' ? photo.placement.ele : null) ?? photo.gps?.ele ?? null
}

const fileDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })

export function exportFileName(title: string, at: number): string {
  return `${title}-${fileDate.format(at)}.hiking.zip`.replace(/[/\\:*?"<>|]/g, '-')
}
