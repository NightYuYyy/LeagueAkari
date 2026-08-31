import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import {
  TABLET_COMPANION_MAIN_NAMESPACE,
  TABLET_COMPANION_RENDERER_NAMESPACE
} from '@shared/shards/tablet-companion'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import type { TabletCompanionRendererContext } from './context'
import { syncTabletCompanionState } from './state-sync'

@Shard(TabletCompanionRenderer.id)
export class TabletCompanionRenderer implements IAkariShardInitDispose {
  static id = TABLET_COMPANION_RENDERER_NAMESPACE

  private readonly _context: TabletCompanionRendererContext

  constructor(
    @Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) settingUtils: SettingUtilsRenderer
  ) {
    this._context = { piniaMobxUtils, settingUtils }
  }

  async onInit() {
    await syncTabletCompanionState(this._context)
  }

  setEnabled(value: boolean) {
    return this._context.settingUtils.set(TABLET_COMPANION_MAIN_NAMESPACE, 'enabled', value)
  }

  setServerUrl(value: string) {
    return this._context.settingUtils.set(TABLET_COMPANION_MAIN_NAMESPACE, 'serverUrl', value)
  }

  setRoomCode(value: string) {
    return this._context.settingUtils.set(TABLET_COMPANION_MAIN_NAMESPACE, 'roomCode', value)
  }

  setPublishToken(value: string) {
    return this._context.settingUtils.set(TABLET_COMPANION_MAIN_NAMESPACE, 'publishToken', value)
  }

  publishNow() {
    return this._ipc.call<{ success: boolean; status: string }>(
      TABLET_COMPANION_MAIN_NAMESPACE,
      'publishNow'
    )
  }
}
