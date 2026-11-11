export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

const VISIBLE = 2
const LIFETIME = 3500

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(next: ToastItem[]) {
  items = next
  listeners.forEach((l) => l())
}

export function toast(message: string, { tone = 'info' }: { tone?: ToastTone } = {}) {
  const id = nextId++

  emit([...items, { id, message, tone }].slice(-VISIBLE))
  setTimeout(() => emit(items.filter((t) => t.id !== id)), LIFETIME)
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts() {
  return items
}
