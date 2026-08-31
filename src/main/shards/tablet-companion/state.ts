import type { TabletCompanionPublishStatus } from '@shared/shards/tablet-companion'
import { makeAutoObservable } from 'mobx'

export class TabletCompanionSettings {
  enabled = false
  serverUrl = ''
  roomCode = ''
  publishToken = ''

  constructor() {
    makeAutoObservable(this)
  }
}

export class TabletCompanionState {
  status: TabletCompanionPublishStatus = 'disabled'
  lastPublishedAt: string | null = null
  lastError: string | null = null

  constructor() {
    makeAutoObservable(this)
  }

  setStatus(status: TabletCompanionPublishStatus) {
    this.status = status
  }

  setPublished(at: string) {
    this.status = 'connected'
    this.lastPublishedAt = at
    this.lastError = null
  }

  setError(message: string) {
    this.status = 'error'
    this.lastError = message
  }

  reset(status: TabletCompanionPublishStatus) {
    this.status = status
    this.lastError = null
  }
}
