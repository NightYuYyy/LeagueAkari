import type { AkariIpcMain } from '../ipc'
import type { TabletCompanionMainContext } from './context'
import type { TabletCompanionPublishController } from './publish-controller'

export class TabletCompanionIpcHandlers {
  constructor(
    private readonly _context: TabletCompanionMainContext,
    private readonly _ipc: AkariIpcMain,
    private readonly _publisher: TabletCompanionPublishController
  ) {}

  register() {
    this._ipc.onCall(this._context.namespace, 'publishNow', async () => {
      const success = await this._publisher.requestPublish()
      return { success, status: this._context.state.status }
    })
  }
}
