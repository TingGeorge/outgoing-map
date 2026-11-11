import { href } from '../../router'
import {
  Button,
  Card,
  Chip,
  IconButton,
  PlusIcon,
  Polaroid,
  Ridge,
  Screen,
  SectionTitle,
  SettingsIcon,
  formatDate,
} from '../../ui'
import s from './home.module.css'

const sample = Date.UTC(2026, 10, 8, 1, 42)

function SampleScene() {
  return (
    <svg role="img" aria-label="示意照片" viewBox="0 0 140 104" preserveAspectRatio="xMidYMid slice">
      <rect width="140" height="104" fill="#D5E3EA" />
      <path d="M0 70 L34 38 L58 60 L88 26 L140 74 L140 104 L0 104 Z" fill="#9DB7A0" />
      <path d="M88 26 L98 36 L90 40 L82 34 Z" fill="#FBFBF4" />
      <path d="M0 84 Q70 66 140 88 L140 104 L0 104 Z" fill="#7C9A7A" />
    </svg>
  )
}

export function HomeScreen() {
  return (
    <Screen
      bottom={
        <Button href={href({ name: 'new' })} icon={<PlusIcon size={20} />}>
          新的回憶
        </Button>
      }
    >
      <Ridge />

      <header className={s.header}>
        <div className={s.titles}>
          <div className={s.date}>{formatDate(Date.now())}</div>
          <h1 className={s.title}>
            今天想回味
            <br />
            哪一座山？
          </h1>
        </div>
        <IconButton label="設定" href={href({ name: 'settings' })}>
          <SettingsIcon />
        </IconButton>
      </header>

      <Card href={href({ name: 'trip', id: 'sample' })} radius="lg" elevated className={s.recent}>
        <div className={s.cover}>
          <SampleScene />
          <span className={s.badge}>
            <Chip tone="paper">最近一趟</Chip>
          </span>
        </div>
        <div className={s.recentBody}>
          <div className={s.recentTitleRow}>
            <h2 className={s.recentTitle}>合歡北峰</h2>
            <span className={s.muted}>{formatDate(sample)}</span>
          </div>
          <div className={s.chips}>
            <Chip>4.2 公里</Chip>
            <Chip>爬升 438 公尺</Chip>
            <Chip tone="sun">12 張照片</Chip>
          </div>
        </div>
      </Card>

      <section className={s.earlier}>
        <SectionTitle>更早的回憶</SectionTitle>
        <div className={s.polaroids}>
          <Polaroid alt="示意照片" size="sm" tilt={-2.5} caption="雪山主東" meta="10 月 3 日　兩天">
            <SampleScene />
          </Polaroid>
          <Polaroid alt="示意照片" size="sm" tilt={2} caption="抹茶山" meta="9 月 14 日　半天">
            <SampleScene />
          </Polaroid>
        </div>
      </section>
    </Screen>
  )
}
