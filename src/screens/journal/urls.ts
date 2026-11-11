export function release(url: string, img: HTMLImageElement | null | undefined) {
  if (!img) return URL.revokeObjectURL(url)
  img.decode().then(
    () => URL.revokeObjectURL(url),
    () => URL.revokeObjectURL(url),
  )
}
