import {
  type ChampionDataDetails,
  adaptOpggChampionDetails,
  adaptOpggMayhemDetails
} from '@shared/data-adapter/champion-data'
import { GtimgApi, type GtimgKiwiAugments, type Hero, Level } from '@shared/data-sources/gtimg'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type {
  TabletCompanionAramBuildData,
  TabletCompanionAugmentRarity,
  TabletCompanionChampionCatalogItem,
  TabletCompanionDisplayAsset,
  TabletCompanionMayhemChampionData
} from '@shared/shards/tablet-companion'
import type {
  Item,
  Perk,
  Perkstyles,
  Style,
  SummonerSpell
} from '@shared/types/league-client/game-data'
import axios from 'axios'

const ASSET_CACHE_TTL_MS = 3 * 60 * 60 * 1000
const CHAMPION_DATA_CACHE_TTL_MS = 3 * 60 * 1000
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const COMMUNITY_DRAGON_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global'
const COMMUNITY_DRAGON_ASSET_BASE = `${COMMUNITY_DRAGON_BASE}/default`
const LCU_ASSET_PREFIX = '/lol-game-data/assets/'

export const TABLET_ASSET_KINDS = [
  'champions',
  'augments',
  'items',
  'perks',
  'perk-styles',
  'summoner-spells'
] as const

export type TabletAssetKind = (typeof TABLET_ASSET_KINDS)[number]

interface GameDataResources {
  items: Map<number, Item>
  perks: Map<number, Perk>
  perkStyles: Map<number, Style>
  summonerSpells: Map<number, SummonerSpell>
}

interface AssetSnapshot extends GameDataResources {
  expiresAt: number
  catalog: TabletCompanionChampionCatalogItem[]
  champions: Map<number, TabletCompanionChampionCatalogItem>
  augments: Map<number, GtimgKiwiAugments>
}

interface ChampionCacheEntry {
  expiresAt: number
  value: TabletCompanionMayhemChampionData
}

export interface TabletBinaryAsset {
  data: Buffer
  contentType: string
}

export class TabletChampionDataLoader {
  private readonly _gtimgApi = new GtimgApi()
  private readonly _opggApi = new OpggHttpApiAxiosHelper(
    axios.create({ timeout: 8_000, headers: { 'User-Agent': 'LeagueAkari-Tablet' } })
  )
  private readonly _communityDragonHttp = axios.create({
    baseURL: COMMUNITY_DRAGON_BASE,
    timeout: 12_000,
    headers: { 'User-Agent': 'LeagueAkari-Tablet' }
  })
  private readonly _imageHttp = axios.create({
    timeout: 12_000,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    headers: { 'User-Agent': 'LeagueAkari-Tablet', Accept: 'image/*' }
  })
  private _assetSnapshot: Promise<AssetSnapshot> | null = null
  private readonly _championCache = new Map<number, ChampionCacheEntry>()
  private readonly _imageCache = new Map<string, Promise<TabletBinaryAsset>>()

  constructor() {
    this._gtimgApi.http.defaults.timeout = 8_000
  }

  async getCatalog() {
    return (await this._getAssets()).catalog
  }

  async getMayhemChampion(championId: number) {
    const cached = this._championCache.get(championId)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const assets = await this._getAssets()
    const champion = assets.champions.get(championId)
    if (!champion) return null

    const [tiersResponse, augmentsResponse, aramDetails] = await Promise.all([
      this._opggApi.getAramMayhemTiers(),
      this._opggApi.getAramMayhemChampionAugments(championId),
      this._loadAramDetails(championId).catch(() => null)
    ])
    const tierItem = tiersResponse.data.data.find((item) => item.champion_id === championId)
    if (!tierItem) return null

    const mayhemDetails = adaptOpggMayhemDetails(tierItem, augmentsResponse.data, {
      dataDate: null
    })
    const value: TabletCompanionMayhemChampionData = {
      source: 'opgg',
      fetchedAt: new Date().toISOString(),
      champion,
      strengthTier: numericTier(mayhemDetails.summary.performance.strengthTier),
      rank: mayhemDetails.summary.performance.rank,
      // 保持 OP.GG 返回顺序；网页“推荐”排序必须与桌面端一致。
      augments: (mayhemDetails.sections.augments ?? []).map((augment) => {
        const metadata = assets.augments.get(augment.augmentId)
        return {
          augmentId: augment.augmentId,
          name: metadata?.name_cn || metadata?.name_en || String(augment.augmentId),
          description: stripHtml(metadata?.tooltip || metadata?.desc || ''),
          iconUrl:
            metadata?.small_Icon || metadata?.large_Icon
              ? `/api/assets/augments/${augment.augmentId}`
              : null,
          rarity: toRarity(metadata?.level),
          tier: augment.tier,
          performanceScore: augment.performanceScore,
          popularity: augment.popularity
        }
      }),
      aramBuild: aramDetails ? toAramBuild(aramDetails, assets) : null
    }

    this._championCache.set(championId, {
      expiresAt: Date.now() + CHAMPION_DATA_CACHE_TTL_MS,
      value
    })
    return value
  }

  async getAsset(kind: TabletAssetKind, id: number) {
    const assets = await this._getAssets()
    const remoteUrl = resolveRemoteAssetUrl(kind, id, assets)
    if (!remoteUrl) return null

    const cacheKey = `${kind}:${id}`
    let pending = this._imageCache.get(cacheKey)
    if (!pending) {
      pending = this._fetchImage(remoteUrl)
      this._imageCache.set(cacheKey, pending)
    }

    try {
      return await pending
    } catch (error) {
      this._imageCache.delete(cacheKey)
      throw error
    }
  }

  private async _loadAramDetails(championId: number) {
    const versions = await this._opggApi.getVersions('global', 'aram')
    const patch = versions.data.data[0]
    if (!patch) return null
    const response = await this._opggApi.getChampion('global', 'aram', championId, 'none', {
      tier: 'all',
      version: patch
    })
    return adaptOpggChampionDetails(response.data, { mode: 'aram', position: 'none' })
  }

  private async _fetchImage(url: string): Promise<TabletBinaryAsset> {
    const parsedUrl = new URL(url)
    if (!['game.gtimg.cn', 'raw.communitydragon.org'].includes(parsedUrl.hostname)) {
      throw new Error('unsupported-image-host')
    }

    const response = await this._imageHttp.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
    const contentType = String(response.headers['content-type'] ?? '').split(';', 1)[0]
    const data = Buffer.from(response.data)
    if (!contentType.startsWith('image/') || data.length > MAX_IMAGE_BYTES) {
      throw new Error('invalid-image-response')
    }
    return { data, contentType }
  }

  private async _getAssets() {
    if (!this._assetSnapshot) this._assetSnapshot = this._loadAssets()

    const snapshot = await this._assetSnapshot
    if (snapshot.expiresAt <= Date.now()) {
      this._assetSnapshot = this._loadAssets()
      return this._assetSnapshot
    }

    return snapshot
  }

  private async _loadAssets(): Promise<AssetSnapshot> {
    try {
      const [heroList, augmentList, gameData] = await Promise.all([
        this._gtimgApi.getHeroList(),
        this._gtimgApi.getKiwiAugments(),
        this._loadGameDataResources()
      ])
      const catalog = heroList.hero
        .map(toCatalogItem)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      return {
        expiresAt: Date.now() + ASSET_CACHE_TTL_MS,
        catalog,
        champions: new Map(catalog.map((champion) => [champion.championId, champion])),
        augments: new Map(augmentList.map((augment) => [augment.augmentID, augment])),
        ...gameData
      }
    } catch (error) {
      this._assetSnapshot = null
      throw error
    }
  }

  private async _loadGameDataResources(): Promise<GameDataResources> {
    const [items, perks, perkstyles, summonerSpells] = await Promise.all([
      this._communityDragonHttp
        .get<Item[]>('/zh_cn/v1/items.json')
        .then((response) => response.data)
        .catch(() => []),
      this._communityDragonHttp
        .get<Perk[]>('/zh_cn/v1/perks.json')
        .then((response) => response.data)
        .catch(() => []),
      this._communityDragonHttp
        .get<Perkstyles>('/zh_cn/v1/perkstyles.json')
        .then((response) => response.data.styles)
        .catch(() => []),
      this._communityDragonHttp
        .get<SummonerSpell[]>('/zh_cn/v1/summoner-spells.json')
        .then((response) => response.data)
        .catch(() => [])
    ])
    return {
      items: mapById(items),
      perks: mapById(perks),
      perkStyles: mapById(perkstyles),
      summonerSpells: mapById(summonerSpells)
    }
  }
}

function toCatalogItem(hero: Hero): TabletCompanionChampionCatalogItem {
  const championId = Number(hero.heroId)
  return {
    championId,
    name: hero.title,
    title: hero.name,
    alias: hero.alias,
    iconUrl: `/api/assets/champions/${championId}`,
    keywords: [hero.name, hero.title, hero.alias, hero.keywords]
      .filter(Boolean)
      .map((value) => value.toLowerCase())
  }
}

function toAramBuild(
  details: ChampionDataDetails,
  assets: AssetSnapshot
): TabletCompanionAramBuildData {
  const itemIds = uniqueIds(
    (details.sections.itemBuilds ?? []).flatMap((slot) =>
      slot.options.flatMap((option) => option.itemIds)
    )
  )
  const spellIds = uniqueIds(
    (details.sections.summonerSpells ?? []).flatMap((recommendation) => recommendation.spellIds)
  )
  const perkIds = uniqueIds(
    (details.sections.runePages ?? []).flatMap((page) => [
      ...page.primaryRuneIds,
      ...page.secondaryRuneIds,
      ...page.statShardIds
    ])
  )
  const perkStyleIds = uniqueIds(
    (details.sections.runePages ?? []).flatMap((page) => [
      page.primaryStyleId,
      page.secondaryStyleId
    ])
  )
  const performance = details.summary.performance

  return {
    patch: details.metadata.patch,
    updatedAt: details.metadata.updatedAt,
    performance: {
      games: performance.games,
      wins: performance.wins,
      winRate: performance.winRate,
      pickRate: performance.pickRate,
      rank: performance.rank,
      averagePlacement: performance.averagePlacement,
      firstPlaceRate: performance.firstPlaceRate,
      kda: performance.kda,
      strengthTier: performance.strengthTier
    },
    itemBuilds: details.sections.itemBuilds ?? [],
    summonerSpells: details.sections.summonerSpells ?? [],
    runePages: details.sections.runePages ?? [],
    abilityBuilds: details.sections.abilityBuilds ?? [],
    resources: {
      items: displayAssetRecord(itemIds, assets.items, 'items', (item) => item.description),
      perks: displayAssetRecord(perkIds, assets.perks, 'perks', (perk) => perk.longDesc),
      perkStyles: displayAssetRecord(
        perkStyleIds,
        assets.perkStyles,
        'perk-styles',
        (style) => style.tooltip
      ),
      summonerSpells: displayAssetRecord(
        spellIds,
        assets.summonerSpells,
        'summoner-spells',
        (spell) => spell.description
      )
    }
  }
}

function displayAssetRecord<T extends { id: number; name: string; iconPath: string }>(
  ids: number[],
  resources: Map<number, T>,
  kind: Extract<TabletAssetKind, 'items' | 'perks' | 'perk-styles' | 'summoner-spells'>,
  description: (resource: T) => string
) {
  return Object.fromEntries(
    ids.map((id) => {
      const resource = resources.get(id)
      const value: TabletCompanionDisplayAsset = {
        id,
        name: resource?.name || String(id),
        description: stripHtml(resource ? description(resource) : ''),
        iconUrl: resource?.iconPath ? `/api/assets/${kind}/${id}` : null
      }
      return [id, value]
    })
  )
}

function resolveRemoteAssetUrl(kind: TabletAssetKind, id: number, assets: AssetSnapshot) {
  if (kind === 'champions') {
    const champion = assets.champions.get(id)
    return champion?.alias
      ? `https://game.gtimg.cn/images/lol/act/img/champion/${champion.alias}.png`
      : null
  }
  if (kind === 'augments') {
    const augment = assets.augments.get(id)
    return augment?.small_Icon || augment?.large_Icon || null
  }

  const resource =
    kind === 'items'
      ? assets.items.get(id)
      : kind === 'perks'
        ? assets.perks.get(id)
        : kind === 'perk-styles'
          ? assets.perkStyles.get(id)
          : assets.summonerSpells.get(id)
  return resource?.iconPath ? resolveCommunityDragonAssetUrl(resource.iconPath) : null
}

function resolveCommunityDragonAssetUrl(source: string) {
  const pathOnly = source.trim().split(/[?#]/, 1)[0]
  if (!pathOnly.startsWith('/')) return null
  const lowerPath = pathOnly.toLowerCase()
  if (lowerPath.startsWith(LCU_ASSET_PREFIX)) {
    return `${COMMUNITY_DRAGON_ASSET_BASE}/${pathOnly
      .slice(LCU_ASSET_PREFIX.length)
      .replace(/^\/+/, '')
      .toLowerCase()}`
  }
  return `${COMMUNITY_DRAGON_ASSET_BASE}${lowerPath}`
}

function mapById<T extends { id: number }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

function uniqueIds(values: Array<number | null>) {
  return Array.from(new Set(values.filter((value): value is number => value !== null)))
}

function numericTier(value: string | number | null) {
  if (typeof value === 'number') return value
  if (!value) return null
  const parsed = Number(value.match(/\d+/)?.[0])
  return Number.isFinite(parsed) ? parsed : null
}

function toRarity(level: Level | undefined): TabletCompanionAugmentRarity {
  if (level === Level.KSilver) return 'silver'
  if (level === Level.KGold) return 'gold'
  if (level === Level.KPrismatic) return 'prismatic'
  return 'unknown'
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
