import { Storage } from '@dcl/sdk/server'
import { signedFetch } from '~system/SignedFetch'
import { LEADERBOARD_API_BASE } from '../config'
import { dedupeEntries, mergeByBestTime, rankTop, type FinishEntry } from '../scoreboard'

const BOARD_KEY = 'leaderboard'
const META_KEY = 'leaderboard_meta'

type SavedBoard = {
  sequence: number
  top: FinishEntry[]
}

type BoardMeta = {
  count: number
  sequence: number
}

type RemotePayload = {
  sequence?: number
  updatedAtMs?: number
  top?: Array<{ rank?: number; key?: string; names?: string[] | string; timeMs?: number }>
}

export type LoadResult =
  | { status: 'ok'; sequence: number; top: FinishEntry[]; source: 'remote' | 'storage' | 'merged' }
  | { status: 'missing'; sequence: 0; top: []; source: 'none' }
  | { status: 'error'; sequence: 0; top: []; reason: string; source: 'none' }

function normalizeRow(row: RemotePayload['top'] extends (infer R)[] | undefined ? R : never): FinishEntry | null {
  if (!row?.key) return null
  const key = String(row.key).toLowerCase()
  if (key.startsWith('seed:')) return null
  const names = Array.isArray(row.names)
    ? row.names.map(String)
    : String(row.names || 'Player')
        .split(' • ')
        .filter(Boolean)
  const timeMs = Math.max(0, Math.floor(Number(row.timeMs) || 0))
  if (!names.length || timeMs <= 0) return null
  return {
    rank: 0,
    timeMs,
    names,
    key: key
  }
}

function normalizeBoard(data: SavedBoard | RemotePayload | null | undefined): SavedBoard {
  if (!data || typeof data !== 'object') return { sequence: 0, top: [] }
  const top = Array.isArray(data.top)
    ? dedupeEntries(
        rankTop(
          data.top
            .map((row) => normalizeRow(row))
            .filter((row): row is FinishEntry => row !== null)
        )
      )
    : []
  return {
    sequence: Number(data.sequence) || 0,
    top
  }
}

export { mergeByBestTime } from '../scoreboard'

async function loadRemoteBoard(): Promise<SavedBoard | null> {
  if (!LEADERBOARD_API_BASE) return null
  try {
    const response = await signedFetch({
      url: `${LEADERBOARD_API_BASE}/api/tug/leaderboard`,
      init: { method: 'GET', headers: {} }
    })
    if (!response.ok) {
      console.error('[SERVER] Remote leaderboard GET failed', response.status, response.statusText)
      return null
    }
    const data = JSON.parse(response.body || '{}') as RemotePayload
    const board = normalizeBoard(data)
    console.log('[SERVER] Remote leaderboard loaded', { sequence: board.sequence, entries: board.top.length })
    return board
  } catch (err) {
    console.error('[SERVER] Remote leaderboard load error', err)
    return null
  }
}

async function loadStorageBoard(): Promise<{ board: SavedBoard; meta: BoardMeta | null } | null> {
  try {
    const [raw, metaRaw] = await Promise.all([
      Storage.get<SavedBoard | string>(BOARD_KEY, { fresh: true }),
      Storage.get<BoardMeta>(META_KEY, { fresh: true })
    ])
    if (!raw) {
      if (metaRaw && Number(metaRaw.count) > 0) {
        console.error('[SERVER] Storage board missing but meta count=', metaRaw.count)
        return null
      }
      return { board: { sequence: 0, top: [] }, meta: metaRaw }
    }
    const data = typeof raw === 'string' ? (JSON.parse(raw) as SavedBoard) : raw
    return { board: normalizeBoard(data), meta: metaRaw }
  } catch (err) {
    console.error('[SERVER] Storage leaderboard load error', err)
    return null
  }
}

/**
 * Load leaderboard — remote JSON store first, merged with DCL Storage backup.
 */
export async function loadLeaderboard(): Promise<LoadResult> {
  try {
    const [remote, storageWrap] = await Promise.all([loadRemoteBoard(), loadStorageBoard()])
    const storage = storageWrap?.board || { sequence: 0, top: [] }

    if (remote && remote.top.length) {
      const merged = mergeByBestTime(remote.top, storage.top)
      const sequence = Math.max(remote.sequence, storage.sequence, merged.length ? remote.sequence : 0)
      return { status: 'ok', sequence, top: merged, source: storage.top.length ? 'merged' : 'remote' }
    }

    if (storage.top.length) {
      return { status: 'ok', sequence: storage.sequence, top: storage.top, source: 'storage' }
    }

    if (remote) {
      return { status: 'ok', sequence: remote.sequence, top: remote.top, source: 'remote' }
    }

    if (storageWrap) {
      return { status: 'missing', sequence: 0, top: [], source: 'none' }
    }

    return { status: 'error', sequence: 0, top: [], reason: 'remote and storage unavailable', source: 'none' }
  } catch (err) {
    console.error('[SERVER] Could not load leaderboard', err)
    return { status: 'error', sequence: 0, top: [], reason: String(err), source: 'none' }
  }
}

async function saveRemoteBoard(sequence: number, top: FinishEntry[]): Promise<boolean> {
  if (!LEADERBOARD_API_BASE) return false
  try {
    const ranked = rankTop(top)
    const response = await signedFetch({
      url: `${LEADERBOARD_API_BASE}/api/tug/sync`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence, top: ranked })
      }
    })
    if (!response.ok) {
      console.error('[SERVER] Remote leaderboard sync failed', response.status, response.statusText)
      return false
    }
    console.log('[SERVER] Remote leaderboard saved', { sequence, entries: ranked.length })
    return true
  } catch (err) {
    console.error('[SERVER] Remote leaderboard save error', err)
    return false
  }
}

async function saveStorageBoard(sequence: number, top: FinishEntry[]): Promise<boolean> {
  try {
    const ranked = rankTop(top)
    const ok = await Storage.set(BOARD_KEY, { sequence, top: ranked })
    if (!ok) {
      console.error('[SERVER] Failed to save leaderboard to Storage')
      return false
    }
    const metaOk = await Storage.set(META_KEY, {
      count: ranked.length,
      sequence
    } satisfies BoardMeta)
    if (!metaOk) console.error('[SERVER] Failed to save leaderboard meta')
    return true
  } catch (err) {
    console.error('[SERVER] Storage leaderboard save error', err)
    return false
  }
}

export async function saveLeaderboard(sequence: number, top: FinishEntry[]): Promise<boolean> {
  const ranked = rankTop(top)
  const [remoteOk, storageOk] = await Promise.all([
    saveRemoteBoard(sequence, ranked),
    saveStorageBoard(sequence, ranked)
  ])
  return remoteOk || storageOk
}
