import { afterEach, expect, test, vi } from 'vitest'
import { renderImage } from './image'

afterEach(() => vi.unstubAllGlobals())

test('a failed orientation probe is not cached: the next photo probes again', async () => {
  const bitmap = { width: 1, height: 2, close() {} }
  const decode = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue(bitmap)
  vi.stubGlobal('createImageBitmap', decode)

  await expect(renderImage(new Blob(['a']), 1, false)).rejects.toThrow('transient')
  await renderImage(new Blob(['b']), 1, false).catch(() => {})
  await renderImage(new Blob(['c']), 1, false).catch(() => {})

  expect(decode).toHaveBeenCalledTimes(4)
})
