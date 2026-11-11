import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { deletePhoto, getPhotoUrl, updatePhoto, updateTrip } from '../../storage'
import type { Photo } from '../../types'
import {
  BackIcon,
  Button,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  ConfirmDialog,
  IconButton,
  PhotoIcon,
  Spinner,
  TrashIcon,
  formatDate,
  formatMetres,
  formatTime,
} from '../../ui'
import { PLACEMENT, photoAlt, photoEle } from './text'
import s from './journal.module.css'

interface Props {
  photos: Photo[]
  photoId: string
  tripId: string
  coverId: string | null
  onSelect: (id: string) => void
  onClose: () => void
  reload: () => Promise<void>
}

const SWIPE_PX = 50

export function Viewer({ photos, photoId, tripId, coverId, onSelect, onClose, reload }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const index = Math.max(0, photos.findIndex((p) => p.id === photoId))
  const photo = photos[index]

  const prev = index > 0 ? photos[index - 1] : undefined
  const next = photos[index + 1]

  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    }

    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = before
    }
  }, [])

  useEffect(() => setMessage(''), [photoId])

  const go = useCallback((p: Photo | undefined) => p && onSelect(p.id), [onSelect])

  const swipe = useRef<{ x: number; y: number } | null>(null)

  const down = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY }
  }

  const up = (e: PointerEvent) => {
    const start = swipe.current
    swipe.current = null
    if (!start) return

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return

    go(dx < 0 ? next : prev)
  }

  if (!photo) return null

  const ele = photoEle(photo)
  const isCover = coverId === photo.id

  const setCover = async () => {
    setBusy(true)

    try {
      await updateTrip(tripId, { coverPhotoId: photo.id })
      await reload()
      setMessage('已設為這篇回憶的封面')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)

    try {
      await deletePhoto(photo.id)
      const after = next ?? prev
      await reload()
      setConfirm(false)

      if (after) onSelect(after.id)
      else onClose()
    } catch (e) {
      setConfirm(false)
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className={s.viewer}
      tabIndex={-1}
      aria-label="照片"
      onCancel={(e) => {
        e.preventDefault()
        if (!confirm) onClose()
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLTextAreaElement || confirm) return
        if (e.key === 'ArrowLeft') go(prev)
        if (e.key === 'ArrowRight') go(next)
      }}
    >
      <div className={s.viewerTop}>
        <IconButton label="關閉照片" variant="dark" onClick={onClose}>
          <CloseIcon />
        </IconButton>
        <span className={s.viewerCount} aria-live="polite">
          第 {index + 1} 張，共 {photos.length} 張
        </span>
      </div>

      <div className={s.stage} onPointerDown={down} onPointerUp={up} onPointerCancel={() => (swipe.current = null)}>
        <FullImage key={photo.id} photo={photo} />

        {prev && (
          <span className={s.prev}>
            <IconButton label="上一張" variant="dark" onClick={() => go(prev)}>
              <BackIcon />
            </IconButton>
          </span>
        )}
        {next && (
          <span className={s.next}>
            <IconButton label="下一張" variant="dark" onClick={() => go(next)}>
              <ChevronRightIcon />
            </IconButton>
          </span>
        )}
      </div>

      <div className={s.viewerPanel}>
        <p className={s.viewerMeta}>
          {photo.takenAt !== null && (
            <span>
              {formatDate(photo.takenAt)}　{formatTime(photo.takenAt)}
            </span>
          )}
          {ele !== null && <span>海拔 {formatMetres(ele)} 公尺</span>}
        </p>
        <p className={s.viewerPlace}>在路線上的位置：{PLACEMENT[photo.placement.source]}</p>

        <Caption key={photo.id} photo={photo} reload={reload} />

        <div className={s.viewerActions}>
          <Button variant="ghost" inline icon={isCover ? <CheckIcon size={20} /> : <PhotoIcon size={20} />} onClick={setCover} disabled={busy || isCover}>
            {isCover ? '這是封面' : '設為封面'}
          </Button>
          <Button variant="ghost" inline icon={<TrashIcon size={20} />} onClick={() => setConfirm(true)} disabled={busy}>
            刪除照片
          </Button>
        </div>

        <p className={s.viewerMessage} role="status">
          {message}
        </p>
      </div>

      <ConfirmDialog
        open={confirm}
        danger
        busy={busy}
        title="刪除這張照片？"
        message="照片和它的說明會從這篇回憶刪除，無法復原。"
        confirmLabel="刪除"
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </dialog>
  )
}

function FullImage({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let gone = false
    let created: string | undefined

    getPhotoUrl(photo.id, 'full').then(
      (u) => {
        if (!u) return setFailed(true)
        if (gone) return URL.revokeObjectURL(u)
        created = u
        setUrl(u)
      },
      () => setFailed(true),
    )

    return () => {
      gone = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [photo.id])

  if (failed) return <p className={s.viewerFail}>這張照片讀不出來。</p>
  if (!url) return <Spinner label="照片載入中" />

  return <img className={s.full} src={url} alt={photoAlt(photo)} draggable={false} />
}

function Caption({ photo, reload }: { photo: Photo; reload: () => Promise<void> }) {
  const [text, setText] = useState(photo.caption)
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  const saved = useRef(photo.caption)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(text)
  latest.current = text

  const flush = useCallback(async () => {
    clearTimeout(timer.current)

    const value = latest.current
    if (value === saved.current) return

    try {
      await updatePhoto(photo.id, { caption: value })
      saved.current = value
      setState('saved')
      await reload()
    } catch {
      setState('error')
    }
  }, [photo.id, reload])

  useEffect(() => () => void flush(), [flush])

  useEffect(() => {
    if (latest.current !== saved.current) return
    saved.current = photo.caption
    setText(photo.caption)
  }, [photo.caption])

  return (
    <div className={s.captionField}>
      <label htmlFor={`caption-${photo.id}`}>照片說明</label>
      <textarea
        id={`caption-${photo.id}`}
        value={text}
        rows={2}
        placeholder="寫一句話，記下這一刻"
        onChange={(e) => {
          setText(e.target.value)
          setState('idle')
          clearTimeout(timer.current)
          timer.current = setTimeout(() => void flush(), 800)
        }}
        onBlur={() => void flush()}
      />
      <span className={s.saveState} role="status">
        {state === 'saved' ? '已儲存' : state === 'error' ? '還沒存起來，請再試一次' : ''}
      </span>
    </div>
  )
}
