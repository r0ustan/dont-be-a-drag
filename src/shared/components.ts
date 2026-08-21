import { engine, Schemas } from '@dcl/sdk/ecs'

export const SyncId = {
  Match: 1,
  Clock: 2,
  Board: 3,
  PracticeDummy: 4
}

const PlayerRow = Schemas.Map({
  address: Schemas.String,
  name: Schemas.String
})

const BoardRow = Schemas.Map({
  rank: Schemas.Int,
  timeMs: Schemas.Int,
  names: Schemas.String,
  key: Schemas.String
})

export const MatchState = engine.defineComponent('dontbeadrag:MatchState', {
  phase: Schemas.String,
  startAt: Schemas.Int64,
  playStartedAt: Schemas.Int64,
  ready: Schemas.Array(PlayerRow),
  line: Schemas.Array(PlayerRow),
  players: Schemas.Array(PlayerRow),
  practice: Schemas.Boolean,
  gateStart: Schemas.Boolean,
  gateMid: Schemas.Boolean,
  gateFinish: Schemas.Boolean,
  plateMidA: Schemas.Boolean,
  plateMidB: Schemas.Boolean,
  plateA: Schemas.Boolean,
  plateB: Schemas.Boolean,
  failReason: Schemas.String,
  banner: Schemas.String
})

export const GameClock = engine.defineComponent('dontbeadrag:GameClock', {
  motionT: Schemas.Float,
  heartbeat: Schemas.Int64
})

export const ScoreboardState = engine.defineComponent('dontbeadrag:ScoreboardState', {
  sequence: Schemas.Int,
  rows: Schemas.Array(BoardRow)
})

/** Server-authored practice dummy pose — all clients render from this. */
export const PracticeDummyState = engine.defineComponent('dontbeadrag:PracticeDummyState', {
  active: Schemas.Boolean,
  x: Schemas.Float,
  y: Schemas.Float,
  z: Schemas.Float,
  hop: Schemas.Float,
  yaw: Schemas.Float
})
