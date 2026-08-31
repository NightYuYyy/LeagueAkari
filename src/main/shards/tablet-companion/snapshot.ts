import type { TabletCompanionGameSnapshot } from '@shared/shards/tablet-companion'

import type { LeagueClientMain } from '../league-client'

export function createTabletCompanionSnapshotInput(
  leagueClient: LeagueClientMain
): Omit<TabletCompanionGameSnapshot, 'publishedAt'> {
  const champSelect = leagueClient.data.champSelect
  const gameflowSession = leagueClient.data.gameflow.session
  const champSelectSession = champSelect.session

  if (!champSelectSession || !gameflowSession) {
    return {
      leagueClientConnected: leagueClient.state.isConnected,
      phase: leagueClient.data.gameflow.phase ?? null,
      championId: null,
      gameMode: gameflowSession?.gameData.queue.gameMode ?? null,
      queueType: gameflowSession?.gameData.queue.type ?? null,
      assignedPosition: null,
      isAramMayhem: gameflowSession?.gameData.queue.gameMode === 'KIWI'
    }
  }

  const selfCellId = champSelectSession.localPlayerCellId
  const self = champSelectSession.myTeam.find((player) => player.cellId === selfCellId)
  const actionChampionId = champSelectSession.actions
    .flat(1)
    .find(
      (action) =>
        action.actorCellId === selfCellId && action.type === 'pick' && action.championId > 0
    )?.championId
  const championId = actionChampionId ?? self?.championId ?? champSelect.currentChampion

  return {
    leagueClientConnected: leagueClient.state.isConnected,
    phase: leagueClient.data.gameflow.phase ?? null,
    championId:
      championId &&
      championId > 0 &&
      championId !== -3 &&
      !champSelect.disabledChampionIds.has(championId)
        ? championId
        : null,
    gameMode: gameflowSession.gameData.queue.gameMode,
    queueType: gameflowSession.gameData.queue.type,
    assignedPosition: self?.assignedPosition ?? null,
    isAramMayhem: gameflowSession.gameData.queue.gameMode === 'KIWI'
  }
}
