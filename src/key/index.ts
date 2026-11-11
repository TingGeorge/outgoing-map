import type { KeyCheck } from '../types'

const STORAGE_KEY = 'thunderforest-key'

export function getKey(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key.trim())
}

export function clearKey(): void {
  localStorage.removeItem(STORAGE_KEY)
}

const TEST_TILE = 'https://tile.thunderforest.com/outdoors/0/0/0.png'
const TIMEOUT_MS = 10_000

export async function validateKey(raw: string): Promise<KeyCheck> {
  const key = raw.trim()

  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return 'invalid'

  try {
    const res = await fetch(`${TEST_TILE}?apikey=${key}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })

    if (res.ok) return 'valid'
    if (res.status === 401 || res.status === 403) return 'invalid'
    return 'network-error'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') return 'network-error'

    // ponytail: Thunderforest's 401 carries no CORS header, so a rejected key looks like an offline fetch;
    // a keyless request (200 with CORS) tells the two apart. A 5xx or 429 without CORS reads as 'invalid'.
    try {
      const probe = await fetch(TEST_TILE, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      return probe.ok ? 'invalid' : 'network-error'
    } catch {
      return 'network-error'
    }
  }
}
