import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getKey, setKey, validateKey } from '../../key'
import { navigate } from '../../router'
import type { KeyCheck } from '../../types'
import { AlertIcon, BackIcon, Button, CheckIcon, ExternalIcon, IconButton, LockIcon, Ridge, Screen, TextField } from '../../ui'
import s from './welcome.module.css'

const SIGN_UP_URL = 'https://manage.thunderforest.com/users/sign_up?price=hobby-project'
const STEP_STORAGE = 'welcome-step'
const TOTAL = 4

type Step = 1 | 2 | 3 | 4
type Check = 'idle' | 'checking' | KeyCheck

function readStep(): Step {
  try {
    const n = Number(localStorage.getItem(STEP_STORAGE))
    return n === 2 || n === 3 ? n : 1
  } catch {
    return 1
  }
}

function saveStep(step: Step | null) {
  try {
    if (step === null || step === 4) localStorage.removeItem(STEP_STORAGE)
    else localStorage.setItem(STEP_STORAGE, String(step))
  } catch {}
}

function PrivacyNote() {
  return (
    <div className={s.note}>
      <LockIcon size={20} />
      <p>鑰匙只會留在你這台手機裡，不會傳給任何人。只有載入地圖時，會由這台手機直接交給 Thunderforest。</p>
    </div>
  )
}

function DashboardFigure() {
  return (
    <figure className={s.figure}>
      <svg
        role="img"
        aria-label="示意圖：登入後的 Dashboard 頁面上，有一欄寫著 API Key，旁邊是一長串英文字母和數字，後面有複製的地方"
        viewBox="0 0 342 168"
      >
        <rect width="342" height="168" fill="var(--color-card)" />
        <rect width="342" height="30" fill="var(--color-moss)" />
        <circle cx="16" cy="15" r="4" fill="var(--color-dot)" />
        <circle cx="30" cy="15" r="4" fill="var(--color-dot)" />
        <circle cx="44" cy="15" r="4" fill="var(--color-dot)" />
        <rect x="72" y="8" width="150" height="14" rx="7" fill="var(--color-card)" />
        <text x="147" y="19" textAnchor="middle" fontSize="9" fill="var(--color-ink-muted)" fontFamily="var(--font-body)">
          Dashboard
        </text>
        <rect x="20" y="46" width="110" height="10" rx="5" fill="var(--color-moss-strong)" />
        <rect x="20" y="64" width="70" height="8" rx="4" fill="var(--color-moss)" />
        <rect x="20" y="84" width="302" height="62" rx="14" fill="var(--color-sun-soft)" stroke="var(--color-accent)" strokeWidth="2.5" />
        <text x="36" y="106" fontSize="12" fontWeight="700" fill="var(--color-ink)" fontFamily="var(--font-body)">
          API Key
        </text>
        <rect x="36" y="116" width="226" height="20" rx="10" fill="var(--color-white)" />
        <text x="48" y="130" fontSize="11" letterSpacing="2" fill="var(--color-ink-muted)" fontFamily="var(--font-body)">
          a1b2c3d4e5f6••••••••••••
        </text>
        <rect x="272" y="116" width="40" height="20" rx="10" fill="var(--color-accent)" />
        <path d="M285 126l4 4 8-8" fill="none" stroke="var(--color-white)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <figcaption>示意圖，實際畫面的排版可能不同。</figcaption>
    </figure>
  )
}

function Status({ check }: { check: Check }) {
  let content: ReactNode = null
  let tone = ''

  if (check === 'checking') content = '正在檢查這把鑰匙…'
  else if (check === 'valid') {
    tone = s.ok!
    content = (
      <>
        <CheckIcon size={20} />
        <span>鑰匙可以用了！</span>
      </>
    )
  } else if (check === 'invalid') {
    tone = s.bad!
    content = (
      <>
        <AlertIcon size={20} />
        <span>
          這把鑰匙不能用。請檢查：整串都複製了嗎？前後有沒有多複製到其他字？複製的是不是 API Key，而不是密碼。
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

export function WelcomeScreen() {
  const [hadKey] = useState(() => getKey() !== null)
  const [step, setStep] = useState<Step>(readStep)
  const [value, setValue] = useState('')
  const [check, setCheck] = useState<Check>('idle')
  const [canPaste] = useState(() => typeof navigator.clipboard?.readText === 'function')
  const heading = useRef<HTMLHeadingElement>(null)
  const input = useRef<HTMLDivElement>(null)
  const run = useRef(0)
  const mounted = useRef(false)

  useEffect(() => {
    if (hadKey) navigate({ name: 'home' }, { replace: true })
  }, [hadKey])

  useEffect(() => {
    if (mounted.current) heading.current?.focus()
    mounted.current = true
  }, [step])

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

  useEffect(() => {
    if (step !== 3) return

    const vv = window.visualViewport
    const reveal = () => {
      if (input.current?.contains(document.activeElement)) input.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    vv?.addEventListener('resize', reveal)
    return () => vv?.removeEventListener('resize', reveal)
  }, [step])

  if (hadKey) return null

  const go = (next: Step) => {
    saveStep(next)
    setStep(next)
  }

  const retry = () => {
    const id = ++run.current
    setCheck('checking')
    validateKey(value).then((result) => {
      if (id === run.current) setCheck(result)
    })
  }

  const paste = async () => {
    try {
      setValue(await navigator.clipboard.readText())
    } catch {}
  }

  const finish = () => {
    setKey(value)
    saveStep(null)
    setStep(4)
  }

  const progress = (
    <div className={s.top}>
      {(step === 2 || step === 3) && (
        <BackButton onClick={() => go((step - 1) as Step)} />
      )}
      <div className={s.progress} role="img" aria-label={`第 ${step} 步，共 ${TOTAL} 步`}>
        {Array.from({ length: TOTAL }, (_, i) => (
          <div key={i} className={`${s.seg} ${i < step ? s.segOn : ''}`} />
        ))}
      </div>
      <div className={s.stepLabel} aria-hidden="true">
        第 {step} 步，共 {TOTAL} 步
      </div>
    </div>
  )

  if (step === 1) {
    return (
      <Screen
        bottom={
          <div className={s.actions} style={{ width: '100%', paddingTop: 0 }}>
            <Button block onClick={() => go(2)}>
              開始領取
            </Button>
            <Button variant="ghost" block onClick={() => go(3)}>
              我已經有鑰匙了
            </Button>
          </div>
        }
      >
        {progress}
        <Ridge variant="banner" />
        <div className={s.titles}>
          <h1 className={s.title} ref={heading} tabIndex={-1}>
            地圖要用一把
            <br />
            小鑰匙打開
          </h1>
          <p className={s.body}>
            登山地圖由 Thunderforest 提供。每個人都用自己的免費額度，所以要先去領一把自己的地圖鑰匙，也就是 API Key。
          </p>
          <p className={s.body}>只需要領一次，而且免費。個人看地圖用，免費額度通常很夠。</p>
        </div>
        <PrivacyNote />
      </Screen>
    )
  }

  if (step === 2) {
    return (
      <Screen
        bottom={
          <div className={s.actions} style={{ width: '100%', paddingTop: 0 }}>
            <Button block href={SIGN_UP_URL} target="_blank" iconEnd={<ExternalIcon size={18} />} onClick={() => saveStep(3)}>
              開啟註冊頁
            </Button>
            <Button variant="ghost" block onClick={() => go(3)}>
              我已經有鑰匙了
            </Button>
          </div>
        }
      >
        {progress}
        <h1 className={s.title} ref={heading} tabIndex={-1}>
          先去領一把
          <br />
          地圖的鑰匙
        </h1>
        <ol className={s.steps}>
          <li>
            <span className={s.num} aria-hidden="true">
              1
            </span>
            <span>
              按下面的按鈕，會在新分頁開啟 Thunderforest 的免費方案（Hobby Project）註冊頁。填上名字、電子郵件和密碼，組織可以不填，再按 Create Account。
            </span>
          </li>
          <li>
            <span className={s.num} aria-hidden="true">
              2
            </span>
            <span>如果收到確認信，先照信裡的指示確認電子郵件。登入後，在 Dashboard 頁面找到「API Key」，按複製。</span>
          </li>
          <li>
            <span className={s.num} aria-hidden="true">
              3
            </span>
            <span>回到這裡，下一步把它貼上。</span>
          </li>
        </ol>
        <DashboardFigure />
        <PrivacyNote />
      </Screen>
    )
  }

  if (step === 3) {
    return (
      <Screen>
        {progress}
        <div className={s.titles}>
          <h1 className={s.title} ref={heading} tabIndex={-1}>
            把鑰匙貼上來
          </h1>
          <p className={s.body}>貼上剛剛複製的 API Key，我們會立刻確認它能不能用。</p>
        </div>

        <div ref={input} className={s.titles}>
          <TextField
            label="地圖鑰匙（API Key）"
            value={value}
            onChange={setValue}
            placeholder="一長串英文字母和數字"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)}
          />
          <div className={s.tools}>
            {canPaste && (
              <Button variant="dark" onClick={paste}>
                貼上
              </Button>
            )}
            {check === 'network-error' && (
              <Button variant="ghost" inline onClick={retry}>
                再試一次
              </Button>
            )}
          </div>
          <Status check={check} />
        </div>

        <PrivacyNote />
        <a className={s.link} href={SIGN_UP_URL} target="_blank" rel="noopener noreferrer">
          還沒有鑰匙？開啟註冊頁
        </a>

        <div className={s.actions}>
          <Button block disabled={check !== 'valid'} onClick={finish}>
            下一步
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen
      bottom={
        <div className={s.actions} style={{ width: '100%', paddingTop: 0 }}>
          <Button block onClick={() => navigate({ name: 'home' }, { replace: true })}>
            進入 App
          </Button>
        </div>
      }
    >
      {progress}
      <Ridge variant="banner" />
      <div className={s.titles}>
        <h1 className={s.title} ref={heading} tabIndex={-1}>
          都準備好了
        </h1>
        <p className={s.body}>地圖的鑰匙已經收好。接下來放進你的登山照片，就能把這一趟變成一本日誌。</p>
      </div>
      <PrivacyNote />
    </Screen>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="上一步" variant="moss" onClick={onClick}>
      <BackIcon />
    </IconButton>
  )
}
