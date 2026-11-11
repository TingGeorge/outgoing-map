import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { updateTrip } from '../../storage'
import s from './journal.module.css'

type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 700

const STATUS: Record<Status, string> = {
  idle: '',
  dirty: '',
  saving: '儲存中…',
  saved: '已自動儲存',
  error: '還沒存起來，請再試一次',
}

export function Diary({ tripId, initial }: { tripId: string; initial: string }) {
  const id = useId()
  const [text, setText] = useState(initial)
  const [status, setStatus] = useState<Status>('idle')
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)

    const value = pending.current
    if (value === null) return

    pending.current = null
    setStatus('saving')

    try {
      await updateTrip(tripId, { diary: value })
      setStatus(pending.current === null ? 'saved' : 'dirty')
    } catch {
      pending.current ??= value
      setStatus('error')
    }
  }, [tripId])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }

    addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)

    return () => {
      removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      void flush()
    }
  }, [flush])

  const change = (value: string) => {
    setText(value)
    pending.current = value
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS)
  }

  return (
    <section className={s.diary}>
      <span className={s.tape} aria-hidden="true" />
      <div className={s.diaryHead}>
        <h2>
          <label htmlFor={id}>日記</label>
        </h2>
        <span className={status === 'error' ? s.saveError : s.saveState} role="status">
          {STATUS[status]}
        </span>
      </div>
      <textarea
        id={id}
        className={s.diaryText}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={() => void flush()}
        placeholder="今天的天氣、路上的風景、和誰一起走…想到什麼就寫下來。"
        rows={5}
      />
    </section>
  )
}
