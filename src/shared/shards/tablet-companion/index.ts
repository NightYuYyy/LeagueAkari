import type {
  ChampionAbilityBuild,
  ChampionItemBuildSlot,
  ChampionRecommendationPerformance,
  ChampionRunePage,
  ChampionSummonerSpellRecommendation
} from '../../data-adapter/champion-data'

export const TABLET_COMPANION_MAIN_NAMESPACE = 'tablet-companion-main'
export const TABLET_COMPANION_RENDERER_NAMESPACE = 'tablet-companion-renderer'

export type TabletCompanionPublishStatus =
  'disabled' | 'misconfigured' | 'publishing' | 'connected' | 'error'

export interface TabletCompanionGameSnapshot {
  leagueClientConnected: boolean
  phase: string | null
  championId: number | null
  gameMode: string | null
  queueType: string | null
  assignedPosition: string | null
  isAramMayhem: boolean
  publishedAt: string
}

export interface TabletCompanionRoomState {
  roomCode: string
  publisherOnline: boolean
  receivedAt: string | null
  snapshot: TabletCompanionGameSnapshot | null
}

export interface TabletCompanionChampionCatalogItem {
  championId: number
  name: string
  title: string
  alias: string
  iconUrl: string
  keywords: string[]
}

export type TabletCompanionAugmentRarity = 'silver' | 'gold' | 'prismatic' | 'unknown'

export interface TabletCompanionMayhemAugment {
  augmentId: number
  name: string
  description: string
  iconUrl: string | null
  rarity: TabletCompanionAugmentRarity
  tier: number | null
  performanceScore: number | null
  popularity: number | null
}

export interface TabletCompanionDisplayAsset {
  id: number
  name: string
  description: string
  iconUrl: string | null
}

export interface TabletCompanionAramBuildData {
  patch: string | null
  updatedAt: string | null
  performance: ChampionRecommendationPerformance & {
    kda: number | null
    strengthTier: string | number | null
  }
  itemBuilds: ChampionItemBuildSlot[]
  summonerSpells: ChampionSummonerSpellRecommendation[]
  runePages: ChampionRunePage[]
  abilityBuilds: ChampionAbilityBuild[]
  resources: {
    items: Record<number, TabletCompanionDisplayAsset>
    perks: Record<number, TabletCompanionDisplayAsset>
    perkStyles: Record<number, TabletCompanionDisplayAsset>
    summonerSpells: Record<number, TabletCompanionDisplayAsset>
  }
}

export interface TabletCompanionMayhemChampionData {
  source: 'opgg'
  fetchedAt: string
  champion: TabletCompanionChampionCatalogItem
  strengthTier: number | null
  rank: number | null
  augments: TabletCompanionMayhemAugment[]
  aramBuild: TabletCompanionAramBuildData | null
}
