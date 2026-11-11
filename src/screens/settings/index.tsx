import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clearKey, getKey, setKey, validateKey } from '../../key'
import { isStandalone, requestPersistentStorage } from '../../pwa'
import { goBack, href, navigate } from '../../router'
import { listTrips, importTrip } from '../../storage'
import type { KeyCheck } from '../../types'
import {
  AlertIcon,
  BackIcon,
  Button,
  Card,
  CheckIcon,
  ConfirmDialog,
  Dialog,
  ExternalIcon,
  FilePicker,
  IconButton,
  LockIcon,
  Notice,
  Screen,
  SectionTitle,
  ShareIcon,
  Spinner,
  TextField,
  UploadIcon,
  toast,
} from '../../ui'
import s from './settings.module.css'

type Check = 'idle' | 'checking' | KeyCheck


function mask(key: string): string {
  if (key.length < 16) return '•'.repeat(12)

  return `${key.slice(0, 4)}${'•'.repeat(12)}${key.slice(-4)}`
}

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)

  return mb < 0.1 ? '不到 0.1 MB' : `約 ${mb.toLocaleString('en-US', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`
}

function Privacy() {
  return (
    <div className={s.note}>
      <LockIcon size={20} />
      <p>鑰匙只會留在你這台手機裡，不會傳給任何人。只有載入地圖時，會由這台手機直接交給 Thunderforest。</p>
    </div>
  )
}

function Status({ check, stored = false }: { check: Check; stored?: boolean }) {
  let content: ReactNode = null
  let tone = ''

  if (check === 'checking') content = '正在檢查這把鑰匙…'
  else if (check === 'valid') {
    tone = s.ok!
    content = (
      <>
        <CheckIcon size={20} />
        <span>{stored ? '這把鑰匙目前可以用。' : '鑰匙可以用了！'}</span>
      </>
    )
  } else if (check === 'invalid') {
    tone = s.bad!
    content = (
      <>
        <AlertIcon size={20} />
        <span>
          {stored
            ? '這把鑰匙現在不能用。可能是當初貼錯了、鑰匙已被停用，或是這個月的免費額度用完了；額度每個月會重新計算。可以換一把鑰匙，或下個月再試。'
            : '這把鑰匙不能用。請檢查：整串都複製了嗎？前後有沒有多複製到其他字？複製的是不是 API Key，而不是密碼。'}
        </span>
      </>
    )
  } else if (check === 'network-error') {
    tone = s.bad!
    content = (
      <>
        <AlertIcon size={20} />
        <span>現在連不上 Thunderforest，沒辦法確認鑰匙。請檢查網路，稍後再試一次。</span>
      </>
    )
  }

  return (
    <div className={`${s.status} ${tone}`} role="status" aria-live="polite">
      {content}
    </div>
  )
}

function ChangeKeyDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (key: string) => void }) {
  const [value, setValue] = useState('')
  const [check, setCheck] = useState<Check>('idle')
  const run = useRef(0)

  useEffect(() => {
    if (open) {
      setValue('')
      setCheck('idle')
    }
  }, [open])

  useEffect(() => {
    const id = ++run.current
    const trimmed = value.trim()

    if (trimmed.length < 8) {
      setCheck('idle')
      return
    }

    setCheck('checking')
    const timer = setTimeout(() => {
      validateKey(trimmed).then((result) => {
        if (id === run.current) setCheck(result)
      })
    }, 500)

    return () => clearTimeout(timer)
  }, [value])

  const retry = () => {
    const id = ++run.current
    setCheck('checking')
    validateKey(value).then((result) => {
      if (id === run.current) setCheck(result)
    })
  }

  const save = () => {
    setKey(value)
    onSaved(value.trim())
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="更換地圖鑰匙"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={check !== 'valid'} onClick={save}>
            儲存新鑰匙
          </Button>
        </>
      }
    >
      <div className={s.section}>
        <TextField
          label="新的地圖鑰匙（API Key）"
          value={value}
          onChange={setValue}
          placeholder="一長串英文字母和數字"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
        />
        {check === 'network-error' && (
          <div className={s.actions}>
            <Button variant="ghost" inline onClick={retry}>
              再試一次
            </Button>
          </div>
        )}
        <Status check={check} />
        <p className={s.small}>檢查通過才會換掉；取消的話，原來的鑰匙會繼續用。</p>
      </div>
    </Dialog>
  )
}

function KeySection() {
  const [stored, setStored] = useState(getKey)
  const [cleared, setCleared] = useState(false)
  const [check, setCheck] = useState<Check>('idle')
  const [changing, setChanging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const run = useRef(0)

  const verify = () => {
    if (!stored) return

    const id = ++run.current
    setCheck('checking')
    validateKey(stored).then((result) => {
      if (id === run.current) setCheck(result)
    })
  }

  const clear = () => {
    run.current++
    clearKey()
    setStored(null)
    setCleared(true)
    setCheck('idle')
    setConfirming(false)
  }

  return (
    <section className={s.section} aria-label="地圖鑰匙">
      <SectionTitle>地圖鑰匙</SectionTitle>

      <Card radius="md">
        <div className={s.body}>
          {stored ? (
            <>
              <p className={s.text}>目前已經收好一把鑰匙，地圖可以正常載入。</p>
              <div className={s.masked} aria-label="已儲存的鑰匙（只顯示前四碼和後四碼）">
                {mask(stored)}
              </div>

              <div className={s.actions}>
                <Button variant="dark" onClick={() => setChanging(true)}>
                  更換鑰匙
                </Button>
                <Button variant="ghost" inline disabled={check === 'checking'} onClick={verify}>
                  檢查鑰匙
                </Button>
                <Button variant="ghost" inline onClick={() => setConfirming(true)}>
                  清除鑰匙
                </Button>
              </div>

              <Status check={check} stored />
            </>
          ) : (
            <Notice
              tone="warning"
              title={cleared ? '鑰匙已清除' : '還沒有地圖鑰匙'}
              action={
                <Button href={href({ name: 'welcome' })}>{cleared ? '重新設定' : '開始設定鑰匙'}</Button>
              }
            >
              沒有鑰匙時，地圖不會載入，直到你重新輸入一把鑰匙。
            </Notice>
          )}

          <Privacy />
        </div>
      </Card>

      <ChangeKeyDialog
        open={changing}
        onClose={() => setChanging(false)}
        onSaved={(key) => {
          setStored(key)
          setCleared(false)
          setCheck('idle')
          setChanging(false)
          toast('已換成新的鑰匙', { tone: 'success' })
        }}
      />

      <ConfirmDialog
        open={confirming}
        danger
        title="清除這把鑰匙？"
        message="清除後，這台手機上的地圖就不會載入，直到你再輸入一把鑰匙。你的回憶和照片不受影響。"
        confirmLabel="清除鑰匙"
        onConfirm={clear}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}

function DataSection() {
  const [count, setCount] = useState<number | null>(null)
  const [usage, setUsage] = useState<number | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [asked, setAsked] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    listTrips()
      .then((trips) => setCount(trips.length))
      .catch(() => {})
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage ?? null)).catch(() => {})
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {})
  }, [])

  const protect = async () => {
    setPersisted(await requestPersistentStorage())
    setAsked(true)
  }

  const run = async (files: File[]) => {
    const file = files[0]
    if (!file || busy.current) return

    busy.current = true
    setImporting(true)
    setError(null)

    try {
      const trip = await importTrip(file)

      toast('回憶已匯入', { tone: 'success' })
      navigate({ name: 'trip', id: trip.id }, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '匯入失敗，請再試一次')
    } finally {
      busy.current = false
      setImporting(false)
    }
  }

  return (
    <section className={s.section} aria-label="回憶資料">
      <SectionTitle>回憶資料</SectionTitle>

      <Card radius="md">
        <div className={s.body}>
          <p className={s.text}>
            回憶和照片只存在這台裝置的瀏覽器裡，不會上傳。換手機或清除瀏覽器資料前，請先到每篇回憶的選單匯出備份。
          </p>

          <dl className={s.facts}>
            <div className={s.fact}>
              <dt>回憶數量</dt>
              <dd>{count === null ? '—' : `${count} 篇`}</dd>
            </div>
            <div className={s.fact}>
              <dt>已使用空間</dt>
              <dd>{usage === null ? '—' : megabytes(usage)}</dd>
            </div>
            <div className={s.fact}>
              <dt>資料保護</dt>
              <dd>{persisted === null ? '—' : persisted ? '已受保護' : '尚未保護'}</dd>
            </div>
          </dl>

          {persisted === false && (
            <>
              <p className={s.small}>尚未保護時，手機空間不足，瀏覽器可能會自己清掉這些資料。</p>
              <div className={s.actions}>
                <Button variant="dark" onClick={protect}>
                  要求保護資料
                </Button>
              </div>
            </>
          )}

          <div className={s.status} role="status" aria-live="polite">
            {asked && (
              <p className={s.small}>
                {persisted
                  ? '瀏覽器答應了，資料現在受到保護。'
                  : '瀏覽器這次沒有答應，它有權決定。把這個 App 加到主畫面後再試一次，通常比較容易通過。'}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card radius="md">
        <div className={s.body}>
          <p className={s.text}>
            把從登山回憶匯出的檔案（.hiking.zip）選進來，就能還原那篇回憶，包含照片和路線。
          </p>

          <div className={s.actions}>
            <FilePicker variant="dark" icon={<UploadIcon size={20} />} disabled={importing} onFiles={run}>
              匯入回憶
            </FilePicker>
          </div>

          <div className={s.status} role="status" aria-live="polite">
            {importing && (
              <span className={s.status}>
                <Spinner label="正在匯入回憶" />
                <span aria-hidden="true">正在匯入，照片多的話要等一下…</span>
              </span>
            )}
          </div>

          {error && (
            <Notice tone="error" title="這個檔案沒辦法匯入">
              {error}
            </Notice>
          )}
        </div>
      </Card>
    </section>
  )
}

function InstallSection() {
  const standalone = isStandalone()

  return (
    <section className={s.section} aria-label="加入主畫面">
      <SectionTitle>加入主畫面</SectionTitle>

      <Card radius="md">
        <div className={s.body}>
          {standalone ? (
            <p className={s.text}>你已經是從主畫面開啟的了，全螢幕使用，資料也比較不會被瀏覽器清掉。</p>
          ) : (
            <>
              <p className={s.text}>加到主畫面後，像 App 一樣全螢幕開啟，資料也比較不會被瀏覽器清掉。</p>
              <ul className={s.howto}>
                <li>
                  <strong>iPhone（Safari）</strong>
                  <br />
                  點下方工具列的 <span className={s.share}><ShareIcon size={20} /></span> 分享，再選「加入主畫面」。
                </li>
                <li>
                  <strong>Android（Chrome）</strong>
                  <br />
                  點右上角的選單，選「安裝應用程式」或「加到主畫面」。
                </li>
                <li>
                  <strong>電腦（Chrome、Edge）</strong>
                  <br />
                  點網址列右側的安裝圖示。
                </li>
              </ul>
            </>
          )}
        </div>
      </Card>
    </section>
  )
}

function Credit({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return (
    <li>
      <a className={s.link} href={href} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalIcon size={16} />
      </a>
      <span className={s.small}>{children}</span>
    </li>
  )
}

function AboutSection() {
  return (
    <section className={s.section} aria-label="關於">
      <SectionTitle>關於</SectionTitle>

      <Card radius="md">
        <div className={s.body}>
          <p className={s.appName}>登山回憶</p>
          <p className={s.text}>把登山的照片和路線，整理成一本可以翻閱、也能立體重播的日誌。</p>

          <ul className={s.credits}>
            <Credit href="https://www.thunderforest.com/" label="Thunderforest">
              平面地圖
            </Credit>
            <Credit href="https://www.openstreetmap.org/copyright" label="OpenStreetMap contributors">
              平面地圖資料
            </Credit>
            <Credit href="https://maps.nlsc.gov.tw/" label="內政部國土測繪中心">
              空照影像
            </Credit>
            <Credit href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" label="Mapzen、USGS、NOAA">
              地形資料（SRTM、GMTED2010、ETOPO1）
            </Credit>
            <Credit href="https://rudymap.tw" label="魯地圖（Rudy Chung）">
              景點資料 © OpenStreetMap contributors（ODbL），整理自魯地圖
            </Credit>
          </ul>

          <p className={s.small}>程式碼採 MIT 授權。地圖圖磚與影像屬於各自的提供者，不在此授權範圍內。</p>

          <div className={s.actions}>
            <Button variant="ghost" inline href="https://github.com/TingGeorge/outgoing-map" target="_blank" iconEnd={<ExternalIcon size={18} />}>
              原始碼
            </Button>
          </div>
        </div>
      </Card>
    </section>
  )
}

export function SettingsScreen() {
  const [hasKey] = useState(() => getKey() !== null)

  return (
    <Screen>
      <div className={s.top}>
        <IconButton
          label={hasKey ? '回首頁' : '回鑰匙教學'}
          variant="moss"
          onClick={() => goBack({ name: hasKey ? 'home' : 'welcome' })}
        >
          <BackIcon />
        </IconButton>
        <h1 className={s.heading}>設定</h1>
      </div>

      <KeySection />
      <DataSection />
      <InstallSection />
      <AboutSection />
      <div className={s.toastRoom} aria-hidden />
    </Screen>
  )
}
