import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  join: Schemas.Map({ name: Schemas.String }),
  leave: Schemas.Map({}),
  lineJoin: Schemas.Map({ name: Schemas.String }),
  lineLeave: Schemas.Map({}),
  start: Schemas.Map({}),
  practiceStart: Schemas.Map({ name: Schemas.String }),
  practiceStop: Schemas.Map({}),
  reset: Schemas.Map({})
}

// Must run at module load, before the engine seals.
export const room = registerMessages(Messages)
