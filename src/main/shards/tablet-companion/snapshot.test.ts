import { describe, expect, it } from 'vitest'

import type { LeagueClientMain } from '../league-client'
import { createTabletCompanionSnapshotInput } from './snapshot'

function createLeagueClient(overrides: Record<string, unknown> = {}) {
  return {
    state: { isConnected: true },
    data: {
      gameflow: {
        phase: 'ChampSelect',
        session: {
          gameData: { queue: { gameMode: 'KIWI', type: 'ARAM_MAYHEM' } }
        }
      },
      champSelect: {
        currentChampion: 22,
        disabledChampionIds: new Set<number>(),
        session: {
          localPlayerCellId: 1,
          myTeam: [{ cellId: 1, championId: 22, assignedPosition: '' }],
          actions: [[{ actorCellId: 1, type: 'pick', championId: 103 }]]
        }
      },
      ...overrides
    }
  } as unknown as LeagueClientMain
}

describe('createTabletCompanionSnapshotInput', () => {
  it('publishes the active pick and marks ARAM Mayhem', () => {
    expect(createTabletCompanionSnapshotInput(createLeagueClient())).toMatchObject({
      leagueClientConnected: true,
      phase: 'ChampSelect',
      championId: 103,
      gameMode: 'KIWI',
      queueType: 'ARAM_MAYHEM',
      isAramMayhem: true
    })
  })

  it('publishes an empty selection outside an active session', () => {
    const leagueClient = createLeagueClient()
    leagueClient.data.champSelect.session = null
    leagueClient.data.gameflow.session = null

    expect(createTabletCompanionSnapshotInput(leagueClient)).toMatchObject({
      championId: null,
      gameMode: null,
      isAramMayhem: false
    })
  })

  it('does not publish disabled champions', () => {
    const leagueClient = createLeagueClient()
    leagueClient.data.champSelect.disabledChampionIds.add(103)

    expect(createTabletCompanionSnapshotInput(leagueClient).championId).toBeNull()
  })
})
