import { describe, expect, it } from 'vitest'
import { INTRO_S, OUTRO_S, videoBitrate, videoFileName, videoSeconds, videoSize } from './video'

describe('videoSize', () => {
  it('keeps a phone canvas as it is, rounded to even pixels', () => {
    expect(videoSize(780, 1688)).toEqual({ width: 780, height: 1688 })
    expect(videoSize(781, 1689)).toEqual({ width: 780, height: 1688 })
  })

  it('fits a large canvas inside 1920 by 1080 and keeps the shape', () => {
    const { width, height } = videoSize(2880, 1800)
    expect(width).toBeLessThanOrEqual(1920)
    expect(height).toBeLessThanOrEqual(1080)
    expect(width % 2).toBe(0)
    expect(height % 2).toBe(0)
    expect(width / height).toBeCloseTo(2880 / 1800, 2)
  })

  it('fits a tall canvas inside 1080 by 1920', () => {
    const { width, height } = videoSize(1290, 2796)
    expect(width).toBeLessThanOrEqual(1080)
    expect(height).toBeLessThanOrEqual(1920)
    expect(height / width).toBeCloseTo(2796 / 1290, 2)
  })

  it('never returns an empty size', () => {
    expect(videoSize(0, 0)).toEqual({ width: 2, height: 2 })
  })
})

describe('videoBitrate', () => {
  it('stays between 2.5 and 6 Mbps', () => {
    expect(videoBitrate(320, 240)).toBe(2_500_000)
    expect(videoBitrate(1920, 1080)).toBeLessThanOrEqual(6_000_000)
    expect(videoBitrate(1920, 1080)).toBeGreaterThan(2_500_000)
  })
})

describe('videoFileName', () => {
  it('names the file after the trip and its day, without characters a file system rejects', () => {
    expect(videoFileName('合歡北峰', Date.UTC(2026, 10, 6, 23), 'mp4')).toBe('合歡北峰-2026-11-07-立體播放.mp4')
    expect(videoFileName('a/b:c*?', Date.UTC(2026, 0, 1, 4), 'webm')).toBe('a-b-c---2026-01-01-立體播放.webm')
  })

  it('cuts a very long title', () => {
    expect(videoFileName('山'.repeat(200), 0, 'mp4').startsWith('山'.repeat(80) + '-')).toBe(true)
  })
})

describe('videoSeconds', () => {
  it('adds the intro and outro to the flight played at the chosen speed', () => {
    expect(videoSeconds(80, 1)).toBe(INTRO_S + 80 + OUTRO_S)
    expect(videoSeconds(80, 4)).toBe(INTRO_S + 20 + OUTRO_S)
  })
})
