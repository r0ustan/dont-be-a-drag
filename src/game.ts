import {
  engine,
  GltfContainer,
  Physics,
  PlayerIdentityData,
  Transform
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer, onLeaveScene } from '@dcl/sdk/players'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'
import {
  AFK_IDLE_SEC,
  AFK_MOVE_EPS,
  AFK_PROMPT_SEC,
  COUNTDOWN_MS,
  FALL_Y,
  GROUND_Y,
  MAX_PLAYERS,
  PLATFORM_TOP,
  ROPE_DEADZONE,
  ROPE_LINES,
  ROPE_MAX,
  ROPE_MAX_FORCE,
  ROPE_SOFT,
  ROPE_STIFFNESS,
  SPAWN_Y,
  SPECTATE_LOOK,
  SPECTATE_POS
} from './config'
import {
  noteGate,
  notePads,
  playDeath,
  playGong,
  playWilhelm,
  playWin,
  resetAudioCues,
  setMusicBed,
  setupAudio
} from './audio'
import { onDeck, parkMovers, startMovers, tickFlameHazards, tickMovers } from './movers'
import { createRope, hideRope, updateRopes } from './rope'
import { hud, Phase, setHud, uiActions } from './state'
import { setGateOpen, setPlateLit, WorldHandles } from './world'
import { tickScoreboard } from './scoreboard'
import { GameClock, MatchState, PracticeDummiesState } from './shared/components'
import { room } from './shared/messages'

type LobbyPlayer = { address: string; name: string }

type Match = {
  phase: Phase
  players: LobbyPlayer[]
  startAt: number
  playStartedAt: number
  failReason: string
}

const DUMMY_ID = 'practice-dummy'

type DummyPartner = {
  root: ReturnType<typeof engine.addEntity>
  pos: Vector3.Mutable
  vx: number
  vz: number
  knockCd: number
  hop: number
}

const match: Match = {
  phase: 'lobby',
  players: [],
  startAt: 0,
  playStartedAt: 0,
  failReason: ''
}

let matchPractice = false
const ready = new Map<string, LobbyPlayer>()
const line = new Map<string, LobbyPlayer>()
let world: WorldHandles
let dummy: DummyPartner | null = null
const remoteDummies = new Map<string, ReturnType<typeof engine.addEntity>>()
let gateOpen = false
let midGateOpen = false
let respawnLock = 0
let standCoyote = 0
let ropeForceSource: ReturnType<typeof engine.addEntity> | null = null
const lastKnown = new Map<string, Vector3>()
let lastClockT = 0
let lastClockAt = 0
let lastHeartbeat = 0
let beatAge = 99
let seenPhase: Phase = 'lobby'
let seenPlayStartedAt = 0
let netReady = false
let pendingJoin = false
let connectingAge = 0
let spectateWait = false
let bannerText = ''
let bannerAt = 0
let afkIdle = 0
let afkPromptLeft = 0
let afkLastPos: Vector3 | null = null
let afkArmed = false

function myId() {
  return (getPlayer()?.userId ?? '').toLowerCase()
}

function myName() {
  return getPlayer()?.name || 'Adventurer'
}

function xzDistance(a: Vector3, b: Vector3) {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function isTrackedPos(p: { x: number; y: number; z: number } | undefined | null): p is { x: number; y: number; z: number } {
  if (!p) return false
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false
  if (Math.abs(p.x) < 0.05 && Math.abs(p.y) < 0.05 && Math.abs(p.z) < 0.05) return false
  return true
}

function standing(p: Vector3) {
  return onDeck(p, world.decks, world.movers)
}

function localStanding(p: Vector3) {
  if (standing(p)) {
    standCoyote = 0.4
    return true
  }
  return standCoyote > 0
}

function getPosition(userId: string): Vector3 | null {
  const id = userId.toLowerCase()
  if (id === DUMMY_ID) return dummy ? Vector3.clone(dummy.pos) : null
  const local = getPlayer()
  if (local && local.userId.toLowerCase() === id && Transform.has(engine.PlayerEntity)) {
    const pos = Transform.get(engine.PlayerEntity).position
    return isTrackedPos(pos) ? Vector3.clone(pos) : null
  }

  const tracked = getPlayer({ userId }) ?? getPlayer({ userId: id })
  if (isTrackedPos(tracked?.position)) {
    return Vector3.create(tracked.position.x, tracked.position.y, tracked.position.z)
  }

  for (const [entity, data] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (data.address.toLowerCase() !== id) continue
    if (Transform.has(entity)) {
      const pos = Transform.get(entity).position
      if (isTrackedPos(pos)) return Vector3.clone(pos)
    }
  }

  return null
}

function liveOrLast(id: string): Vector3 | null {
  const found = getPosition(id)
  if (found) {
    lastKnown.set(id, Vector3.clone(found))
    return found
  }
  const cached = lastKnown.get(id)
  return cached ? Vector3.clone(cached) : null
}

function localPos() {
  if (!Transform.has(engine.PlayerEntity)) return Vector3.create(10, PLATFORM_TOP, 9)
  return Vector3.clone(Transform.get(engine.PlayerEntity).position)
}

function readMatch() {
  for (const [_entity, state] of engine.getEntitiesWith(MatchState)) return state
  return null
}

function readClock() {
  for (const [_entity, state] of engine.getEntitiesWith(GameClock)) return state
  return null
}

function createDummy(): DummyPartner {
  const root = engine.addEntity()
  const pos = Vector3.create(10, PLATFORM_TOP, 11)
  Transform.create(root, { position: pos, scale: Vector3.create(1, 1, 1) })
  GltfContainer.create(root, { src: 'models/dummy.glb' })
  return { root, pos, vx: 0, vz: 0, knockCd: 0, hop: 0 }
}

function hideDummy() {
  if (!dummy) return
  dummy.vx = 0
  dummy.vz = 0
  dummy.knockCd = 0
  dummy.hop = 0
  Transform.getMutable(dummy.root).position = Vector3.create(0, -10, 0)
}

function updateDummy(dt: number, player: Vector3) {
  if (!dummy) dummy = createDummy()
  dummy.knockCd = Math.max(0, dummy.knockCd - dt)
  dummy.hop = Math.max(0, dummy.hop - dt * 2.4)
  const cam = Transform.has(engine.CameraEntity) ? Transform.get(engine.CameraEntity).rotation : Quaternion.Identity()
  const forward = Vector3.rotate(Vector3.Forward(), cam)
  forward.y = 0
  if (Vector3.length(forward) < 0.05) {
    forward.x = 0
    forward.z = 1
  } else {
    Vector3.normalizeToRef(forward, forward)
  }
  const target = Vector3.create(player.x - forward.x * 1.15, player.y, player.z - forward.z * 1.15)
  const sep = Math.hypot(player.x - dummy.pos.x, player.z - dummy.pos.z)
  let chase = 2.4
  if (dummy.knockCd > 0) chase = 0.28
  else if (sep > ROPE_MAX) chase = 1.05
  else if (sep > ROPE_SOFT) chase = 1.45
  dummy.pos = Vector3.lerp(dummy.pos, target, Math.min(1, dt * chase))
  dummy.pos.y = target.y
  dummy.pos.x += dummy.vx * dt
  dummy.pos.z += dummy.vz * dt
  const damp = Math.exp(-5.5 * dt)
  dummy.vx *= damp
  dummy.vz *= damp
  const dx = dummy.pos.x - player.x
  const dz = dummy.pos.z - player.z
  const after = Math.hypot(dx, dz)
  const cap = dummy.knockCd > 0 ? ROPE_MAX + 1.6 : ROPE_MAX + 0.85
  if (after > cap && after > 0.001) {
    dummy.pos.x = player.x + (dx / after) * cap
    dummy.pos.z = player.z + (dz / after) * cap
  }
  const t = Transform.getMutable(dummy.root)
  t.position = Vector3.create(dummy.pos.x, dummy.pos.y + dummy.hop, dummy.pos.z)
  const yaw = Math.atan2(forward.x, forward.z) * (180 / Math.PI)
  const leanZ = Math.max(-22, Math.min(22, dummy.vx * 3.2))
  const leanX = Math.max(-22, Math.min(22, dummy.vz * 3.2))
  t.rotation = Quaternion.fromEulerDegrees(leanX, yaw, -leanZ)
  const squash = dummy.knockCd > 0.35 ? 0.82 : 1
  t.scale = Vector3.create(1, squash, 1)
}

function selfPlayer() {
  const me = myId()
  return match.players.find((p) => p.address === me)
}

function teammates(): LobbyPlayer[] {
  const self = selfPlayer()
  if (!self) return []
  return match.players.filter((p) => p.address !== self.address)
}

function iAmLinked() {
  const me = myId()
  if (matchPractice && (match.phase === 'countdown' || match.phase === 'playing' || match.phase === 'won')) return true
  if (match.phase === 'countdown' || match.phase === 'playing' || match.phase === 'won') {
    return match.players.some((p) => p.address === me)
  }
  return ready.has(me)
}

function iAmInMatch() {
  const me = myId()
  if (!me) return false
  return match.players.some((p) => p.address === me)
}

function matchBusy() {
  return match.phase === 'countdown' || match.phase === 'playing' || match.phase === 'won'
}

function inStartCage(p: Vector3) {
  return (
    p.x > 1.2 &&
    p.x < 18.8 &&
    p.z > 2.2 &&
    p.z < 15.25 &&
    p.y > PLATFORM_TOP - 0.8 &&
    p.y < PLATFORM_TOP + 16
  )
}

function lineRoster() {
  const people = [...line.values()]
  const names = people.map((p) => p.name).join(' • ')
  return names ? `In line ${people.length}  ${names}` : 'In line: empty'
}

function refreshLineHud() {
  const me = myId()
  const ids = [...line.keys()]
  const pos = ids.indexOf(me) + 1
  const queued = pos > 0
  setHud({
    iAmPlaying: false,
    inQueue: queued,
    iAmReady: queued,
    canStart: false,
    roster: lineRoster(),
    partnerName: lineRoster(),
    subtitle: queued
      ? `You're #${pos} of ${line.size} in line. Wait for this run to finish.`
      : 'A run is in progress. Link up to wait in line for the next match.',
    hint: queued
      ? 'Stay in the start room. The course resets when this match ends, then it is your turn.'
      : 'Extra players cannot start until this run is over. Link up to get in line.'
  })
}

function applyLobbyMaps(nextReady?: LobbyPlayer[], nextLine?: LobbyPlayer[]) {
  if (nextReady) {
    ready.clear()
    for (const row of nextReady) {
      if (!row?.address) continue
      const address = row.address.toLowerCase()
      ready.set(address, { address, name: row.name || 'Player' })
    }
  }
  if (nextLine) {
    line.clear()
    for (const row of nextLine) {
      if (!row?.address) continue
      const address = row.address.toLowerCase()
      line.set(address, { address, name: row.name || 'Player' })
    }
  }
}

function canStartNow() {
  if (match.phase !== 'lobby' && match.phase !== 'waiting') return false
  return ready.size >= 2 && ready.size <= MAX_PLAYERS
}

function rosterLine() {
  const people = [...ready.values()]
  const names = people.map((p) => p.name).join(' • ')
  return names ? `Co-op ${people.length}/${MAX_PLAYERS}  ${names}` : `Co-op 0/${MAX_PLAYERS}`
}

function partnerNames() {
  return teammates()
    .map((p) => p.name)
    .join(' • ')
}

function refreshLobbyHud() {
  if (match.phase !== 'lobby' && match.phase !== 'waiting') return
  match.phase = ready.size > 0 ? 'waiting' : 'lobby'
  const startable = canStartNow() && hud.serverReady
  setHud({
    phase: match.phase,
    readyCount: ready.size,
    iAmReady: ready.has(myId()),
    iAmPlaying: false,
    inQueue: false,
    canStart: startable,
    roster: rosterLine(),
    partnerName: rosterLine(),
    subtitle: startable ? 'Press Start when your group is ready' : lobbyHint(),
    hint: lobbyHint()
  })
}

function lobbyHint() {
  if (!hud.serverReady) {
    if (connectingAge > 8) return 'Match server is waking up… Link Up will retry automatically.'
    return 'Connecting to the match server…'
  }
  if (ready.size < 2) return 'Co-op needs 2-4 players. Link up, then Start.'
  return 'Press Start whenever your team is ready (2-4).'
}

const WIN_BANNER = 'You are in the ZONE!'
const WIN_BANNER_MS = 8000
const WIN_FADE_MS = 3000

function flashBanner(text: string) {
  const now = Date.now()
  if (text !== bannerText) {
    bannerText = text
    bannerAt = now
  }
  const age = now - bannerAt
  let shown = text
  if (text === 'GO!' && age > 1200) shown = ''
  if (text === WIN_BANNER && age > WIN_BANNER_MS) shown = ''
  let alpha = shown ? 1 : 0
  if (text === WIN_BANNER && shown) {
    const fadeStart = WIN_BANNER_MS - WIN_FADE_MS
    if (age > fadeStart) alpha = Math.max(0, 1 - (age - fadeStart) / WIN_FADE_MS)
  }
  hud.bannerAlpha = alpha
  return shown
}

function courseGate(gate: ReturnType<typeof engine.addEntity>, open: boolean, closedY: number, drop?: number) {
  noteGate(gate as number, open)
  if (drop === undefined) setGateOpen(gate, open, closedY)
  else setGateOpen(gate, open, closedY, drop)
}

function applyCourse(state: ReturnType<typeof MatchState.get>) {
  gateOpen = !!state.gateFinish
  midGateOpen = !!state.gateMid
  notePads('mid', !!state.plateMidA && !!state.plateMidB)
  notePads('finish', !!state.plateA && !!state.plateB)
  courseGate(world.startGate, !!state.gateStart, world.startGateClosedY, 20)
  courseGate(world.midGate, !!state.gateMid, world.midGateClosedY)
  courseGate(world.gate, !!state.gateFinish, world.gateClosedY)
  setPlateLit(world.midPlateA, !!state.plateMidA)
  setPlateLit(world.midPlateB, !!state.plateMidB)
  setPlateLit(world.plateA, !!state.plateA)
  setPlateLit(world.plateB, !!state.plateB)
}

function resetVisuals() {
  lastKnown.clear()
  gateOpen = false
  midGateOpen = false
  courseGate(world.gate, false, world.gateClosedY)
  courseGate(world.midGate, false, world.midGateClosedY)
  courseGate(world.startGate, false, world.startGateClosedY, 20)
  setPlateLit(world.plateA, false)
  setPlateLit(world.plateB, false)
  setPlateLit(world.midPlateA, false)
  setPlateLit(world.midPlateB, false)
  resetAudioCues()
  bannerText = ''
  bannerAt = 0
  hud.bannerAlpha = 1
  clearRope()
  hideDummy()
  if (world?.movers) parkMovers(world.movers)
  lastClockT = 0
  lastClockAt = 0
}

function syncMusicBed() {
  if (match.phase === 'playing' && (iAmInMatch() || matchPractice)) {
    setMusicBed('music')
    return
  }
  if (match.phase === 'won' && (iAmInMatch() || matchPractice)) {
    setMusicBed('off')
    return
  }
  setMusicBed('lobby')
}

function beginCountdown(players: LobbyPlayer[], startAt: number) {
  match.phase = 'countdown'
  match.players = players.map((p) => ({ ...p, address: p.address.toLowerCase() }))
  match.startAt = startAt
  match.playStartedAt = 0
  match.failReason = ''
  lastKnown.clear()
  matchPractice = players.some((p) => p.address.toLowerCase() === DUMMY_ID)
  clearAfk()
  resetVisuals()
  respawnAtStart(true)
  const playing = iAmInMatch()
  if (!playing) {
    setHud({
      phase: 'countdown',
      banner: '',
      practice: false,
      canStart: false,
      iAmPlaying: false,
      howToOpen: false
    })
    refreshLineHud()
    return
  }
  setHud({
    phase: 'countdown',
    subtitle: matchPractice ? 'Practice dummy is linked' : `Team of ${match.players.length}`,
    hint: 'Get ready — the rope goes live in a moment',
    partnerName: matchPractice ? 'Dummy' : partnerNames(),
    roster: matchPractice ? 'Dummy' : partnerNames(),
    practice: matchPractice,
    banner: flashBanner('5'),
    bannerAlpha: 1,
    readyCount: match.players.length,
    iAmReady: true,
    iAmPlaying: true,
    inQueue: false,
    howToOpen: false,
    canStart: false
  })
}

function beginPlay() {
  match.phase = 'playing'
  match.playStartedAt = Date.now()
  lastClockT = 0
  lastClockAt = Date.now()
  if (world?.movers) startMovers(world.movers)
  courseGate(world.startGate, true, world.startGateClosedY, 20)
  setMusicBed('music')
  playGong()
  if (!iAmInMatch()) {
    setHud({ phase: 'playing', banner: '', timeMs: 0, iAmPlaying: false, canStart: false })
    refreshLineHud()
    return
  }
  setHud({
    phase: 'playing',
    timeMs: 0,
    iAmPlaying: true,
    inQueue: false,
    subtitle: matchPractice ? 'Practice run' : `Linked with ${partnerNames()}`,
    hint: matchPractice
      ? 'The dummy stays close. Climb, ride, and dodge.'
      : "Don't be a drag. Climb, ride, and dodge together.",
    banner: flashBanner('GO!')
  })
}

function showWin(timeMs: number) {
  match.phase = 'won'
  playWin()
  clearRope()
  clearAfk()
  const secs = Math.max(1, Math.round(timeMs / 1000))
  if (!iAmInMatch()) {
    setHud({ phase: 'won', banner: '', resultDismissed: true, iAmPlaying: false, canStart: false })
    refreshLineHud()
    return
  }
  setHud({
    phase: 'won',
    timeMs,
    subtitle: `Completed in ${secs}s`,
    hint: 'Jump into the canyon to play again.',
    banner: flashBanner(WIN_BANNER),
    resultDismissed: true
  })
  void triggerEmote({ predefinedEmote: 'clap' })
}

function resetToLobby() {
  if (matchPractice) void room.send('practiceStop', {})
  match.phase = 'lobby'
  match.players = []
  match.startAt = 0
  match.playStartedAt = 0
  match.failReason = ''
  matchPractice = false
  spectateWait = false
  clearAfk()
  resetVisuals()
  hideDummy()
  setHud({
    phase: 'lobby',
    subtitle: 'Find 2-4 players and link up',
    hint: 'Link up, then press Start when your team is ready.',
    partnerName: '',
    tension: 0,
    timeMs: 0,
    readyCount: ready.size,
    practice: false,
    banner: '',
    iAmReady: ready.has(myId()),
    iAmPlaying: false,
    inQueue: line.has(myId()),
    resultDismissed: false,
    spectatePrompt: false,
    afkPrompt: false,
    afkSecondsLeft: 0,
    roster: rosterLine(),
    canStart: false
  })
  refreshLobbyHud()
}

function clickJoin() {
  const address = myId()
  if (matchBusy() && address && !iAmInMatch()) {
    if (line.has(address) || spectateWait) {
      spectateWait = false
      setHud({ spectatePrompt: false })
      void room.send('lineLeave', {})
      return
    }
    setHud({ spectatePrompt: true, howToOpen: false })
    return
  }
  if (match.phase === 'playing' || match.phase === 'countdown') {
    setHud({ hint: 'A run is already in progress' })
    return
  }
  if (address && ready.has(address)) {
    pendingJoin = false
    void room.send('leave', {})
    return
  }
  if (ready.size >= MAX_PLAYERS) {
    setHud({ hint: 'Lobby is full (4 players)' })
    return
  }
  pendingJoin = true
  flushJoin()
}

function clickSpectateYes() {
  setHud({ spectatePrompt: false })
  if (!matchBusy() || iAmInMatch()) return
  spectateWait = true
  if (!line.has(myId())) void room.send('lineJoin', { name: myName() })
  teleportToSpectate()
}

function clickSpectateNo() {
  spectateWait = false
  setHud({ spectatePrompt: false })
}

function teleportToSpectate() {
  respawnLock = 0.85
  void movePlayerTo({
    newRelativePosition: SPECTATE_POS,
    cameraTarget: SPECTATE_LOOK
  })
}

function flushJoin() {
  if (!pendingJoin) return
  const address = myId()
  if (!address) return
  if (!isStateSyncronized() && !netReady && !room.isReady()) return
  if (ready.has(address) || ready.size >= MAX_PLAYERS) {
    pendingJoin = false
    return
  }
  pendingJoin = false
  void room.send('join', { name: myName() })
}

function clickPractice() {
  // Only block while a real linked match occupies the course.
  if (matchBusy() && !matchPractice) {
    setHud({ hint: 'A linked match is in progress. Wait for the next run.' })
    return
  }
  if (matchPractice) {
    setHud({ hint: 'You are already in a practice run.' })
    return
  }
  if (!room.isReady() && !netReady) {
    setHud({ hint: 'Still connecting to the match server…' })
    return
  }
  dummy = dummy ?? createDummy()
  dummy.pos = Vector3.clone(world.startB)
  dummy.vx = 0
  dummy.vz = 0
  dummy.knockCd = 0
  dummy.hop = 0
  void room.send('practiceStart', { name: myName() })
  beginCountdown(
    [
      { address: myId() || 'local', name: myName() },
      { address: DUMMY_ID, name: 'Dummy' }
    ],
    Date.now() + COUNTDOWN_MS
  )
}

function clickStart() {
  if (matchBusy()) {
    setHud({ hint: 'A run is already in progress. Wait in line for the next match.' })
    return
  }
  if (!canStartNow() || !ready.has(myId()) || !netReady) {
    setHud({ hint: lobbyHint() })
    return
  }
  void room.send('start', {})
}

function clearAfk() {
  afkIdle = 0
  afkPromptLeft = 0
  afkLastPos = null
  afkArmed = false
  if (hud.afkPrompt || hud.afkSecondsLeft) setHud({ afkPrompt: false, afkSecondsLeft: 0 })
}

function clickAfkHere() {
  afkIdle = 0
  afkPromptLeft = 0
  afkArmed = true
  afkLastPos = localPos()
  setHud({ afkPrompt: false, afkSecondsLeft: 0 })
}

function tickAfk(dt: number, me: Vector3) {
  const active =
    (match.phase === 'playing' || match.phase === 'countdown') && (iAmInMatch() || matchPractice)
  if (!active) {
    clearAfk()
    return
  }

  if (!afkArmed) {
    afkArmed = true
    afkIdle = 0
    afkPromptLeft = 0
    afkLastPos = Vector3.clone(me)
    setHud({ afkPrompt: false, afkSecondsLeft: 0 })
    return
  }

  if (hud.afkPrompt) {
    afkPromptLeft = Math.max(0, afkPromptLeft - dt)
    const left = Math.ceil(afkPromptLeft)
    if (hud.afkSecondsLeft !== left) setHud({ afkSecondsLeft: left })
    if (afkPromptLeft <= 0) {
      afkPromptLeft = AFK_PROMPT_SEC
      setHud({ afkPrompt: true, afkSecondsLeft: AFK_PROMPT_SEC, howToOpen: false })
    }
    return
  }

  if (!afkLastPos) afkLastPos = Vector3.clone(me)
  const moved = Math.hypot(me.x - afkLastPos.x, me.z - afkLastPos.z) >= AFK_MOVE_EPS
  if (moved) {
    afkIdle = 0
    afkLastPos = Vector3.clone(me)
    return
  }

  afkIdle += dt
  if (afkIdle >= AFK_IDLE_SEC) {
    afkPromptLeft = AFK_PROMPT_SEC
    setHud({ afkPrompt: true, afkSecondsLeft: AFK_PROMPT_SEC, howToOpen: false })
  }
}

function fallReset(canyon = false) {
  if (canyon) playWilhelm()
  const lost = match.phase === 'playing' || match.phase === 'countdown'
  if (lost) playDeath()
  clearAfk()
  if (matchPractice) {
    void room.send('practiceStop', {})
    resetToLobby()
    respawnAtStart(true)
    return
  }
  if (matchBusy() && !iAmInMatch()) {
    if (spectateWait || line.has(myId())) teleportToSpectate()
    else respawnAtStart(true)
    return
  }
  // After a win, canyon fall clears the match so everyone can link up again.
  // Also reset locally so gates/UI clear immediately (server mirrors this).
  if (netReady) void room.send('reset', {})
  if (match.phase === 'won') {
    resetToLobby()
  }
  respawnAtStart(true)
}

function spawnPos() {
  const me = myId()
  const idx = Math.max(0, match.players.findIndex((p) => p.address === me))
  const dest = world.startSlots[idx] ?? world.startA
  return { x: dest.x, y: SPAWN_Y, z: dest.z }
}

function respawnAtStart(force = false) {
  if (!force && respawnLock > 0) return
  respawnLock = 0.85
  void movePlayerTo({
    newRelativePosition: spawnPos(),
    cameraTarget: { x: 18, y: PLATFORM_TOP + 4, z: 26 }
  })
}

function stopRopePull() {
  if (ropeForceSource) Physics.removeForceFromPlayer(ropeForceSource)
}

function clearRope() {
  hideRope()
  stopRopePull()
}

function pullToward(me: Vector3, partner: Vector3) {
  const towardX = partner.x - me.x
  const towardZ = partner.z - me.z
  const flat = Math.max(0.001, Math.sqrt(towardX * towardX + towardZ * towardZ))
  const excess = flat - ROPE_MAX
  const tension = Math.min(1, flat / ROPE_MAX)

  if (partner.y < FALL_Y) return { tension, force: null as Vector3 | null }
  if (excess <= ROPE_DEADZONE) return { tension, force: null as Vector3 | null }

  const mag = Math.min(excess * ROPE_STIFFNESS, ROPE_MAX_FORCE)
  if (mag < 0.5) return { tension, force: null as Vector3 | null }
  return { tension, force: Vector3.create((towardX / flat) * mag, 0, (towardZ / flat) * mag) }
}

function enforceRopes(me: Vector3, mates: Array<{ pos: Vector3 }>) {
  if (Date.now() - match.playStartedAt < 1400) {
    stopRopePull()
    return
  }
  if (!localStanding(me) || !ropeForceSource) {
    stopRopePull()
    return
  }

  let fx = 0
  let fy = 0
  let fz = 0
  let maxTension = 0
  for (const mate of mates) {
    const pulled = pullToward(me, mate.pos)
    maxTension = Math.max(maxTension, pulled.tension)
    if (pulled.force) {
      const scale = matchPractice ? 1.32 : 1
      fx += pulled.force.x * scale
      fy += pulled.force.y * scale
      fz += pulled.force.z * scale
    }
  }
  hud.tension = maxTension
  const mag = Math.sqrt(fx * fx + fy * fy + fz * fz)
  if (mag < 0.5) {
    stopRopePull()
    return
  }
  const capped = Math.min(mag, ROPE_MAX_FORCE * 1.35)
  Physics.applyForceToPlayer(ropeForceSource, { x: fx, y: fy, z: fz }, capped)
}

function onPadY(p: Vector3, top: number) {
  return p.y > top - 0.5 && p.y < top + 1.35
}

function platesPressed(positions: Vector3[], a: Vector3, b: Vector3) {
  let plateA = false
  let plateB = false
  for (const p of positions) {
    if (xzDistance(p, a) < 1.15 && onPadY(p, a.y)) plateA = true
    if (xzDistance(p, b) < 1.15 && onPadY(p, b.y)) plateB = true
  }
  return { plateA, plateB, both: plateA && plateB }
}

function steerDummyToFreePlate(me: Vector3) {
  if (!dummy || !matchPractice) return
  const pairs = [
    [world.plateAPos, world.plateBPos],
    [world.midPlateAPos, world.midPlateBPos]
  ]
  for (const [a, b] of pairs) {
    const onA = xzDistance(me, a) < 1.2 && onPadY(me, a.y)
    const onB = xzDistance(me, b) < 1.2 && onPadY(me, b.y)
    if (onA) {
      dummy.pos = Vector3.lerp(dummy.pos, Vector3.create(b.x, me.y, b.z), 0.28)
      Transform.getMutable(dummy.root).position = dummy.pos
      return
    }
    if (onB) {
      dummy.pos = Vector3.lerp(dummy.pos, Vector3.create(a.x, me.y, a.z), 0.28)
      Transform.getMutable(dummy.root).position = dummy.pos
      return
    }
  }
}

function packOnFinish(located: Map<string, Vector3>) {
  if (!gateOpen || match.players.length === 0) return false
  const top = world.finishCenter.y
  return match.players.every((p) => {
    if (p.address === DUMMY_ID) return true
    const pos = p.address === myId() ? localPos() : located.get(p.address)
    return pos ? xzDistance(pos, world.finishCenter) < 1.45 && onPadY(pos, top) : false
  })
}

function motionTime() {
  // Practice runs locally — don't use the shared match clock (it stays at 0 in lobby).
  if (matchPractice && (match.phase === 'playing' || match.phase === 'won')) {
    if (match.playStartedAt <= 0) return 0
    return Math.max(0, (Date.now() - match.playStartedAt) / 1000)
  }
  if (match.phase === 'playing' || match.phase === 'won') {
    if (match.phase === 'won') {
      if (match.playStartedAt <= 0) return 0
      return Math.max(0, (Date.now() - match.playStartedAt) / 1000)
    }
    if (lastClockAt <= 0) return lastClockT
    return Math.max(0, lastClockT + (Date.now() - lastClockAt) / 1000)
  }
  return 0
}

function matePositions() {
  return teammates()
    .map((p) => {
      if (p.address === DUMMY_ID) {
        const pos = dummy ? Vector3.clone(dummy.pos) : null
        return pos ? { player: p, pos } : null
      }
      const pos = liveOrLast(p.address)
      return pos ? { player: p, pos } : null
    })
    .filter((x): x is { player: LobbyPlayer; pos: Vector3 } => x !== null)
}

function readPracticeRows() {
  for (const [_entity, state] of engine.getEntitiesWith(PracticeDummiesState)) return state.rows || []
  return []
}

function ensureRemoteDummy(address: string) {
  const existing = remoteDummies.get(address)
  if (existing) return existing
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(0, -10, 0), scale: Vector3.create(1, 1, 1) })
  GltfContainer.create(root, { src: 'models/dummy.glb' })
  remoteDummies.set(address, root)
  return root
}

function syncRemotePracticeDummies() {
  const rows = readPracticeRows()
  const me = myId()
  const keep = new Set<string>()
  for (const row of rows) {
    const address = (row.address || '').toLowerCase()
    if (!address || address === me) continue
    keep.add(address)
    const root = ensureRemoteDummy(address)
    const t = Transform.getMutable(root)
    t.position = Vector3.create(row.x, row.y + (row.hop || 0), row.z)
    t.rotation = Quaternion.fromEulerDegrees(0, row.yaw || 0, 0)
    t.scale = Vector3.create(1, 1, 1)
  }
  for (const [address, root] of [...remoteDummies.entries()]) {
    if (keep.has(address)) continue
    Transform.getMutable(root).position = Vector3.create(0, -10, 0)
    remoteDummies.delete(address)
    engine.removeEntity(root)
  }
}

function paintPracticeRopes(dt: number) {
  const pairs: Array<{ fromId: string; toId: string; from: Vector3; to: Vector3; tension: number }> = []
  const me = myId()

  if (matchPractice && dummy && me) {
    pairs.push({
      fromId: me,
      toId: DUMMY_ID,
      from: localPos(),
      to: Vector3.clone(dummy.pos),
      tension: Math.min(1, xzDistance(localPos(), dummy.pos) / ROPE_MAX)
    })
  }

  for (const row of readPracticeRows()) {
    const address = (row.address || '').toLowerCase()
    if (!address || address === me) continue
    const from = liveOrLast(address)
    if (!from) continue
    const to = Vector3.create(row.x, row.y, row.z)
    pairs.push({
      fromId: address,
      toId: `${DUMMY_ID}:${address}`,
      from,
      to,
      tension: Math.min(1, xzDistance(from, to) / ROPE_MAX)
    })
  }

  if (pairs.length === 0) {
    hideRope()
    return false
  }
  updateRopes(pairs.slice(0, ROPE_LINES), dt)
  return true
}

function posForMatchPlayer(address: string, me: Vector3): Vector3 | null {
  if (address === myId()) return me
  return liveOrLast(address)
}

/** Every client draws the full teammate mesh so spectators see the same ropes. */
function paintMatchRopes(me: Vector3, dt: number) {
  const humans = match.players.filter((p) => p.address !== DUMMY_ID)
  if (humans.length < 2) {
    hideRope()
    return false
  }
  const pairs: Array<{ fromId: string; toId: string; from: Vector3; to: Vector3; tension: number }> = []
  for (let i = 0; i < humans.length; i++) {
    for (let j = i + 1; j < humans.length; j++) {
      const a = humans[i].address
      const b = humans[j].address
      const from = posForMatchPlayer(a, me)
      const to = posForMatchPlayer(b, me)
      if (!from || !to) continue
      pairs.push({
        fromId: a,
        toId: b,
        from,
        to,
        tension: Math.min(1, xzDistance(from, to) / ROPE_MAX)
      })
    }
  }
  if (pairs.length === 0) {
    hideRope()
    return false
  }
  updateRopes(pairs.slice(0, ROPE_LINES), dt)
  return true
}

function applyServerMatch(dt: number) {
  const clock = readClock()
  const state = readMatch()
  if (clock) {
    const beat = Number(clock.heartbeat)
    if (beat && beat !== lastHeartbeat) {
      lastHeartbeat = beat
      beatAge = 0
    } else {
      beatAge += dt
    }
    // Shared match clock is idle (0) while a local practice run is active.
    if (!matchPractice) {
      lastClockT = clock.motionT
      lastClockAt = Date.now()
    }
  } else {
    beatAge += dt
  }

  const synced = isStateSyncronized() || room.isReady()
  netReady = !!state || (synced && beatAge < 8)
  if (netReady) connectingAge = 0
  else connectingAge += dt
  if (hud.serverReady !== netReady) setHud({ serverReady: netReady })
  flushJoin()

  if (!state) {
    if (!matchPractice) refreshLobbyHud()
    syncRemotePracticeDummies()
    return
  }

  applyLobbyMaps(
    (state.ready || []).map((p) => ({ address: p.address, name: p.name })),
    (state.line || []).map((p) => ({ address: p.address, name: p.name }))
  )
  syncRemotePracticeDummies()

  // Local practice runs on this client; do not let the shared match overwrite it.
  if (matchPractice) {
    seenPhase = (state.phase || 'lobby') as Phase
    seenPlayStartedAt = Number(state.playStartedAt) || 0
    return
  }

  match.players = (state.players || []).map((p) => ({ address: p.address.toLowerCase(), name: p.name }))
  match.startAt = Number(state.startAt) || 0
  match.playStartedAt = Number(state.playStartedAt) || 0
  const phase = (state.phase || 'lobby') as Phase
  const phaseChanged = phase !== seenPhase
  const runChanged = Number(state.playStartedAt) !== seenPlayStartedAt
  seenPhase = phase
  seenPlayStartedAt = Number(state.playStartedAt) || 0

  if (phaseChanged || runChanged) {
    if (phase === 'countdown') {
      beginCountdown(match.players, match.startAt)
    } else if (phase === 'playing') {
      if (match.phase !== 'playing') beginPlay()
      match.phase = 'playing'
    } else if (phase === 'won') {
      if (match.phase !== 'won') showWin(Math.max(1, Math.round((clock?.motionT || 0) * 1000)))
    } else {
      if (match.phase !== 'lobby' && match.phase !== 'waiting') {
        resetToLobby()
        respawnAtStart(true)
      } else {
        match.phase = phase
        refreshLobbyHud()
      }
    }
  } else if (phase === 'lobby' || phase === 'waiting') {
    match.phase = phase
    refreshLobbyHud()
  }

  if (phase === 'countdown' || phase === 'playing' || phase === 'won') {
    applyCourse(state)
    if (iAmInMatch()) setHud({ banner: flashBanner(state.banner || '') })
  }
}

function tickPractice(dt: number, me: Vector3) {
  syncRemotePracticeDummies()
  if (me.y < GROUND_Y && respawnLock <= 0) {
    fallReset(true)
    return
  }
  if (match.phase === 'countdown') {
    updateDummy(dt, me)
    const left = match.startAt - Date.now()
    if (left <= 0) beginPlay()
    else setHud({ banner: flashBanner(String(Math.max(1, Math.ceil(left / 1000)))), bannerAlpha: 1 })
    paintPracticeRopes(dt)
    stopRopePull()
    return
  }
  if (match.phase === 'won') {
    setHud({ banner: flashBanner(hud.banner) })
    paintPracticeRopes(dt)
    return
  }
  if (match.phase !== 'playing') {
    paintPracticeRopes(dt)
    return
  }
  setHud({
    timeMs: Date.now() - match.playStartedAt,
    banner: flashBanner(hud.banner)
  })
  updateDummy(dt, me)
  steerDummyToFreePlate(me)
  const mates = matePositions()
  if (!paintPracticeRopes(dt)) {
    stopRopePull()
    return
  }
  enforceRopes(me, mates)
  const located = new Map<string, Vector3>()
  located.set(myId(), me)
  for (const m of mates) located.set(m.player.address, m.pos)
  const allPos = [...located.values()]
  const mid = platesPressed(allPos, world.midPlateAPos, world.midPlateBPos)
  setPlateLit(world.midPlateA, mid.plateA)
  setPlateLit(world.midPlateB, mid.plateB)
  notePads('mid', mid.both)
  if (mid.both && !midGateOpen) {
    midGateOpen = true
    courseGate(world.midGate, true, world.midGateClosedY)
  }
  const plates = platesPressed(allPos, world.plateAPos, world.plateBPos)
  setPlateLit(world.plateA, plates.plateA)
  setPlateLit(world.plateB, plates.plateB)
  notePads('finish', plates.both)
  if (plates.both && !gateOpen) {
    gateOpen = true
    courseGate(world.gate, true, world.gateClosedY)
  }
  if (packOnFinish(located)) showWin(Date.now() - match.playStartedAt)
}

function gameSystem(dt: number) {
  respawnLock = Math.max(0, respawnLock - dt)
  standCoyote = Math.max(0, standCoyote - dt)
  tickScoreboard(dt)
  const me = localPos()

  applyServerMatch(dt)
  tickAfk(dt, me)
  const moversLive = match.phase === 'playing' || match.phase === 'won'
  const flamesLive =
    moversLive || matchPractice || match.phase === 'lobby' || match.phase === 'waiting' || match.phase === 'countdown'
  tickMovers(world.movers, dt, me, moversLive, motionTime(), matchPractice ? dummy : null)
  tickFlameHazards(world.flameHazards, dt, me, flamesLive, matchPractice ? dummy : null)

  if (matchPractice) {
    tickPractice(dt, me)
    if (!iAmLinked()) hud.tension = 0
    syncMusicBed()
    return
  }

  syncRemotePracticeDummies()

  const linkedLive = match.phase === 'countdown' || match.phase === 'playing'
  if (linkedLive) {
    paintMatchRopes(me, dt)
  } else if (readPracticeRows().length > 0) {
    paintPracticeRopes(dt)
  } else {
    clearRope()
  }

  if (me.y < GROUND_Y && respawnLock <= 0) fallReset(true)

  // Spectators can roam the course; only park non-spectators back at start.
  if (
    matchBusy() &&
    !iAmInMatch() &&
    respawnLock <= 0 &&
    !inStartCage(me) &&
    !(spectateWait || line.has(myId()))
  ) {
    respawnAtStart(true)
  }

  if (match.phase === 'countdown' && iAmInMatch()) {
    stopRopePull()
  }

  if (match.phase === 'playing' && iAmInMatch()) {
    setHud({
      timeMs: motionTime() * 1000,
      banner: flashBanner(hud.banner)
    })
    const mates = matePositions()
    if (mates.length > 0 || teammates().length === 0) {
      enforceRopes(me, mates)
    } else {
      stopRopePull()
    }
  } else if (match.phase === 'won' && iAmInMatch()) {
    setHud({ banner: flashBanner(hud.banner) })
  }

  if (!iAmLinked()) hud.tension = 0
  syncMusicBed()
}

export function setupGame(handles: WorldHandles) {
  world = handles
  setupAudio()
  ropeForceSource = engine.addEntity()
  createRope()
  hideRope()
  setHud({ serverReady: false, subtitle: 'Connecting to the match server…' })
  room.onReady((isReady) => {
    if (isReady) flushJoin()
  })

  onLeaveScene((userId) => {
    const id = userId.toLowerCase()
    if (id === myId()) return
    lastKnown.delete(id)
  })

  engine.addSystem(gameSystem)
  uiActions.join = () => clickJoin()
  uiActions.practice = () => clickPractice()
  uiActions.start = () => clickStart()
  uiActions.spectateYes = () => clickSpectateYes()
  uiActions.spectateNo = () => clickSpectateNo()
  uiActions.afkHere = () => clickAfkHere()
}
