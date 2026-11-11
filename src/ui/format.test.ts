import { expect, test } from 'vitest'
import { formatDate, formatDuration, formatKm, formatTime } from './format'

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
