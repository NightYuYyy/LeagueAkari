import type { TabletCompanionPublishStatus } from '@shared/shards/tablet-companion'
import { defineStore } from 'pinia'
import { shallowReactive, shallowRef } from 'vue'

export const useTabletCompanionStore = defineStore('shard:tablet-companion-renderer', () => {
  const settings = shallowReactive({
    enabled: false,
    serverUrl: '',
    roomCode: '',
    publishToken: ''
  })
  const status = shallowRef<TabletCompanionPublishStatus>('disabled')
  const lastPublishedAt = shallowRef<string | null>(null)
  const lastError = shallowRef<string | null>(null)

  return {
    settings,
    status,
    lastPublishedAt,
    lastError
  }
})
