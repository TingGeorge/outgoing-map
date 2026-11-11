import { useEffect, useState } from 'react'
import { Button, Card, CloseIcon } from '../ui'
import s from './pwa.module.css'

const DISMISS_KEY = 'pwa-install-hint-dismissed'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage

    if (!storage?.persist) return false
    if (await storage.persisted?.()) return true

    return await storage.persist()
  } catch {
    return false
  }
}

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

export function isIOS(): boolean {
  const ua = navigator.userAgent
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1

  return /iPhone|iPad|iPod/.test(ua) || iPadOS
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function ShareIcon() {
  return (
    <svg className={s.share} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="分享">
      <path d="M12 15V3M8 7l4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </svg>
  )
}

export function InstallHint() {
  const [dismissed, setDismissed] = useState(wasDismissed)
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const ios = isIOS()

  if (dismissed || isStandalone() || (!ios && !prompt)) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {}

    setDismissed(true)
  }

  const install = async () => {
    await prompt?.prompt()
    dismiss()
  }

  return (
    <Card tone="moss" radius="md">
      <div className={s.hint}>
        <div className={s.head}>
          <h2 className={s.title}>加到主畫面，更像 App</h2>
          <button type="button" className={s.close} aria-label="關閉提示" onClick={dismiss}>
            <CloseIcon />
          </button>
        </div>

        <p className={s.text}>全螢幕、像 App 一樣開啟，資料也比較不會被瀏覽器清掉。</p>

        {ios ? (
          <p className={s.text}>
            點下方工具列的 <ShareIcon /> 分享，再選「加入主畫面」。
          </p>
        ) : (
          <Button onClick={install}>安裝到主畫面</Button>
        )}
      </div>
    </Card>
  )
}
