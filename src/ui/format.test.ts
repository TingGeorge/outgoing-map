import { expect, test } from 'vitest'
import { formatDate, formatDateRange, formatDuration, formatKm, formatTime } from './format'

const summit = Date.UTC(2026, 10, 8, 1, 42)

test('formats dates and times in Taiwan time', () => {
  expect(formatDate(summit)).toBe('11 月 8 日　週日')
  expect(formatDate(summit, true)).toBe('2026 年 11 月 8 日　週日')
  expect(formatTime(summit)).toBe('09:42')
})

test('formats distance and duration', () => {
  expect(formatKm(4200)).toBe('4.2')
  expect(formatKm(12_600)).toBe('13')
  expect(formatDuration(250 * 60_000)).toBe('4:10')
})

test('formats date ranges in Taiwan time', () => {
  const hour = 3_600_000

  expect(formatDateRange(summit, summit + 3 * hour)).toBe('11 月 8 日　週日')
  expect(formatDateRange(Date.UTC(2026, 10, 7, 12), Date.UTC(2026, 10, 7, 17))).toBe('11 月 7 日　週六 – 8 日　週日')
  expect(formatDateRange(Date.UTC(2026, 10, 7, 12), Date.UTC(2026, 10, 7, 17), true)).toBe('2026 年 11 月 7 日　週六 – 8 日　週日')
  expect(formatDateRange(Date.UTC(2026, 10, 30, 2), Date.UTC(2026, 11, 1, 2))).toBe('11 月 30 日　週一 – 12 月 1 日　週二')
  expect(formatDateRange(Date.UTC(2026, 11, 31, 2), Date.UTC(2027, 0, 1, 2))).toBe('2026 年 12 月 31 日　週四 – 2027 年 1 月 1 日　週五')
  expect(formatDateRange(null, summit)).toBe('11 月 8 日　週日')
  expect(formatDateRange(summit, null)).toBe('11 月 8 日　週日')
  expect(formatDateRange(null, null)).toBe('')
})
