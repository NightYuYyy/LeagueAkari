import type {
  TabletCompanionGameSnapshot,
  TabletCompanionRoomState
} from '@shared/shards/tablet-companion'
import type { ServerResponse } from 'node:http'

const PUBLISHER_ONLINE_WINDOW_MS = 45_000

export class TabletRoomStore {
  private _snapshot: TabletCompanionGameSnapshot | null = null
  private _receivedAt: string | null = null
  private readonly _subscribers = new Set<ServerResponse>()

  constructor(readonly roomCode: string) {}

  update(snapshot: TabletCompanionGameSnapshot) {
    this._snapshot = snapshot
    this._receivedAt = new Date().toISOString()
    this._broadcast('state', this.getState())
  }

  getState(now = Date.now()): TabletCompanionRoomState {
    return {
      roomCode: this.roomCode,
      publisherOnline:
        this._receivedAt !== null &&
        now - new Date(this._receivedAt).getTime() < PUBLISHER_ONLINE_WINDOW_MS,
      receivedAt: this._receivedAt,
      snapshot: this._snapshot
    }
  }

  subscribe(response: ServerResponse) {
    this._subscribers.add(response)
    this._send(response, 'state', this.getState())
    return () => this._subscribers.delete(response)
  }

  heartbeat() {
    const state = this.getState()
    this._broadcast('state', state)
  }

  private _broadcast(event: string, data: unknown) {
    for (const response of this._subscribers) {
      this._send(response, event, data)
    }
  }

  private _send(response: ServerResponse, event: string, data: unknown) {
    if (response.destroyed || response.writableEnded) {
      this._subscribers.delete(response)
      return
    }

    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}
