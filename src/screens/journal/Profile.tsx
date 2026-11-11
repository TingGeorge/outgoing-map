import { useMemo, useState, type PointerEvent, type RefObject } from 'react'
import type { ElevationProfile } from '../../types'
import { formatKm, formatMetres } from '../../ui'
import type { Scrub } from './MapHero'
import s from './journal.module.css'

const W = 310
const H = 80
const TOP = 8
const BOTTOM = 6

interface Props {
  profile: ElevationProfile
  scrub: RefObject<Scrub | null>
  gaps: number[]
}

export function Profile({ profile, scrub, gaps }: Props) {
  const { samples, totalDistanceM, minEleM, maxEleM } = profile
  const [at, setAt] = useState<number | null>(null)

  const x = (d: number) => (totalDistanceM > 0 ? (d / totalDistanceM) * W : 0)
  const y = (e: number) => H - BOTTOM - ((e - minEleM) / (maxEleM - minEleM || 1)) * (H - TOP - BOTTOM)

  const { line, area } = useMemo(() => {
    const parts: { d: number; ele: number }[][] = [[]]

    samples.forEach((p, i) => {
      const prev = samples[i - 1]
      const cut = prev && gaps.some((g) => (prev.distanceM < g && g < p.distanceM) || (prev.distanceM === g && p.distanceM === g))

      if (cut) parts.push([])
      parts.at(-1)!.push({ d: p.distanceM, ele: p.ele })
    })

    const path = (part: typeof parts[number]) => part.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p.ele).toFixed(1)}`).join(' ')

    return {
      line: parts.map(path).join(' '),
      area: parts.map((part) => `${path(part)} L${x(part.at(-1)!.d).toFixed(1)} ${H} L${x(part[0]!.d).toFixed(1)} ${H} Z`).join(' '),
    }
  }, [profile, gaps])

  const top = samples.reduce((a, b) => (b.ele > a.ele ? b : a))
  const point = at === null ? null : nearest(samples, at)

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const d = Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1) * totalDistanceM
    setAt(d)
    scrub.current?.(d)
  }

  const end = () => {
    setAt(null)
    scrub.current?.(null)
  }

  return (
    <section className={s.profile} aria-labelledby="journal-profile">
      <div className={s.profileHead}>
        <h2 id="journal-profile">海拔變化</h2>
        <span aria-hidden={point !== null}>
          {point ? `${formatKm(point.distanceM)} 公里・${formatMetres(point.ele)} 公尺` : `最高 ${formatMetres(maxEleM)} 公尺`}
        </span>
      </div>
      <div className={s.chartWrap}>
        <svg
          className={s.profileChart}
          role="img"
          aria-label={`海拔剖面：最低 ${formatMetres(minEleM)} 公尺，最高 ${formatMetres(maxEleM)} 公尺，全長 ${formatKm(totalDistanceM)} 公里`}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onPointerDown={move}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        >
          <path d={area} fill="var(--color-ridge-far)" />
          <path d={line} fill="none" stroke="var(--color-leaf)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {gaps.map((g, i) => (
            <line key={i} x1={x(g)} x2={x(g)} y1={TOP} y2={H} stroke="var(--color-ink-muted)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" vectorEffect="non-scaling-stroke" />
          ))}
          {point && <line x1={x(point.distanceM)} x2={x(point.distanceM)} y1={0} y2={H} stroke="var(--color-ink-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className={s.profileDot} style={{ left: `${(x(top.distanceM) / W) * 100}%`, top: `${(y(top.ele) / H) * 100}%` }} aria-hidden="true" />
        {point && <span className={s.profileScrub} style={{ left: `${(x(point.distanceM) / W) * 100}%`, top: `${(y(point.ele) / H) * 100}%` }} aria-hidden="true" />}
      </div>
    </section>
  )
}

function nearest<T extends { distanceM: number }>(samples: T[], d: number): T {
  return samples.reduce((a, b) => (Math.abs(b.distanceM - d) < Math.abs(a.distanceM - d) ? b : a))
}
