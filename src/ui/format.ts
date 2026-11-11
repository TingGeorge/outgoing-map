export const DISPLAY_TIME_ZONE = 'Asia/Taipei'

const dateParts = new Intl.DateTimeFormat('zh-TW', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
})

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatDate(ms: number, withYear = false): string {
  const part = (type: string) => dateParts.formatToParts(ms).find((p) => p.type === type)?.value ?? ''
  const day = `${part('month')} 月 ${part('day')} 日　${part('weekday')}`
  return withYear ? `${part('year')} 年 ${day}` : day
}

export function formatDateRange(startMs: number | null, endMs: number | null, withYear = false): string {
  if (startMs === null || endMs === null || endMs < startMs) {
    const only = startMs ?? endMs
    return only === null ? '' : formatDate(only, withYear)
  }

  const parts = (ms: number) => {
    const all = dateParts.formatToParts(ms)
    const part = (type: string) => all.find((p) => p.type === type)?.value ?? ''
    return { year: part('year'), month: part('month'), day: part('day'), weekday: part('weekday') }
  }

  const a = parts(startMs)
  const b = parts(endMs)
  const start = formatDate(startMs, withYear || a.year !== b.year)

  if (a.year !== b.year) return `${start} – ${formatDate(endMs, true)}`
  if (a.month !== b.month) return `${start} – ${formatDate(endMs)}`
  if (a.day !== b.day) return `${start} – ${b.day} 日　${b.weekday}`
  return start
}

export function formatTime(ms: number): string {
  return clock.format(ms)
}

export function formatKm(metres: number): string {
  return (metres / 1000).toFixed(metres < 10_000 ? 1 : 0)
}

export function formatMetres(metres: number): string {
  return String(Math.round(metres))
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
