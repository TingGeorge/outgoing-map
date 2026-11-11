const FULL_EDGE = 2048
const THUMB_EDGE = 480
const QUALITY = 0.85

const ROTATED_2X1 =
  '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAABAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AQH//2Q=='

let autoRotates: Promise<boolean> | undefined

function browserAppliesOrientation(): Promise<boolean> {
  autoRotates ??= (async () => {
    const bytes = Uint8Array.from(atob(ROTATED_2X1), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
    const rotated = bitmap.height > bitmap.width
    bitmap.close()
    return rotated
  })().catch((e: unknown) => {
    autoRotates = undefined
    throw e
  })

  return autoRotates
}

export interface Rendered {
  width: number
  height: number
  full: Blob | null
  thumb: Blob
}

export async function renderImage(file: Blob, orientation: number, withFull: boolean): Promise<Rendered> {
  const manual = (await browserAppliesOrientation()) ? 1 : orientation

  // ponytail: decodes at full resolution (≈ 4 bytes per pixel, ~200 MB for a 48 MP photo); upgrade path is createImageBitmap's resizeWidth/resizeHeight once its interplay with orientation is consistent in WebKit.
  const bitmap = await createImageBitmap(file)

  try {
    const full = draw(bitmap, FULL_EDGE, manual)

    try {
      const thumb = draw(full, THUMB_EDGE, 1)

      try {
        return {
          width: full.width,
          height: full.height,
          full: withFull ? await encode(full) : null,
          thumb: await encode(thumb),
        }
      } finally {
        release(thumb)
      }
    } finally {
      release(full)
    }
  } finally {
    bitmap.close()
  }
}

function draw(source: ImageBitmap | HTMLCanvasElement, maxEdge: number, orientation: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  const swap = orientation >= 5 && orientation <= 8

  const canvas = document.createElement('canvas')
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const transforms: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  }

  const t = transforms[orientation]
  if (t) ctx.transform(...t)

  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', QUALITY),
  )
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}
