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
