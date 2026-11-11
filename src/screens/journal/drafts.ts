import { useCallback, useEffect, useRef, useState } from 'react'
import { getTrip, updatePhoto, updateTrip } from '../../storage'
import type { Photo, Trip } from '../../types'

export interface Where {
  trip: string
  photo?: string
}

interface Draft extends Where {
  text: string
  at: number
  base: string
}

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const PREFIX = 'journal-draft:'

const keyOf = (where: Where) => `${PREFIX}${where.trip}/${where.photo ?? 'diary'}`

export function fingerprint(text: string): string {
  let h = 0x811c9dc5

  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)

  return `${text.length}:${(h >>> 0).toString(36)}`
}

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key)
    const d = raw === null ? null : (JSON.parse(raw) as Draft)
    return d && typeof d.text === 'string' && typeof d.trip === 'string' ? d : null
  } catch {
    return null
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

function writeDraft(where: Where, text: string, base: string) {
  const key = keyOf(where)

  try {
    localStorage.setItem(key, JSON.stringify({ ...where, text, at: Date.now(), base }))
  } catch {
    forget(key)
  }
}

function dropDraft(where: Where, text: string) {
  const key = keyOf(where)
  if (readDraft(key)?.text === text) forget(key)
}

function pendingDraft(where: Where, stored: string): string | null {
  const d = readDraft(keyOf(where))
  return d && d.text !== stored && d.base === fingerprint(stored) ? d.text : null
}

function draftKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
  } catch {
    return []
  }
}

export async function applyDrafts(trip: Trip, photos: Photo[]): Promise<boolean> {
  let changed = false

  for (const key of draftKeys()) {
    const d = readDraft(key)
    if (!d) {
      forget(key)
      continue
    }

    if (d.trip !== trip.id) {
      if (!(await getTrip(d.trip).catch(() => true))) forget(key)
      continue
    }

    const stored = d.photo === undefined ? trip.diary : photos.find((p) => p.id === d.photo)?.caption
    const untouched = stored !== undefined && d.base === fingerprint(stored)
    const newer = d.photo === undefined && d.at > trip.updatedAt

    if (stored === undefined || stored === d.text || !(untouched || newer)) {
      forget(key)
      continue
    }

    try {
      if (d.photo === undefined) await updateTrip(trip.id, { diary: d.text })
      else await updatePhoto(d.photo, { caption: d.text })

      dropDraft(d, d.text)
      changed = true
    } catch {}
  }

  return changed
}

export function useAutosave(where: Where, stored: string, save: (text: string) => Promise<unknown>, delayMs: number) {
  const [initial] = useState(() => ({ base: fingerprint(stored), text: pendingDraft(where, stored) ?? stored }))
  const [text, setText] = useState(initial.text)
  const [status, setStatus] = useState<SaveStatus>(initial.text === stored ? 'idle' : 'dirty')

  const latest = useRef(initial.text)
  const saved = useRef(stored)
  const base = useRef(initial.base)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const saveRef = useRef(save)
  saveRef.current = save

  const whereRef = useRef(where)
  whereRef.current = where

  const flush = useCallback(() => {
    clearTimeout(timer.current)

    chain.current = chain.current.then(async () => {
      const value = latest.current
      if (value === saved.current) return

      setStatus('saving')

      try {
        await saveRef.current(value)
        saved.current = value
        base.current = fingerprint(value)
        dropDraft(whereRef.current, value)
        setStatus(latest.current === value ? 'saved' : 'dirty')
      } catch {
        setStatus('error')
      }
    })

    return chain.current
  }, [])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }

    if (latest.current !== saved.current) void flush()

    addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)

    return () => {
      removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      void flush()
    }
  }, [flush])

  const change = (value: string) => {
    latest.current = value
    setText(value)
    setStatus('dirty')
    writeDraft(whereRef.current, value, base.current)

    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), delayMs)
  }

  return { text, status, change, flush }
}
