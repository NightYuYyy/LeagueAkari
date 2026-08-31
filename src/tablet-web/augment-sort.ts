import type { TabletCompanionMayhemAugment } from '@shared/shards/tablet-companion'

export type TabletAugmentSort = 'tier' | 'performance' | 'popularity'

export function sortTabletAugments(items: TabletCompanionMayhemAugment[], sort: TabletAugmentSort) {
  return items.toSorted((left, right) => {
    if (sort === 'performance') {
      if (left.popularity === 0 && right.popularity !== 0) return 1
      if (left.popularity !== 0 && right.popularity === 0) return -1
      return (right.performanceScore ?? 0) - (left.performanceScore ?? 0)
    }
    if (sort === 'popularity') {
      return (right.popularity ?? 0) - (left.popularity ?? 0)
    }
    // Array#toSorted 是稳定排序，同层级保持 OP.GG 原始推荐顺序。
    return (left.tier ?? Number.POSITIVE_INFINITY) - (right.tier ?? Number.POSITIVE_INFINITY)
  })
}
