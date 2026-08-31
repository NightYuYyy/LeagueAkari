import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { TABLET_COMPANION_MAIN_NAMESPACE } from '@shared/shards/tablet-companion'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { type AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { TabletCompanionMainContext } from './context'
import { TabletCompanionIpcHandlers } from './ipc-handlers'
import { TabletCompanionPublishController } from './publish-controller'
import { TabletCompanionSettings, TabletCompanionState } from './state'

@Shard(TabletCompanionMain.id)
export class TabletCompanionMain implements IAkariShardInitDispose {
  static id = TABLET_COMPANION_MAIN_NAMESPACE

  public readonly settings = new TabletCompanionSettings()
  public readonly state = new TabletCompanionState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<TabletCompanionSettings>
  private readonly _context: TabletCompanionMainContext
  private readonly _publisher: TabletCompanionPublishController
  private readonly _ipcHandlers: TabletCompanionIpcHandlers

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _leagueClient: LeagueClientMain,
    loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    settingFactory: SettingFactoryMain
  ) {
    this._logger = loggerFactory.create(TabletCompanionMain.id)
    this._settingService = settingFactory.register(
      TabletCompanionMain.id,
      {
        enabled: { default: false, schema: z.boolean() },
        serverUrl: { default: '', schema: z.string().max(512) },
        roomCode: { default: '', schema: z.string().max(32) },
        publishToken: { default: '', schema: z.string().max(512) }
      },
      this.settings
    )
    this._context = {
      namespace: TabletCompanionMain.id,
      ipc: this._ipc,
      leagueClient: this._leagueClient,
      logger: this._logger,
      mobxUtils: this._mobxUtils,
      settings: this.settings,
      settingService: this._settingService,
      state: this.state
    }
    this._publisher = new TabletCompanionPublishController(this._context)
    this._ipcHandlers = new TabletCompanionIpcHandlers(this._context, this._ipc, this._publisher)
  }

  async onInit() {
    await this._settingService.applyToState()
    this._mobxUtils.propSync(TabletCompanionMain.id, 'settings', this.settings, [
      'enabled',
      'serverUrl',
      'roomCode',
      'publishToken'
    ])
    this._mobxUtils.propSync(TabletCompanionMain.id, 'state', this.state, [
      'status',
      'lastPublishedAt',
      'lastError'
    ])
    this._ipcHandlers.register()
    this._publisher.watch()
  }

  async onDispose() {
    this._publisher.dispose()
  }
}
