import type { TabletCompanionGameSnapshot } from '@shared/shards/tablet-companion'
import { formatError } from '@shared/utils/errors'
import { compareStructural } from 'mobx'

import type { TabletCompanionMainContext } from './context'
import { createTabletCompanionSnapshotInput } from './snapshot'

const HEARTBEAT_INTERVAL_MS = 20_000
const PUBLISH_TIMEOUT_MS = 8_000

export class TabletCompanionPublishController {
  private _disposeReaction: (() => void) | null = null
  private _heartbeat: NodeJS.Timeout | null = null
  private _pending = false
  private _publishing: Promise<boolean> | null = null

  constructor(private readonly _context: TabletCompanionMainContext) {}

  watch() {
    this._disposeReaction = this._context.mobxUtils.reaction(
      () => ({
        enabled: this._context.settings.enabled,
        serverUrl: this._context.settings.serverUrl,
        roomCode: this._context.settings.roomCode,
        publishToken: this._context.settings.publishToken,
        snapshot: this._createSnapshotInput()
      }),
      () => {
        void this.requestPublish()
      },
      { fireImmediately: true, equals: compareStructural }
    )

    this._heartbeat = setInterval(() => {
      void this.requestPublish()
    }, HEARTBEAT_INTERVAL_MS)
  }

  async requestPublish() {
    this._pending = true
    if (!this._publishing) {
      this._publishing = this._drain()
    }
    return this._publishing
  }

  dispose() {
    this._disposeReaction?.()
    this._disposeReaction = null
    if (this._heartbeat) clearInterval(this._heartbeat)
    this._heartbeat = null
  }

  private async _drain() {
    let result = false
    try {
      while (this._pending) {
        this._pending = false
        result = await this._publishOnce()
      }
      return result
    } finally {
      this._publishing = null
    }
  }

  private async _publishOnce() {
    const { settings, state } = this._context
    if (!settings.enabled) {
      state.reset('disabled')
      return false
    }

    const endpoint = this._resolveEndpoint()
    if (!endpoint || !settings.publishToken.trim()) {
      state.reset('misconfigured')
      return false
    }

    state.setStatus('publishing')
    const snapshot = this._createSnapshot()

    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${settings.publishToken.trim()}`,
          'Content-Type': 'application/json',
          'User-Agent': 'LeagueAkari-TabletPublisher'
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS)
      })

      if (!response.ok) {
        const responseText = (await response.text()).slice(0, 300)
        throw new Error(`HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`)
      }

      state.setPublished(snapshot.publishedAt)
      return true
    } catch (error) {
      const message = formatError(error)
      state.setError(message)
      this._context.logger.warn('Failed to publish tablet companion state', message)
      return false
    }
  }

  private _resolveEndpoint() {
    const serverUrl = this._context.settings.serverUrl.trim()
    const roomCode = this._context.settings.roomCode.trim()
    if (!serverUrl || !roomCode) return null

    try {
      const base = new URL(serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`)
      if (base.protocol !== 'http:' && base.protocol !== 'https:') return null
      return new URL(`api/rooms/${encodeURIComponent(roomCode)}/state`, base)
    } catch {
      return null
    }
  }

  private _createSnapshot(): TabletCompanionGameSnapshot {
    return {
      ...this._createSnapshotInput(),
      publishedAt: new Date().toISOString()
    }
  }

  private _createSnapshotInput(): Omit<TabletCompanionGameSnapshot, 'publishedAt'> {
    return createTabletCompanionSnapshotInput(this._context.leagueClient)
  }
}
