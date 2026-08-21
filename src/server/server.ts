import { engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isServer, myProfile, syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { COUNTDOWN_MS, GROUND_Y, MAX_PLAYERS, ROPE_MAX } from '../config'
import { GameClock, MatchState, PracticeDummiesState, ScoreboardState, SyncId } from '../shared/components'
import { room } from '../shared/messages'
import { createWorld, WorldHandles } from '../world'
import { finishKey, rankTop, type FinishEntry } from '../scoreboard'

type PlayerRow = { address: string; name: string }

type PracticeSession = {
  address: string
  name: string
  pos: { x: number; y: number; z: number }
  followX: number
  followZ: number
  lastHuman: { x: number; y: number; z: number } | null
}

let world: WorldHandles
let matchEntity: Entity
let clockEntity: Entity
let boardEntity: Entity
let practiceEntity: Entity
let missingMs = new Map<string, number>()
let clockSend = 0
let beatSend = 0
let bannerSend = 0
let wonAt = 0
let boardDirty = false
let board: FinishEntry[] = []
let boardSeq = 0
let boardStorageReady = false
let boardKnownCount = 0
let boardReloadTimer = 0
let started = false
let starting = false
const practiceSessions = new Map<string, PracticeSession>()

function onlyServer(value: { senderAddress: string }) {
  return value.senderAddress === AUTH_SERVER_PEER_ID
}

function waitForNetworkProfile(): Promise<void> {
  return new Promise((resolve) => {
    if (myProfile.networkId) {
      resolve()
      return
    }
    let frames = 0
    engine.addSystem(function waitProfile() {
      frames += 1
      if (myProfile.networkId || frames > 90) {
        engine.removeSystem(waitProfile)
        if (!myProfile.networkId) {
          myProfile.userId = AUTH_SERVER_PEER_ID
          myProfile.networkId = 1
          console.log('[SERVER] Using fallback network profile')
        }
        resolve()
      }
    })
  })
}

function match() {
  return MatchState.getMutable(matchEntity)
}

function clock() {
  return GameClock.getMutable(clockEntity)
}

function practiceState() {
  return PracticeDummiesState.getMutable(practiceEntity)
}

function publishPracticeRows() {
  const rows = Array.from(practiceSessions.values()).map((session) => ({
    address: session.address,
    x: session.pos.x,
    y: session.pos.y,
    z: session.pos.z,
    hop: 0,
    yaw:
      session.lastHuman != null
        ? (Math.atan2(session.lastHuman.x - session.pos.x, session.lastHuman.z - session.pos.z) * 180) / Math.PI
        : 0
  }))
  practiceState().rows = rows
}

function startPracticeSession(address: string, name: string) {
  const slot = world.startSlots[1] ?? world.startB
  practiceSessions.set(address, {
    address,
    name,
    pos: { x: slot.x, y: slot.y, z: slot.z },
    followX: 0,
    followZ: -1.15,
    lastHuman: null
  })
  publishPracticeRows()
  console.log('[SERVER] Practice start', address, 'active=', practiceSessions.size)
}

function stopPracticeSession(address: string) {
  if (!practiceSessions.delete(address)) return
  publishPracticeRows()
  console.log('[SERVER] Practice stop', address, 'active=', practiceSessions.size)
}

function busy() {
  const phase = MatchState.get(matchEntity).phase
  return phase === 'countdown' || phase === 'playing' || phase === 'won'
}

function playerPos(address: string): Vector3 | null {
  const id = address.toLowerCase()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if ((identity.address || '').toLowerCase() !== id) continue
    const transform = Transform.getOrNull(entity)
    if (!transform) continue
    const p = transform.position
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue
    return p
  }
  return null
}

function connectedIds() {
  const ids = new Set<string>()
  for (const [_entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = (identity.address || '').toLowerCase()
    if (address) ids.add(address)
  }
  return ids
}

function xzDistance(a: Vector3, b: Vector3) {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function onPadY(p: Vector3, top: number) {
  return p.y > top - 0.5 && p.y < top + 1.35
}

function writeBoard() {
  const rows = rankTop(board).map((row) => ({
    rank: row.rank,
    timeMs: row.timeMs,
    names: row.names.join(' • '),
    key: row.key
  }))
  const state = ScoreboardState.getMutable(boardEntity)
  state.sequence = boardSeq
  state.rows = rows
}

async function persistBoard() {
  writeBoard()
  try {
    const { loadLeaderboard, mergeByBestTime, saveLeaderboard } = await import('./persist')

    // If we never confirmed Storage state, merge remote first so a failed load
    // cannot be followed by a save that wipes historical finishes.
    if (!boardStorageReady) {
      const again = await loadLeaderboard()
      if (again.status === 'ok' || again.status === 'missing') {
        boardStorageReady = true
        board = mergeByBestTime(again.top, board)
        boardSeq = Math.max(boardSeq, again.sequence)
        boardKnownCount = Math.max(boardKnownCount, again.top.length, board.length)
        writeBoard()
      } else {
        console.error('[SERVER] Skip leaderboard save until Storage is readable:', again.reason)
        boardDirty = true
        return
      }
    }

    if (board.length === 0 && boardKnownCount > 0) {
      console.error('[SERVER] Refusing to persist empty leaderboard over known history')
      const again = await loadLeaderboard()
      if (again.status === 'ok' && again.top.length > 0) {
        board = again.top
        boardSeq = Math.max(boardSeq, again.sequence)
        boardKnownCount = Math.max(boardKnownCount, again.top.length)
        writeBoard()
        boardDirty = false
        return
      }
      boardDirty = true
      return
    }

    const ok = await saveLeaderboard(boardSeq, board)
    if (ok) {
      boardKnownCount = Math.max(boardKnownCount, board.length)
      boardDirty = false
    } else {
      boardDirty = true
    }
  } catch (err) {
    console.error('[SERVER] persist import failed', err)
    boardDirty = true
  }
}

async function loadBoard() {
  try {
    const { loadLeaderboard, mergeByBestTime } = await import('./persist')
    const saved = await loadLeaderboard()
    if (saved.status === 'ok' || saved.status === 'missing') {
      boardStorageReady = true
      board = mergeByBestTime(saved.top, board)
      boardSeq = Math.max(boardSeq, saved.sequence)
      boardKnownCount = Math.max(boardKnownCount, saved.top.length, board.length)
      console.log('[SERVER] Leaderboard loaded', {
        status: saved.status,
        source: saved.status === 'ok' ? saved.source : 'none',
        sequence: boardSeq,
        entries: board.length
      })
      if (board.length > 0) {
        boardDirty = true
        void persistBoard()
      }
    } else {
      boardStorageReady = false
      console.error('[SERVER] Leaderboard load failed — keeping in-memory board, will not wipe:', saved.reason)
    }
  } catch (err) {
    boardStorageReady = false
    console.error('[SERVER] load import failed', err)
  }
  writeBoard()
}

function recordWin(players: PlayerRow[], timeMs: number) {
  const names = players.map((p) => (p.name || 'Player').trim() || 'Player')
  const addresses = players.map((p) => p.address)
  const key = finishKey(addresses)
  if (!key || timeMs <= 0) return
  const map = new Map<string, FinishEntry>()
  for (const row of board) map.set(row.key, { ...row, rank: 0 })
  const prev = map.get(key)
  if (!prev || timeMs < prev.timeMs) {
    map.set(key, { rank: 0, timeMs, names, key })
  }
  boardSeq += 1
  board = rankTop(Array.from(map.values()))
  writeBoard()
  boardDirty = true
  void persistBoard()
}

function resetMatch(keepLobby = false) {
  const state = match()
  const keepReady = keepLobby ? [...state.ready] : []
  const line = [...state.line]
  state.phase = 'lobby'
  state.players = []
  state.startAt = 0
  state.playStartedAt = 0
  state.gateStart = false
  state.gateMid = false
  state.gateFinish = false
  state.plateMidA = false
  state.plateMidB = false
  state.plateA = false
  state.plateB = false
  state.failReason = ''
  state.banner = ''
  state.ready = keepReady
  while (state.ready.length < MAX_PLAYERS && line.length > 0) {
    const next = line.shift()
    if (next) state.ready.push(next)
  }
  state.line = line
  wonAt = 0
  if (state.ready.length > 0) state.phase = 'waiting'
  clock().motionT = 0
  missingMs.clear()
}

function beginCountdown(players: PlayerRow[]) {
  const state = match()
  state.phase = 'countdown'
  state.players = players
  state.startAt = Date.now() + COUNTDOWN_MS
  state.playStartedAt = 0
  state.gateStart = false
  state.gateMid = false
  state.gateFinish = false
  state.plateMidA = false
  state.plateMidB = false
  state.plateA = false
  state.plateB = false
  state.failReason = ''
  state.banner = '5'
  state.ready = []
  clock().motionT = 0
  missingMs.clear()
}

function beginPlay() {
  const state = match()
  state.phase = 'playing'
  state.playStartedAt = Date.now()
  state.gateStart = true
  state.banner = 'GO!'
  clock().motionT = 0
}

function toggleReady(address: string, name: string) {
  const state = match()
  if (busy()) {
    const inMatch = state.players.some((p) => p.address === address)
    if (inMatch) return
    const queued = state.line.some((p) => p.address === address)
    state.line = queued ? state.line.filter((p) => p.address !== address) : [...state.line, { address, name }]
    state.ready = state.ready.filter((p) => p.address !== address)
    return
  }
  const linked = state.ready.some((p) => p.address === address)
  if (linked) {
    state.ready = state.ready.filter((p) => p.address !== address)
  } else if (state.ready.length < MAX_PLAYERS) {
    state.ready = [...state.ready, { address, name }]
    state.line = state.line.filter((p) => p.address !== address)
  }
  state.phase = state.ready.length > 0 ? 'waiting' : 'lobby'
}

function plates(positions: Vector3[], a: Vector3, b: Vector3) {
  let plateA = false
  let plateB = false
  for (const p of positions) {
    if (xzDistance(p, a) < 1.15 && onPadY(p, a.y)) plateA = true
    if (xzDistance(p, b) < 1.15 && onPadY(p, b.y)) plateB = true
  }
  return { plateA, plateB, both: plateA && plateB }
}

function steerSessionToFreePlate(session: PracticeSession, human: Vector3): boolean {
  const pairs = [
    [world.plateAPos, world.plateBPos],
    [world.midPlateAPos, world.midPlateBPos]
  ]
  for (const [a, b] of pairs) {
    const onA = xzDistance(human, a) < 1.2 && onPadY(human, a.y)
    const onB = xzDistance(human, b) < 1.2 && onPadY(human, b.y)
    if (onA) {
      session.pos.x += (b.x - session.pos.x) * 0.28
      session.pos.z += (b.z - session.pos.z) * 0.28
      session.pos.y = human.y
      return true
    }
    if (onB) {
      session.pos.x += (a.x - session.pos.x) * 0.28
      session.pos.z += (a.z - session.pos.z) * 0.28
      session.pos.y = human.y
      return true
    }
  }
  return false
}

function tickPracticeSessions(dt: number) {
  if (practiceSessions.size === 0) {
    if (practiceState().rows.length) practiceState().rows = []
    return
  }

  const online = connectedIds()
  let changed = false
  for (const address of [...practiceSessions.keys()]) {
    if (!online.has(address)) {
      practiceSessions.delete(address)
      changed = true
      continue
    }
    const session = practiceSessions.get(address)!
    const player = playerPos(address)
    if (!player) continue

    if (!steerSessionToFreePlate(session, player)) {
      if (session.lastHuman) {
        const dx = player.x - session.lastHuman.x
        const dz = player.z - session.lastHuman.z
        const len = Math.hypot(dx, dz)
        if (len > 0.04) {
          session.followX = (-dx / len) * 1.15
          session.followZ = (-dz / len) * 1.15
        }
      }
      session.lastHuman = { x: player.x, y: player.y, z: player.z }
      const targetX = player.x + session.followX
      const targetZ = player.z + session.followZ
      const t = Math.min(1, dt * 2.4)
      session.pos.x += (targetX - session.pos.x) * t
      session.pos.z += (targetZ - session.pos.z) * t
      session.pos.y = player.y
      const ox = session.pos.x - player.x
      const oz = session.pos.z - player.z
      const sep = Math.hypot(ox, oz)
      const cap = ROPE_MAX + 0.85
      if (sep > cap && sep > 0.001) {
        session.pos.x = player.x + (ox / sep) * cap
        session.pos.z = player.z + (oz / sep) * cap
      }
    } else {
      session.lastHuman = { x: player.x, y: player.y, z: player.z }
    }
    changed = true
  }

  if (changed) publishPracticeRows()
}

function tickMatch(dt: number) {
  const state = match()
  const clk = clock()
  beatSend += dt
  if (beatSend >= 1) {
    beatSend = 0
    clk.heartbeat = Date.now()
  }
  clockSend += dt
  if (state.phase === 'playing' || state.phase === 'won') {
    clk.motionT = Math.max(0, (Date.now() - Number(state.playStartedAt)) / 1000)
  } else if (clockSend >= 0.25) {
    clk.motionT = 0
  }
  if (clockSend >= 0.1) clockSend = 0

  tickPracticeSessions(dt)

  if (state.phase === 'countdown') {
    const left = Number(state.startAt) - Date.now()
    bannerSend += dt
    if (bannerSend >= 0.2) {
      bannerSend = 0
      state.banner = String(Math.max(1, Math.ceil(left / 1000)))
    }
    if (left <= 0) beginPlay()
  } else if (state.phase === 'playing') {
    if (state.banner === 'GO!' && clk.motionT > 1.2) state.banner = ''
  } else if (state.phase === 'won') {
    if (wonAt && Date.now() - wonAt > 8000) state.banner = ''
  }

  // During the run (and after a win), a canyon fall resets so the team can queue again.
  if (state.phase !== 'countdown' && state.phase !== 'playing' && state.phase !== 'won') return

  const online = connectedIds()
  const positions: Vector3[] = []
  let fallen = false
  for (const player of state.players) {
    const pos = playerPos(player.address)
    if (!pos) {
      if (state.phase !== 'won' && !online.has(player.address)) {
        missingMs.set(player.address, (missingMs.get(player.address) || 0) + dt)
        if ((missingMs.get(player.address) || 0) > 2.5) {
          console.log('[SERVER] Player left during run', player.address)
          resetMatch()
          return
        }
      }
      continue
    }
    missingMs.set(player.address, 0)
    positions.push(pos)
    if (pos.y < GROUND_Y) fallen = true
  }
  if (fallen) {
    resetMatch()
    return
  }
  if (state.phase !== 'playing' || positions.length === 0) return

  const mid = plates(positions, world.midPlateAPos, world.midPlateBPos)
  state.plateMidA = mid.plateA
  state.plateMidB = mid.plateB
  if (mid.both) state.gateMid = true

  const finishPlates = plates(positions, world.plateAPos, world.plateBPos)
  state.plateA = finishPlates.plateA
  state.plateB = finishPlates.plateB
  if (finishPlates.both) state.gateFinish = true

  if (state.gateFinish) {
    const top = world.finishCenter.y
    const allIn = state.players.every((player) => {
      const pos = playerPos(player.address)
      return pos ? xzDistance(pos, world.finishCenter) < 1.45 && onPadY(pos, top) : false
    })
    if (allIn) {
      const timeMs = Math.max(1, Math.round(clk.motionT * 1000))
      state.phase = 'won'
      state.banner = 'You are in the ZONE!'
      wonAt = Date.now()
      recordWin([...state.players], timeMs)
    }
  }
}

export async function initServer(existingWorld?: WorldHandles) {
  if (started || starting) return
  starting = true
  try {
    await waitForNetworkProfile()
    if (started) return

    try {
      MatchState.validateBeforeChange(onlyServer)
      GameClock.validateBeforeChange(onlyServer)
      ScoreboardState.validateBeforeChange(onlyServer)
      PracticeDummiesState.validateBeforeChange(onlyServer)
    } catch (err) {
      console.error('[SERVER] validateBeforeChange failed', err)
    }

    world = existingWorld ?? createWorld()

    matchEntity = engine.addEntity()
    MatchState.create(matchEntity, {
      phase: 'lobby',
      startAt: 0,
      playStartedAt: 0,
      ready: [],
      line: [],
      players: [],
      gateStart: false,
      gateMid: false,
      gateFinish: false,
      plateMidA: false,
      plateMidB: false,
      plateA: false,
      plateB: false,
      failReason: '',
      banner: ''
    })
    syncEntity(matchEntity, [MatchState.componentId], SyncId.Match)

    clockEntity = engine.addEntity()
    GameClock.create(clockEntity, { motionT: 0, heartbeat: Date.now() })
    syncEntity(clockEntity, [GameClock.componentId], SyncId.Clock)

    boardEntity = engine.addEntity()
    ScoreboardState.create(boardEntity, { sequence: 0, rows: [] })
    await loadBoard()
    syncEntity(boardEntity, [ScoreboardState.componentId], SyncId.Board)

    practiceEntity = engine.addEntity()
    PracticeDummiesState.create(practiceEntity, { rows: [] })
    syncEntity(practiceEntity, [PracticeDummiesState.componentId], SyncId.PracticeDummies)

    room.onMessage('join', (data, context) => {
      if (!context?.from) return
      toggleReady(context.from.toLowerCase(), data.name || 'Player')
    })
    room.onMessage('lineJoin', (data, context) => {
      if (!context?.from) return
      const address = context.from.toLowerCase()
      const state = match()
      if (state.players.some((p) => p.address === address)) return
      if (state.line.some((p) => p.address === address)) return
      state.line = [...state.line, { address, name: data.name || 'Player' }]
      state.ready = state.ready.filter((p) => p.address !== address)
    })
    room.onMessage('lineLeave', (_data, context) => {
      if (!context?.from) return
      const address = context.from.toLowerCase()
      match().line = match().line.filter((p) => p.address !== address)
    })
    room.onMessage('start', (_data, context) => {
      if (!context?.from) return
      const state = match()
      if (busy()) return
      if (state.ready.length < 2 || state.ready.length > MAX_PLAYERS) return
      if (!state.ready.some((p) => p.address === context.from.toLowerCase())) return
      beginCountdown([...state.ready])
    })
    room.onMessage('practiceStart', (data, context) => {
      if (!context?.from) return
      const address = context.from.toLowerCase()
      // Practice is independent of the linked match — many players can practice together.
      if (busy() && match().players.some((p) => p.address === address)) return
      startPracticeSession(address, (data.name || 'Player').trim() || 'Player')
    })
    room.onMessage('practiceStop', (_data, context) => {
      if (!context?.from) return
      stopPracticeSession(context.from.toLowerCase())
    })
    room.onMessage('leave', (_data, context) => {
      if (!context?.from) return
      const address = context.from.toLowerCase()
      stopPracticeSession(address)
      const state = match()
      if (busy() && state.players.some((p) => p.address === address)) {
        resetMatch()
        return
      }
      state.ready = state.ready.filter((p) => p.address !== address)
      state.line = state.line.filter((p) => p.address !== address)
      if (!busy()) state.phase = state.ready.length > 0 ? 'waiting' : 'lobby'
    })
    room.onMessage('reset', (_data, context) => {
      if (!context?.from) return
      const address = context.from.toLowerCase()
      const state = match()
      // Ending a local practice run should not reset a real match for everyone.
      if (practiceSessions.has(address)) {
        stopPracticeSession(address)
        return
      }
      if (!busy()) {
        state.ready = state.ready.filter((p) => p.address !== address)
        state.line = state.line.filter((p) => p.address !== address)
        state.phase = state.ready.length > 0 ? 'waiting' : 'lobby'
        return
      }
      if (!state.players.some((p) => p.address === address)) return
      resetMatch()
    })

    engine.addSystem((dt) => {
      tickMatch(dt)
      boardReloadTimer += dt
      if (boardReloadTimer >= 45) {
        boardReloadTimer = 0
        void loadBoard()
      }
      if (boardDirty) void persistBoard()
    })

    started = true
    console.log('[SERVER] Match authority online')
  } catch (err) {
    console.error('[SERVER] Failed to start match authority', err)
  } finally {
    starting = false
  }
}

export function bootServer(existingWorld: WorldHandles) {
  const start = () => {
    void initServer(existingWorld)
  }
  if (isServer()) {
    start()
    return
  }
  engine.addSystem(function waitForServerFlag() {
    if (!isServer()) return
    engine.removeSystem(waitForServerFlag)
    start()
  })
}
