import type { TabletCompanionMayhemAugment } from '@shared/shards/tablet-companion'
import { describe, expect, it } from 'vitest'

import { sortTabletAugments } from './augment-sort'

function augment(
  augmentId: number,
  tier: number,
  performanceScore: number,
  popularity: number
): TabletCompanionMayhemAugment {
  return {
    augmentId,
    name: String(augmentId),
    description: '',
    iconUrl: null,
    rarity: 'gold',
    tier,
    performanceScore,
    popularity
  }
}

describe('sortTabletAugments', () => {
  const input = [augment(1133, 0, 1.2, 0.2), augment(2132, 0, 4.8, 0.1), augment(1030, 1, 3, 0)]

  it('keeps the OP.GG order for recommendations in the same tier', () => {
    expect(sortTabletAugments(input, 'tier').map((item) => item.augmentId)).toEqual([
      1133, 2132, 1030
    ])
  })

  it('sorts by performance while placing zero-popularity entries last', () => {
    expect(sortTabletAugments(input, 'performance').map((item) => item.augmentId)).toEqual([
      2132, 1133, 1030
    ])
  })

  it('sorts by popularity', () => {
    expect(sortTabletAugments(input, 'popularity').map((item) => item.augmentId)).toEqual([
      1133, 2132, 1030
    ])
  })
})
