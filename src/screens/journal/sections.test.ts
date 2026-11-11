import { expect, test } from 'vitest'
import { buildRoute } from '../../core'
import type { TrackPoint } from '../../types'
import { routeSections } from './sections'

const at = (northM: number, eastM: number, time: number): TrackPoint => ({ lat: 24 + northM / 111_195, lon: 121 + eastM / 101_580, ele: 2000, time })

test('walk, recorded drive, walk gives exactly two sections', () => {
  const walk1 = Array.from({ length: 31 }, (_, i) => at(i * 33.3, 0, i * 30_000))
  const drive = Array.from({ length: 19 }, (_, k) => at(1000, (k + 1) * 242, 900_000 + (k + 1) * 30_000))
  const walk2 = Array.from({ length: 31 }, (_, i) => at(1000 - i * 33.3, 4600 + i, 1_500_000 + i * 30_000))

  const sections = routeSections(buildRoute([...walk1, ...drive, ...walk2], []))

  expect(sections.map((s) => s.length)).toEqual([31, 32])
})
