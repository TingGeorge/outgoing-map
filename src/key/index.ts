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

export function validateKey(key: string): Promise<KeyCheck> {
  throw new Error('not implemented')
}
