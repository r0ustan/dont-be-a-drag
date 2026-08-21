import { engine, InputModifier } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { isServer as isServerQuery } from '~system/EngineApi'
import { setupGame } from './game'
import { bootServer, initServer } from './server/server'
import { setupScoreboard } from './scoreboard'
import { setupUi } from './ui'
import { createWorld } from './world'
import './shared/messages'

function setupClient() {
  try {
    InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({ disableGliding: true })
    })
  } catch (err) {
    console.error('[CLIENT] InputModifier failed', err)
  }
  setupUi()
  setupScoreboard()
}

export function main() {
  const world = createWorld()
  bootServer(world)

  void isServerQuery({})
    .then((res) => {
      if (res.isServer) void initServer(world)
    })
    .catch((err) => console.error('[SERVER] isServer query failed', err))

  if (isServer()) {
    void initServer(world)
    return
  }

  try {
    setupClient()
    setupGame(world)
  } catch (err) {
    console.error('[CLIENT] setup failed', err)
  }
}
