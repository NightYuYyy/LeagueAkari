import type { TabletCompanionGameSnapshot } from '@shared/shards/tablet-companion'

import type { AkariIpcMain } from '../ipc'
import type { LeagueClientMain } from '../league-client'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { TabletCompanionSettings, TabletCompanionState } from './state'

export interface TabletCompanionMainContext {
  namespace: string
  ipc: AkariIpcMain
  leagueClient: LeagueClientMain
  logger: AkariLogger
  mobxUtils: MobxUtilsMain
  settings: TabletCompanionSettings
  settingService: SetterSettingService<TabletCompanionSettings>
  state: TabletCompanionState
}

export type TabletCompanionSnapshotFactory = () => TabletCompanionGameSnapshot
