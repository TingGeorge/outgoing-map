import { useRef, useState } from 'react'
import { parseGpx } from '../../core'
import { goBack } from '../../router'
import { PHOTO_FAILURE, addPhotos, deleteTrip, exportTrip, saveTrack } from '../../storage'
import type { PhotoImportFailure, TrackPoint, Trip } from '../../types'
import { Button, ConfirmDialog, Dialog, DownloadIcon, ProgressBar, ShareIcon, Spinner, toast } from '../../ui'
import { afterOverlays, useBackToClose } from './overlays'
import { exportFileName, short } from './text'
import s from './journal.module.css'

type Adding = { phase: 'working'; done: number; total: number } | { phase: 'done'; added: number; duplicates: number; failed: PhotoImportFailure[] }

type Exporting = { phase: 'working' } | { phase: 'ready'; file: File } | { phase: 'error'; message: string }

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function useTripActions(trip: Trip, reload: () => Promise<void>) {
  const photoInput = useRef<HTMLInputElement>(null)
  const gpxInput = useRef<HTMLInputElement>(null)

  const [adding, setAdding] = useState<Adding | null>(null)
  const [gpx, setGpx] = useState<{ points: TrackPoint[] } | null>(null)
  const [gpxBusy, setGpxBusy] = useState(false)
  const [exporting, setExporting] = useState<Exporting | null>(null)
  const [deleting, setDeleting] = useState<'ask' | 'busy' | null>(null)

  useBackToClose(adding?.phase === 'done', () => setAdding(null))
  useBackToClose(gpx !== null && !gpxBusy, () => setGpx(null))
  useBackToClose(exporting !== null && exporting.phase !== 'working', () => setExporting(null))
  useBackToClose(deleting === 'ask', () => setDeleting(null))

  const onPhotos = async (files: File[]) => {
    setAdding({ phase: 'working', done: 0, total: files.length })

    try {
      const result = await addPhotos(trip.id, files, (done, total) => setAdding({ phase: 'working', done, total }))
      const duplicates = result.failed.filter((f) => f.reason === PHOTO_FAILURE.duplicate).length
      const failed = result.failed.filter((f) => f.reason !== PHOTO_FAILURE.duplicate)

      setAdding({ phase: 'done', added: result.added.length, duplicates, failed })
    } catch (e) {
      setAdding({ phase: 'done', added: 0, duplicates: 0, failed: [{ fileName: '', reason: (e as Error).message }] })
    }

    await reload()
  }

  const writeTrack = async (points: TrackPoint[]) => {
    setGpxBusy(true)

    try {
      await saveTrack(trip.id, points)
      await reload()
      toast(trip.hasTrack ? '已換上新的路線' : '已加入路線', { tone: 'success' })
      setGpx(null)
    } catch (e) {
      toast((e as Error).message, { tone: 'error' })
    } finally {
      setGpxBusy(false)
    }
  }

  const onGpx = async (file: File) => {
    let points: TrackPoint[]

    try {
      points = parseGpx(await file.text()).points
    } catch (e) {
      toast(e instanceof Error && e.constructor === Error ? e.message : '這個檔案不是有效的 GPX', { tone: 'error' })
      return
    }

    if (trip.hasTrack) setGpx({ points })
    else await writeTrack(points)
  }

  const startExport = async () => {
    setExporting({ phase: 'working' })

    try {
      const blob = await exportTrip(trip.id)
      const name = exportFileName(trip.title, trip.startAt ?? trip.createdAt)
      setExporting({ phase: 'ready', file: new File([blob], name, { type: 'application/zip' }) })
    } catch (e) {
      setExporting({ phase: 'error', message: (e as Error).message })
    }
  }

  const deliver = async (file: File) => {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: short(trip.title, 80) })
        setExporting(null)
        toast('已交給分享選單，存到「檔案」就有備份了', { tone: 'success' })
      } catch (e) {
        if ((e as Error).name === 'AbortError') toast('沒有分享，匯出檔還沒存下來')
        else download(file)
      }

      return
    }

    download(file)
  }

  const download = (file: File) => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.rel = 'noopener'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)

    setExporting(null)
    toast(`已下載 ${file.name}`, { tone: 'success' })
  }

  const removeTrip = async () => {
    setDeleting('busy')

    try {
      await deleteTrip(trip.id)
      toast(`已刪除「${short(trip.title, 60)}」`)
      afterOverlays(() => goBack({ name: 'home' }))
    } catch (e) {
      setDeleting(null)
      toast((e as Error).message, { tone: 'error' })
    }
  }

  const ui = (
    <>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void onPhotos(files)
        }}
      />
      <input
        ref={gpxInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void onGpx(file)
        }}
      />

      <Dialog
        open={adding !== null}
        onClose={() => adding?.phase === 'done' && setAdding(null)}
        title="加入照片"
        actions={adding?.phase === 'done' && <Button variant="dark" onClick={() => setAdding(null)}>好</Button>}
      >
        {adding?.phase === 'working' && (
          <ProgressBar value={adding.done} max={adding.total} label={`正在整理照片 ${adding.done} / ${adding.total}`} />
        )}
        {adding?.phase === 'done' && <AddResult {...adding} />}
      </Dialog>

      <ConfirmDialog
        open={gpx !== null}
        busy={gpxBusy}
        title="換成新的 GPX？"
        message="原本的路線會被這個檔案取代，照片會依新的路線重新排列位置。"
        confirmLabel="換上新路線"
        onConfirm={() => gpx && void writeTrack(gpx.points)}
        onCancel={() => setGpx(null)}
      />

      <Dialog
        open={exporting !== null}
        onClose={() => exporting?.phase !== 'working' && setExporting(null)}
        title="匯出這篇回憶"
        actions={
          exporting?.phase === 'ready' ? (
            <>
              <Button variant="ghost" onClick={() => setExporting(null)}>
                取消
              </Button>
              <Button variant="dark" icon={'share' in navigator ? <ShareIcon size={20} /> : <DownloadIcon size={20} />} onClick={() => void deliver(exporting.file)}>
                儲存匯出檔
              </Button>
            </>
          ) : (
            exporting?.phase === 'error' && (
              <Button variant="dark" onClick={() => setExporting(null)}>
                好
              </Button>
            )
          )
        }
      >
        {exporting?.phase === 'working' && (
          <span className={s.working}>
            <Spinner label="打包中" />
            正在把路線、照片和日記打包成一個檔案…
          </span>
        )}
        {exporting?.phase === 'ready' && (
          <>
            檔案準備好了：{exporting.file.name}（{sizeLabel(exporting.file.size)}）。存在手機的「檔案」或雲端硬碟，換手機時可以再匯入。
          </>
        )}
        {exporting?.phase === 'error' && exporting.message}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        danger
        busy={deleting === 'busy'}
        title="刪除這篇回憶？"
        message={`「${short(trip.title, 60)}」的路線、${trip.photoCount} 張照片和日記都會從這台裝置刪除，無法復原。需要的話，請先匯出備份。`}
        confirmLabel="刪除回憶"
        onConfirm={() => void removeTrip()}
        onCancel={() => setDeleting(null)}
      />
    </>
  )

  return {
    pickPhotos: () => photoInput.current?.click(),
    pickGpx: () => gpxInput.current?.click(),
    startExport: () => void startExport(),
    askDelete: () => setDeleting('ask'),
    ui,
  }
}

function AddResult({ added, duplicates, failed }: { added: number; duplicates: number; failed: PhotoImportFailure[] }) {
  return (
    <div className={s.addResult}>
      <p>{added > 0 ? `加入了 ${added} 張照片。` : '這次沒有加入新的照片。'}</p>
      {duplicates > 0 && <p>{duplicates} 張已經在這篇回憶裡，沒有重複加入。</p>}
      {failed.length > 0 && (
        <>
          <p>{failed.length} 張沒有加入：</p>
          <ul>
            {failed.map((f, i) => (
              <li key={i}>
                {f.fileName && <strong>{f.fileName}</strong>}
                {f.fileName && '：'}
                {f.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
