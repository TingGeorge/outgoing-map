import { useEffect, useRef } from 'react'

interface Overlay {
  close: () => void
}

const open: Overlay[] = []
const waiting: (() => void)[] = []

let home: string | null = null
let busy = false
let expected = 0
let queued = false

function level(): number {
  const n = history.state?.journalOverlay
  return typeof n === 'number' ? n : 0
}

function sync() {
  queued = false
  if (busy || home === null || location.hash !== home) return

  const current = level()

  if (current > open.length) {
    busy = true
    expected = open.length
    history.go(open.length - current)
    return
  }

  for (let n = current + 1; n <= open.length; n++) history.pushState({ ...history.state, journalOverlay: n }, '')

  if (open.length === 0) for (const fn of waiting.splice(0)) fn()
}

function later() {
  if (queued) return
  queued = true
  queueMicrotask(sync)
}

addEventListener('popstate', () => {
  const ours = busy && level() === expected
  busy = false

  if (home === null || location.hash !== home) return

  if (!ours) for (const overlay of open.splice(level()).reverse()) overlay.close()
  sync()
})

export function useOverlayHome(id: string) {
  useEffect(() => {
    const mine = location.hash
    home = mine
    later()

    return () => {
      if (home !== mine) return
      home = null
      busy = false
      open.length = 0
      waiting.length = 0
    }
  }, [id])
}

export function useBackToClose(isOpen: boolean, close: () => void) {
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!isOpen) return

    const overlay = { close: () => latest.current() }
    open.push(overlay)
    later()

    return () => {
      const i = open.indexOf(overlay)
      if (i < 0) return
      open.splice(i, 1)
      later()
    }
  }, [isOpen])
}

export function afterOverlays(fn: () => void) {
  if (home === null) return fn()
  waiting.push(fn)
  later()
}
