import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { PLATFORM_TOP, START_WALL_H, LEADERBOARD_API_BASE } from './config'
import { ScoreboardState } from './shared/components'

export type FinishEntry = {
  rank: number
  timeMs: number
  names: string[]
  key: string
}

export type FinishBoard = {
  sequence: number
  top: FinishEntry[]
  updatedAtMs: number
}

const TOP_N = 10

const PANEL_W = 5.8
const PANEL_D = 0.14
const BORDER = 0.18
const CORNER_R = 0.18
const EDGE_PAD = 0.75
const TITLE_TO_SUB = 0.38
const TITLE_TO_BODY = 1.05
const PANEL_H = 8.2
const TEXT_SCALE = 1.35

const PINK = Color4.create(1, 0.35, 0.72, 1)
const PINK_EMIT = Color3.create(1, 0.2, 0.65)
const TEXT_COLOR = Color4.create(0.95, 0.92, 0.82, 1)

const bodies: Entity[] = []
let spawned = false
let cached: FinishBoard = { sequence: 0, top: [], updatedAtMs: Date.now() }
let refreshTimer = 0
let remoteTimer = 45

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function finishKey(addresses: string[]) {
  return addresses.map((a) => a.toLowerCase()).filter(Boolean).sort().join('|')
}

export function rankTop(entries: FinishEntry[]): FinishEntry[] {
  return [...entries]
    .sort((a, b) => a.timeMs - b.timeMs || a.names.join().localeCompare(b.names.join()))
    .slice(0, TOP_N)
    .map((row, i) => ({ ...row, rank: i + 1 }))
}

export function mergeByBestTime(a: FinishEntry[], b: FinishEntry[]): FinishEntry[] {
  const map = new Map<string, FinishEntry>()
  for (const row of [...a, ...b]) {
    if (!row?.key) continue
    const prev = map.get(row.key)
    if (!prev || row.timeMs < prev.timeMs) {
      map.set(row.key, {
        rank: 0,
        timeMs: Number(row.timeMs) || 0,
        names: Array.isArray(row.names) ? row.names.map(String) : [],
        key: String(row.key)
      })
    }
  }
  return dedupeEntries(Array.from(map.values()))
}

function teamTimeKey(row: FinishEntry) {
  return `${[...row.names].map((n) => n.toLowerCase()).sort().join('|')}:${row.timeMs}`
}

/** Collapse duplicate rows for the same team/time (e.g. seed key vs wallet key). */
export function dedupeEntries(entries: FinishEntry[]): FinishEntry[] {
  const map = new Map<string, FinishEntry>()
  for (const row of entries) {
    if (!row?.key || row.timeMs <= 0 || !row.names.length) continue
    const tk = teamTimeKey(row)
    const prev = map.get(tk)
    if (!prev) {
      map.set(tk, row)
      continue
    }
    const rowSeed = row.key.startsWith('seed:')
    const prevSeed = prev.key.startsWith('seed:')
    if (rowSeed && !prevSeed) continue
    if (!rowSeed && prevSeed) {
      map.set(tk, row)
      continue
    }
    if (row.timeMs < prev.timeMs) map.set(tk, row)
  }
  return rankTop(Array.from(map.values()))
}

function buildBodyText(board: FinishBoard) {
  const lines = ['──────────────']
  if (!board.top.length) {
    lines.push('(no finishes yet)')
  } else {
    for (const row of board.top) {
      const names = row.names.join(' • ').slice(0, 42)
      lines.push(`${row.rank}. ${formatTime(row.timeMs)}  ${names}`)
    }
  }
  return lines.join('\n')
}

function applyPink(entity: Entity) {
  Material.setPbrMaterial(entity, {
    albedoColor: PINK,
    emissiveColor: PINK_EMIT,
    emissiveIntensity: 3.4,
    metallic: 0.15,
    roughness: 0.35
  })
}

function addBox(parent: Entity, position: Vector3, scale: Vector3) {
  const entity = engine.addEntity()
  Transform.create(entity, { parent, position, scale })
  MeshRenderer.setBox(entity)
  return entity
}

function spawnFrame(parent: Entity) {
  const face = addBox(parent, Vector3.create(0, 0, 0), Vector3.create(PANEL_W - BORDER * 2, PANEL_H - BORDER * 2, PANEL_D))
  Material.setPbrMaterial(face, {
    albedoColor: Color4.create(0.08, 0.09, 0.11, 1),
    emissiveColor: Color3.create(0.04, 0.045, 0.055),
    emissiveIntensity: 0.35,
    metallic: 0.05,
    roughness: 0.85
  })

  const depth = PANEL_D + 0.03
  const barLenX = PANEL_W - CORNER_R * 2
  const barLenY = PANEL_H - CORNER_R * 2
  const edgeY = PANEL_H / 2 - BORDER / 2
  const edgeX = PANEL_W / 2 - BORDER / 2
  const top = addBox(parent, Vector3.create(0, edgeY, 0), Vector3.create(barLenX, BORDER, depth))
  const bottom = addBox(parent, Vector3.create(0, -edgeY, 0), Vector3.create(barLenX, BORDER, depth))
  const left = addBox(parent, Vector3.create(-edgeX, 0, 0), Vector3.create(BORDER, barLenY, depth))
  const right = addBox(parent, Vector3.create(edgeX, 0, 0), Vector3.create(BORDER, barLenY, depth))
  for (const edge of [top, bottom, left, right]) applyPink(edge)

  const cylRot = Quaternion.fromEulerDegrees(90, 0, 0)
  const cylScale = Vector3.create(CORNER_R * 2, depth, CORNER_R * 2)
  const cx = PANEL_W / 2 - CORNER_R
  const cy = PANEL_H / 2 - CORNER_R
  for (const pos of [
    Vector3.create(cx, cy, 0),
    Vector3.create(-cx, cy, 0),
    Vector3.create(cx, -cy, 0),
    Vector3.create(-cx, -cy, 0)
  ]) {
    const corner = engine.addEntity()
    Transform.create(corner, { parent, position: pos, scale: cylScale, rotation: cylRot })
    MeshRenderer.setCylinder(corner)
    applyPink(corner)
  }
}

function paint() {
  const text = buildBodyText(cached)
  for (const entity of bodies) TextShape.getMutable(entity).text = text
}

function applyBoard(payload: FinishBoard) {
  const nextTop = dedupeEntries(rankTop(Array.isArray(payload.top) ? payload.top : []))
  const nextSeq = Number(payload.sequence) || 0
  if (!nextTop.length && cached.top.length && nextSeq <= cached.sequence) {
    return
  }
  if (nextTop.length && nextSeq < cached.sequence) {
    return
  }
  if (
    nextSeq === cached.sequence &&
    nextTop.length === cached.top.length &&
    nextTop.every((row, i) => {
      const prev = cached.top[i]
      return prev && prev.key === row.key && prev.timeMs === row.timeMs
    })
  ) {
    return
  }
  cached = {
    sequence: nextSeq,
    updatedAtMs: Number(payload.updatedAtMs) || Date.now(),
    top: nextTop
  }
  paint()
}

async function fetchRemoteBoard() {
  if (!LEADERBOARD_API_BASE) return
  try {
    const res = await fetch(`${LEADERBOARD_API_BASE}/api/tug/leaderboard`)
    if (!res.ok) return
    const data = (await res.json()) as FinishBoard
    if (!data || !Array.isArray(data.top)) return
    applyBoard({
      sequence: Number(data.sequence) || 0,
      updatedAtMs: Number(data.updatedAtMs) || Date.now(),
      top: data.top
        .map((row) => ({
          rank: Number(row.rank) || 0,
          timeMs: Number(row.timeMs) || 0,
          names: Array.isArray(row.names) ? row.names : String(row.names || 'Player').split(' • ').filter(Boolean),
          key: String(row.key || '').toLowerCase()
        }))
        .filter((row) => row.key && !row.key.startsWith('seed:') && row.timeMs > 0 && row.names.length)
    })
  } catch (err) {
    console.error('[SCOREBOARD] remote fetch failed', err)
  }
}

export function recordFinish(names: string[], addresses: string[], timeMs: number) {
  const key = finishKey(addresses)
  const cleanNames = names.map((n) => (n || 'Player').trim()).filter(Boolean)
  if (!key || cleanNames.length < 1 || timeMs <= 0) return

  const map = new Map<string, FinishEntry>()
  for (const row of cached.top) map.set(row.key, { ...row, rank: 0 })
  const prev = map.get(key)
  if (!prev || timeMs < prev.timeMs) {
    map.set(key, { rank: 0, timeMs, names: cleanNames, key })
  }

  applyBoard({
    sequence: cached.sequence + 1,
    updatedAtMs: Date.now(),
    top: rankTop(Array.from(map.values()))
  })
}

function spawnOneBoard(x: number, z: number, yaw: number) {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(x, PLATFORM_TOP + START_WALL_H / 2, z),
    rotation: Quaternion.fromEulerDegrees(0, yaw, 0)
  })
  spawnFrame(root)

  const title = engine.addEntity()
  Transform.create(title, {
    parent: root,
    position: Vector3.create(0, PANEL_H / 2 - EDGE_PAD, -0.1),
    scale: Vector3.create(TEXT_SCALE, TEXT_SCALE, TEXT_SCALE)
  })
  TextShape.create(title, {
    text: "Don't Be a Drag!",
    fontSize: 1.55,
    textColor: TEXT_COLOR,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    outlineWidth: 0.18,
    outlineColor: TEXT_COLOR
  })

  const sub = engine.addEntity()
  Transform.create(sub, {
    parent: root,
    position: Vector3.create(0, PANEL_H / 2 - EDGE_PAD - TITLE_TO_SUB, -0.1),
    scale: Vector3.create(TEXT_SCALE, TEXT_SCALE, TEXT_SCALE)
  })
  TextShape.create(sub, {
    text: `TOP ${TOP_N}  ·  FASTEST`,
    fontSize: 1.45,
    textColor: TEXT_COLOR,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  const body = engine.addEntity()
  Transform.create(body, {
    parent: root,
    position: Vector3.create(0, PANEL_H / 2 - EDGE_PAD - TITLE_TO_BODY, -0.1),
    scale: Vector3.create(TEXT_SCALE, TEXT_SCALE, TEXT_SCALE)
  })
  TextShape.create(body, {
    text: buildBodyText(cached),
    fontSize: 1.85,
    textColor: TEXT_COLOR,
    textAlign: TextAlignMode.TAM_TOP_CENTER
  })
  bodies.push(body)
}

export function setupScoreboard() {
  if (spawned) return
  spawned = true
  spawnOneBoard(2.54, 9, -90)
  spawnOneBoard(17.46, 9, 90)
  void fetchRemoteBoard()
}

export function tickScoreboard(dt: number) {
  remoteTimer -= dt
  if (remoteTimer <= 0) {
    remoteTimer = 45
    void fetchRemoteBoard()
  }

  refreshTimer -= dt
  if (refreshTimer > 0) return
  refreshTimer = 0.25

  let bestSeq = -1
  let bestRows: FinishEntry[] | null = null
  for (const [_entity, state] of engine.getEntitiesWith(ScoreboardState)) {
    const seq = Number(state.sequence) || 0
    if (seq < bestSeq) continue
    const rows = (state.rows || [])
      .map((row) => ({
        rank: row.rank,
        timeMs: row.timeMs,
        names: (row.names || '').split(' • ').filter(Boolean),
        key: (row.key || '').toLowerCase()
      }))
      .filter((row) => row.key && !row.key.startsWith('seed:') && row.timeMs > 0 && row.names.length)
    // Prefer the highest sequence; if tied, prefer the board with more rows.
    if (seq > bestSeq || (seq === bestSeq && rows.length > (bestRows?.length || 0))) {
      bestSeq = seq
      bestRows = rows
    }
  }
  if (bestRows === null) return
  const merged = mergeByBestTime(cached.top, dedupeEntries(rankTop(bestRows)))
  const nextSeq = Math.max(bestSeq, cached.sequence)
  if (nextSeq < cached.sequence && !(merged.length && !cached.top.length)) return
  applyBoard({
    sequence: nextSeq,
    updatedAtMs: Date.now(),
    top: merged
  })
}
