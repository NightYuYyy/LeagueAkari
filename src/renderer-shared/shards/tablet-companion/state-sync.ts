import { TABLET_COMPANION_MAIN_NAMESPACE } from '@shared/shards/tablet-companion'

import type { TabletCompanionRendererContext } from './context'
import { useTabletCompanionStore } from './store'

export async function syncTabletCompanionState(context: TabletCompanionRendererContext) {
  const store = useTabletCompanionStore()
  await context.piniaMobxUtils.sync(TABLET_COMPANION_MAIN_NAMESPACE, 'settings', store.settings)
  await context.piniaMobxUtils.sync(TABLET_COMPANION_MAIN_NAMESPACE, 'state', store)
}
