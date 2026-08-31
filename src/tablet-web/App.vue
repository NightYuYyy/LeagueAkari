<template>
  <main class="app-shell" :class="{ 'one-page': onePageLayout }">
    <header class="topbar">
      <div class="brand-block">
        <div class="brand-mark">LA</div>
        <div>
          <div class="brand-title">League Akari</div>
          <div class="brand-subtitle">海克斯大乱斗助手</div>
        </div>
      </div>

      <div class="room-status" aria-live="polite">
        <span class="status-dot" :class="{ online: roomState?.publisherOnline }"></span>
        <div>
          <div class="status-title">
            {{ roomState?.publisherOnline ? '游戏电脑在线' : '等待游戏电脑' }}
          </div>
          <div class="status-meta">房间 {{ roomCode }} · {{ freshnessText }}</div>
        </div>
      </div>
    </header>

    <section class="toolbar" aria-label="英雄查询">
      <div class="search-shell">
        <label for="champion-search">查找英雄</label>
        <input
          id="champion-search"
          v-model.trim="searchText"
          type="search"
          autocomplete="off"
          placeholder="输入英雄名、称号或英文名"
          @focus="searchOpen = true"
          @keydown.escape="searchOpen = false"
        />
        <div v-if="searchOpen && searchText && searchResults.length" class="search-results">
          <button
            v-for="item in searchResults"
            :key="item.championId"
            type="button"
            @click="selectManualChampion(item.championId)"
          >
            <span class="asset-icon search-icon">
              <span class="asset-fallback">{{ item.name.slice(0, 1) }}</span>
              <img :src="item.iconUrl" alt="" @error="hideBrokenImage" />
            </span>
            <span>
              <strong>{{ item.name }}</strong>
              <small>{{ item.title }} · {{ item.alias }}</small>
            </span>
          </button>
        </div>
      </div>

      <button
        v-if="!followingDesktop && roomState?.snapshot?.championId"
        class="follow-button"
        type="button"
        @click="followDesktop"
      >
        跟随电脑当前英雄
      </button>
      <div class="mode-pill">海克斯优先 · 大乱斗出装</div>
    </section>

    <section v-if="loading" class="empty-state" aria-live="polite">
      <div class="spinner"></div>
      <h1>正在加载完整推荐</h1>
      <p>正在从 OP.GG 获取海克斯、装备、符文和技能数据。</p>
    </section>

    <section v-else-if="errorMessage" class="empty-state error-state" aria-live="assertive">
      <span class="empty-code">!</span>
      <h1>数据暂时不可用</h1>
      <p>{{ errorMessage }}</p>
      <button type="button" @click="reloadCurrentChampion">重新加载</button>
    </section>

    <section v-else-if="championData" class="content-layout">
      <aside class="champion-summary">
        <div class="champion-portrait-wrap asset-icon portrait-icon">
          <span class="asset-fallback">{{ championData.champion.name.slice(0, 1) }}</span>
          <img
            class="champion-portrait"
            :src="championData.champion.iconUrl"
            :alt="championData.champion.name"
            @error="hideBrokenImage"
          />
          <span class="tier-badge large" :data-tier="championData.strengthTier">
            {{ tierName(championData.strengthTier) }}
          </span>
        </div>
        <p class="eyebrow">当前英雄</p>
        <h1>{{ championData.champion.name }}</h1>
        <p class="champion-title">{{ championData.champion.title }}</p>

        <dl class="summary-stats">
          <div>
            <dt>海克斯强度</dt>
            <dd>{{ tierName(championData.strengthTier) }} 级</dd>
          </div>
          <div>
            <dt>海克斯排名</dt>
            <dd>{{ championData.rank ? `#${championData.rank}` : '暂无' }}</dd>
          </div>
          <div>
            <dt>大乱斗胜率</dt>
            <dd>{{ formatPercent(championData.aramBuild?.performance.winRate ?? null) }}</dd>
          </div>
          <div>
            <dt>数据版本</dt>
            <dd>{{ championData.aramBuild?.patch ?? '实时' }}</dd>
          </div>
        </dl>

        <div class="source-note">
          <span>{{ followingDesktop ? '自动跟随中' : '手动查询' }}</span>
          <time :datetime="championData.fetchedAt">{{ dataUpdatedText }}</time>
        </div>
        <p class="data-scope-note">海克斯：OP.GG 海克斯大乱斗<br />出装：OP.GG 极地大乱斗</p>
      </aside>

      <div class="data-workspace">
        <nav class="content-tabs" aria-label="推荐内容">
          <button
            v-for="tab in contentTabs"
            :key="tab.value"
            type="button"
            :aria-current="activeSection === tab.value ? 'page' : undefined"
            @click="activeSection = tab.value"
          >
            <span>{{ tab.label }}</span>
            <small>{{ tab.meta }}</small>
          </button>
        </nav>

        <section
          v-if="activeSection === 'all' || activeSection === 'augments'"
          class="workspace-section"
        >
          <div class="workspace-heading">
            <div>
              <p class="eyebrow">核心推荐</p>
              <h2>海克斯推荐</h2>
            </div>
            <div class="sort-control" role="group" aria-label="海克斯排序方式">
              <button
                v-for="option in sortOptions"
                :key="option.value"
                type="button"
                :aria-pressed="augmentSort === option.value"
                @click="augmentSort = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="filter-row" role="group" aria-label="海克斯品质">
            <button
              v-for="option in rarityOptions"
              :key="option.value"
              type="button"
              :data-rarity="option.value"
              :aria-pressed="augmentRarity === option.value"
              @click="augmentRarity = option.value"
            >
              <span
                v-if="option.value !== 'all'"
                class="rarity-gem"
                :data-rarity="option.value"
              ></span>
              {{ option.label }}
            </button>
          </div>

          <ol class="augment-list augment-list-wide">
            <li
              v-for="(augment, index) in displayedAugments"
              :key="augment.augmentId"
              :data-rarity="augment.rarity"
            >
              <span class="rank-number">{{ index + 1 }}</span>
              <span class="asset-icon augment-icon" :data-rarity="augment.rarity">
                <span class="asset-fallback">{{ augment.name.slice(0, 1) }}</span>
                <img
                  v-if="augment.iconUrl"
                  :src="augment.iconUrl"
                  alt=""
                  @error="hideBrokenImage"
                />
              </span>
              <div class="augment-copy">
                <div class="augment-line">
                  <strong>{{ augment.name }}</strong>
                  <span class="augment-badges">
                    <span class="rarity-label" :data-rarity="augment.rarity">
                      {{ rarityLabel(augment.rarity) }}
                    </span>
                    <span class="tier-badge" :data-tier="augment.tier">
                      {{ tierName(augment.tier) }}
                    </span>
                  </span>
                </div>
                <p v-if="augment.description">{{ augment.description }}</p>
                <div class="augment-metrics">
                  <span
                    >表现分 <b>{{ formatMetric(augment.performanceScore) }}</b></span
                  >
                  <span
                    >热度 <b>{{ formatMetric(augment.popularity) }}</b></span
                  >
                </div>
              </div>
            </li>
          </ol>

          <button
            v-if="visibleAugments.length > augmentLimit"
            class="show-all-button"
            type="button"
            @click="showAllAugments = !showAllAugments"
          >
            {{ showAllAugments ? '收起完整列表' : `查看全部 ${visibleAugments.length} 个海克斯` }}
          </button>
        </section>

        <section
          v-if="activeSection === 'all' || activeSection === 'builds'"
          class="workspace-section"
        >
          <div class="workspace-heading">
            <div>
              <p class="eyebrow">
                OP.GG 极地大乱斗 · {{ championData.aramBuild?.patch ?? '当前版本' }}
              </p>
              <h2>装备推荐</h2>
            </div>
            <div v-if="championData.aramBuild" class="build-summary-inline">
              <span
                >排名 <b>#{{ championData.aramBuild.performance.rank ?? '—' }}</b></span
              >
              <span
                >胜率 <b>{{ formatPercent(championData.aramBuild.performance.winRate) }}</b></span
              >
              <span
                >KDA <b>{{ formatMetric(championData.aramBuild.performance.kda) }}</b></span
              >
            </div>
          </div>

          <div v-if="buildSections.length" class="build-grid">
            <section
              v-for="section in buildSections"
              :key="section.slot"
              class="recommendation-card"
            >
              <header>
                <div>
                  <h3>{{ section.label }}</h3>
                  <p>{{ section.options.length }} 套方案</p>
                </div>
              </header>
              <ol class="build-options">
                <li v-for="(option, index) in limitedOptions(section.options)" :key="index">
                  <div class="item-sequence">
                    <span
                      v-for="itemId in option.itemIds"
                      :key="itemId"
                      class="asset-icon item-icon"
                    >
                      <span class="asset-fallback">{{ itemId }}</span>
                      <img
                        v-if="itemAsset(itemId).iconUrl"
                        :src="itemAsset(itemId).iconUrl!"
                        :alt="itemAsset(itemId).name"
                        :title="itemAsset(itemId).name"
                        @error="hideBrokenImage"
                      />
                    </span>
                  </div>
                  <p class="recommendation-name">{{ option.itemIds.map(itemName).join(' → ') }}</p>
                  <div class="recommendation-metrics">
                    <span
                      >选择率 <b>{{ formatPercent(option.performance.pickRate) }}</b></span
                    >
                    <span
                      >胜率 <b>{{ formatPercent(option.performance.winRate) }}</b></span
                    >
                    <span>{{ formatCount(option.performance.games) }} 场</span>
                  </div>
                </li>
              </ol>
            </section>
          </div>
          <div v-else class="inline-empty">当前英雄暂时没有可用的装备推荐。</div>

          <button
            v-if="buildSections.some((section) => section.options.length > buildOptionLimit)"
            class="show-all-button"
            type="button"
            @click="showAllBuilds = !showAllBuilds"
          >
            {{ showAllBuilds ? '收起次要方案' : '展开全部装备方案' }}
          </button>
        </section>

        <section
          v-if="activeSection === 'all' || activeSection === 'runes'"
          class="workspace-section"
        >
          <div class="workspace-heading">
            <div>
              <p class="eyebrow">
                OP.GG 极地大乱斗 · {{ championData.aramBuild?.patch ?? '当前版本' }}
              </p>
              <h2>符文、召唤师技能与加点</h2>
            </div>
          </div>

          <div v-if="championData.aramBuild" class="loadout-grid">
            <section class="recommendation-card spell-card">
              <header><h3>召唤师技能</h3></header>
              <ol class="compact-options">
                <li
                  v-for="(option, index) in championData.aramBuild.summonerSpells.slice(
                    0,
                    onePageLayout ? 2 : 4
                  )"
                  :key="index"
                >
                  <div class="item-sequence">
                    <span
                      v-for="spellId in option.spellIds"
                      :key="spellId"
                      class="asset-icon spell-icon"
                    >
                      <span class="asset-fallback">{{ spellId }}</span>
                      <img
                        v-if="spellAsset(spellId).iconUrl"
                        :src="spellAsset(spellId).iconUrl!"
                        :alt="spellAsset(spellId).name"
                        :title="spellAsset(spellId).name"
                        @error="hideBrokenImage"
                      />
                    </span>
                  </div>
                  <div class="recommendation-metrics">
                    <span>{{ option.spellIds.map(spellName).join(' + ') }}</span>
                    <span
                      >选择率 <b>{{ formatPercent(option.performance.pickRate) }}</b></span
                    >
                    <span
                      >胜率 <b>{{ formatPercent(option.performance.winRate) }}</b></span
                    >
                  </div>
                </li>
              </ol>
            </section>

            <section class="recommendation-card skill-card">
              <header><h3>技能加点</h3></header>
              <ol class="compact-options">
                <li
                  v-for="(option, index) in championData.aramBuild.abilityBuilds.slice(
                    0,
                    onePageLayout ? 2 : 3
                  )"
                  :key="index"
                >
                  <div class="ability-priority">
                    <span v-for="ability in option.abilityPriority" :key="ability">{{
                      ability
                    }}</span>
                  </div>
                  <p class="level-order">{{ option.levelOrder.join(' · ') || '按优先级加点' }}</p>
                  <div class="recommendation-metrics">
                    <span
                      >选择率 <b>{{ formatPercent(option.performance.pickRate) }}</b></span
                    >
                    <span
                      >胜率 <b>{{ formatPercent(option.performance.winRate) }}</b></span
                    >
                  </div>
                </li>
              </ol>
            </section>
          </div>

          <div v-if="championData.aramBuild?.runePages.length" class="rune-grid">
            <section
              v-for="(page, index) in championData.aramBuild.runePages.slice(
                0,
                onePageLayout ? 2 : 4
              )"
              :key="index"
              class="recommendation-card rune-card"
            >
              <header>
                <div class="rune-style-title">
                  <span class="asset-icon style-icon">
                    <span class="asset-fallback">{{ index + 1 }}</span>
                    <img
                      v-if="styleAsset(page.primaryStyleId).iconUrl"
                      :src="styleAsset(page.primaryStyleId).iconUrl!"
                      alt=""
                      @error="hideBrokenImage"
                    />
                  </span>
                  <div>
                    <h3>{{ styleAsset(page.primaryStyleId).name }}</h3>
                    <p>副系 {{ styleAsset(page.secondaryStyleId).name }}</p>
                  </div>
                </div>
                <span class="option-rank">#{{ index + 1 }}</span>
              </header>

              <div class="rune-line">
                <span
                  v-for="perkId in [...page.primaryRuneIds, ...page.secondaryRuneIds]"
                  :key="perkId"
                  class="asset-icon rune-icon"
                >
                  <span class="asset-fallback">{{ perkId }}</span>
                  <img
                    v-if="perkAsset(perkId).iconUrl"
                    :src="perkAsset(perkId).iconUrl!"
                    :alt="perkAsset(perkId).name"
                    :title="perkAsset(perkId).name"
                    @error="hideBrokenImage"
                  />
                </span>
                <span class="rune-divider"></span>
                <span
                  v-for="(perkId, shardIndex) in page.statShardIds"
                  :key="`${perkId}-${shardIndex}`"
                  class="asset-icon shard-icon"
                >
                  <span class="asset-fallback">{{ perkId }}</span>
                  <img
                    v-if="perkAsset(perkId).iconUrl"
                    :src="perkAsset(perkId).iconUrl!"
                    :alt="perkAsset(perkId).name"
                    :title="perkAsset(perkId).name"
                    @error="hideBrokenImage"
                  />
                </span>
              </div>

              <p class="rune-names">
                {{ [...page.primaryRuneIds, ...page.secondaryRuneIds].map(perkName).join(' · ') }}
              </p>
              <div class="recommendation-metrics">
                <span
                  >选择率 <b>{{ formatPercent(page.performance.pickRate) }}</b></span
                >
                <span
                  >胜率 <b>{{ formatPercent(page.performance.winRate) }}</b></span
                >
                <span>{{ formatCount(page.performance.games) }} 场</span>
              </div>
            </section>
          </div>
          <div v-else class="inline-empty">当前英雄暂时没有可用的符文推荐。</div>
        </section>
      </div>
    </section>

    <section v-else class="empty-state">
      <span class="empty-code">{{ roomState?.snapshot?.leagueClientConnected ? '⌁' : '—' }}</span>
      <h1>等待选择英雄</h1>
      <p>进入英雄选择后页面会自动跟随；现在也可以在上方手动搜索英雄，提前查看完整推荐。</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import type {
  TabletCompanionChampionCatalogItem,
  TabletCompanionDisplayAsset,
  TabletCompanionMayhemAugment,
  TabletCompanionMayhemChampionData,
  TabletCompanionRoomState
} from '@shared/shards/tablet-companion'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { sortTabletAugments, type TabletAugmentSort } from './augment-sort'

type AugmentRarityFilter = 'all' | TabletCompanionMayhemAugment['rarity']
type ContentSection = 'all' | 'augments' | 'builds' | 'runes'

const roomCode = decodeURIComponent(location.pathname.match(/^\/room\/([^/]+)/)?.[1] ?? '')
const roomState = ref<TabletCompanionRoomState | null>(null)
const catalog = ref<TabletCompanionChampionCatalogItem[]>([])
const championData = ref<TabletCompanionMayhemChampionData | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const searchText = ref('')
const searchOpen = ref(false)
const followingDesktop = ref(true)
const activeSection = ref<ContentSection>('all')
const augmentSort = ref<TabletAugmentSort>('tier')
const augmentRarity = ref<AugmentRarityFilter>('all')
const showAllAugments = ref(false)
const showAllBuilds = ref(false)
const now = ref(Date.now())

let events: EventSource | null = null
let timer: ReturnType<typeof setInterval> | null = null
let loadGeneration = 0

const emptyAsset = (id: number): TabletCompanionDisplayAsset => ({
  id,
  name: String(id),
  description: '',
  iconUrl: null
})

const roomApi = (path: string) =>
  `/api/rooms/${encodeURIComponent(roomCode)}${path.startsWith('/') ? path : `/${path}`}`

const searchResults = computed(() => {
  const query = searchText.value.toLowerCase()
  if (!query) return []
  return catalog.value
    .filter((champion) => champion.keywords.some((keyword) => keyword.includes(query)))
    .slice(0, 8)
})

const freshnessText = computed(() => {
  if (!roomState.value?.receivedAt) return '尚未同步'
  return relativeTime(roomState.value.receivedAt)
})

const dataUpdatedText = computed(() =>
  championData.value ? `${relativeTime(championData.value.fetchedAt)}更新` : ''
)

const contentTabs = computed<Array<{ label: string; value: ContentSection; meta: string }>>(() => [
  {
    label: '一图流',
    value: 'all',
    meta: '一页显示'
  },
  {
    label: '海克斯推荐',
    value: 'augments',
    meta: `${championData.value?.augments.length ?? 0} 个`
  },
  {
    label: '装备推荐',
    value: 'builds',
    meta: championData.value?.aramBuild?.patch ?? '暂无'
  },
  {
    label: '符文与技能',
    value: 'runes',
    meta: `${championData.value?.aramBuild?.runePages.length ?? 0} 套`
  }
])

const sortOptions: Array<{ label: string; value: TabletAugmentSort }> = [
  { label: '推荐', value: 'tier' },
  { label: '表现', value: 'performance' },
  { label: '热度', value: 'popularity' }
]

const rarityOptions: Array<{ label: string; value: AugmentRarityFilter }> = [
  { label: '全部', value: 'all' },
  { label: '白银', value: 'silver' },
  { label: '黄金', value: 'gold' },
  { label: '棱彩', value: 'prismatic' }
]

const visibleAugments = computed(() => {
  const items = (championData.value?.augments ?? []).filter(
    (augment) => augmentRarity.value === 'all' || augment.rarity === augmentRarity.value
  )
  return sortTabletAugments(items, augmentSort.value)
})

const onePageLayout = computed(() => activeSection.value === 'all')
const augmentLimit = computed(() => (onePageLayout.value ? 10 : 16))
const buildOptionLimit = computed(() => (onePageLayout.value ? 2 : 4))

const displayedAugments = computed(() =>
  visibleAugments.value.slice(0, showAllAugments.value ? undefined : augmentLimit.value)
)

const buildSections = computed(() => {
  const labels = {
    starting: '出门装备',
    boots: '鞋子',
    core: '核心装备',
    fourth: '第四件',
    fifth: '第五件',
    sixth: '第六件',
    last: '单件优先级',
    prism: '棱彩装备'
  }
  return (championData.value?.aramBuild?.itemBuilds ?? [])
    .filter((section) => section.options.length)
    .map((section) => ({ ...section, label: labels[section.slot] }))
})

function limitedOptions<T>(options: T[]) {
  return options.slice(0, showAllBuilds.value ? undefined : buildOptionLimit.value)
}

function itemAsset(id: number) {
  return championData.value?.aramBuild?.resources.items[id] ?? emptyAsset(id)
}

function perkAsset(id: number) {
  return championData.value?.aramBuild?.resources.perks[id] ?? emptyAsset(id)
}

function styleAsset(id: number | null) {
  if (id === null) return emptyAsset(0)
  return championData.value?.aramBuild?.resources.perkStyles[id] ?? emptyAsset(id)
}

function spellAsset(id: number) {
  return championData.value?.aramBuild?.resources.summonerSpells[id] ?? emptyAsset(id)
}

function itemName(id: number) {
  return itemAsset(id).name
}

function perkName(id: number) {
  return perkAsset(id).name
}

function spellName(id: number) {
  return spellAsset(id).name
}

async function loadChampion(championId: number) {
  const generation = ++loadGeneration
  loading.value = true
  errorMessage.value = ''
  showAllAugments.value = false
  showAllBuilds.value = false

  try {
    const response = await fetch(roomApi(`/champions/${championId}/mayhem`))
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
    const data = (await response.json()) as TabletCompanionMayhemChampionData
    if (generation === loadGeneration) championData.value = data
  } catch (error) {
    if (generation === loadGeneration) {
      errorMessage.value = error instanceof Error ? error.message : '未知错误'
    }
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function selectManualChampion(championId: number) {
  followingDesktop.value = false
  searchOpen.value = false
  searchText.value = ''
  void loadChampion(championId)
}

function followDesktop() {
  followingDesktop.value = true
  const championId = roomState.value?.snapshot?.championId
  if (championId) void loadChampion(championId)
}

function reloadCurrentChampion() {
  const championId = followingDesktop.value
    ? roomState.value?.snapshot?.championId
    : championData.value?.champion.championId
  if (championId) void loadChampion(championId)
}

function applyRoomState(nextState: TabletCompanionRoomState) {
  const previousChampionId = roomState.value?.snapshot?.championId
  roomState.value = nextState
  const nextChampionId = nextState.snapshot?.championId
  if (followingDesktop.value && nextChampionId && nextChampionId !== previousChampionId) {
    void loadChampion(nextChampionId)
  }
}

function tierName(tier: string | number | null) {
  if (typeof tier === 'string' && !/^\d+$/.test(tier)) return tier.toUpperCase()
  const numeric = typeof tier === 'number' ? tier : Number(tier)
  return ['S', 'A', 'B', 'C', 'D', 'E', 'F'][numeric] ?? '—'
}

function rarityLabel(rarity: TabletCompanionMayhemAugment['rarity']) {
  if (rarity === 'silver') return '白银'
  if (rarity === 'gold') return '黄金'
  if (rarity === 'prismatic') return '棱彩'
  return '其他'
}

function formatMetric(value: number | null) {
  return value === null
    ? '—'
    : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function formatPercent(value: number | null) {
  return value === null
    ? '—'
    : new Intl.NumberFormat('zh-CN', {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(value)
}

function formatCount(value: number | null) {
  return value === null
    ? '—'
    : new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(value)
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((now.value - new Date(value).getTime()) / 1000))
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

function hideBrokenImage(event: Event) {
  const image = event.currentTarget
  if (image instanceof HTMLImageElement) image.hidden = true
}

onMounted(async () => {
  if (!roomCode) {
    errorMessage.value = '访问地址缺少房间码'
    return
  }

  timer = setInterval(() => (now.value = Date.now()), 5_000)
  try {
    const [stateResponse, catalogResponse] = await Promise.all([
      fetch(roomApi('/state')),
      fetch(roomApi('/champions'))
    ])
    if (stateResponse.ok) applyRoomState((await stateResponse.json()) as TabletCompanionRoomState)
    if (catalogResponse.ok) {
      const body = (await catalogResponse.json()) as {
        champions: TabletCompanionChampionCatalogItem[]
      }
      catalog.value = body.champions
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '初始化失败'
  }

  events = new EventSource(roomApi('/events'))
  events.addEventListener('state', (event) => {
    applyRoomState(JSON.parse((event as MessageEvent<string>).data) as TabletCompanionRoomState)
  })
})

onBeforeUnmount(() => {
  events?.close()
  if (timer) clearInterval(timer)
})
</script>
