import { useCallback, useId } from 'react'
import { TEXT_LIMITS, updateTrip } from '../../storage'
import { useAutosave, type SaveStatus } from './drafts'
import s from './journal.module.css'

const DEBOUNCE_MS = 700

const STATUS: Record<SaveStatus, string> = {
  idle: '',
  dirty: '',
  saving: '儲存中…',
  saved: '已自動儲存',
  error: '還沒存起來，請再試一次',
}

export function Diary({ tripId, initial }: { tripId: string; initial: string }) {
  const id = useId()
  const save = useCallback((text: string) => updateTrip(tripId, { diary: text }), [tripId])
  const { text, status, change, flush } = useAutosave({ trip: tripId }, initial, save, DEBOUNCE_MS)

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
        maxLength={TEXT_LIMITS.diary}
      />
    </section>
  )
}
