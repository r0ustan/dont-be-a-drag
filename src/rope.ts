import {
  AvatarAnchorPointType,
  AvatarAttach,
  engine,
  Entity,
  Material,
  MeshRenderer,
  Transform
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { C, ROPE_LINES, ROPE_MAX, ROPE_RADIUS, ROPE_SEGMENTS, ROPE_SOFT } from './config'

const HIP_Y = 0.92
const DUMMY_ID = 'practice-dummy'

type RopeLine = {
  segments: Entity[]
}

const lines: RopeLine[] = []
const hips = new Map<string, Entity>()

function localUserId() {
  return (getPlayer()?.userId ?? '').toLowerCase()
}

function isLocalAvatar(avatarId: string) {
  const id = (avatarId || '').toLowerCase()
  const me = localUserId()
  return !id || id === 'local' || (!!me && id === me)
}

function makeSegments(): Entity[] {
  const segments: Entity[] = []
  for (let i = 0; i < ROPE_SEGMENTS; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(0, -8, 0),
      scale: Vector3.create(0.01, 0.01, 0.01)
    })
    MeshRenderer.setCylinder(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: C.rope,
      roughness: 0.85,
      metallic: 0.02,
      emissiveColor: C.rope,
      emissiveIntensity: 1.55
    })
    segments.push(entity)
  }
  return segments
}

function ensureHip(avatarId: string): Entity {
  const local = isLocalAvatar(avatarId)
  const key = local ? 'local' : avatarId.toLowerCase()
  const existing = hips.get(key)
  if (existing && AvatarAttach.has(existing)) {
    const spec = AvatarAttach.get(existing)
    if (local ? !spec.avatarId : (spec.avatarId || '').toLowerCase() === key) return existing
    engine.removeEntity(existing)
    hips.delete(key)
  }

  const entity = engine.addEntity()
  Transform.create(entity)
  AvatarAttach.create(entity, {
    avatarId: local ? undefined : avatarId,
    anchorPointId: AvatarAnchorPointType.AAPT_HIP
  })
  hips.set(key, entity)
  return entity
}

function hipPoint(avatarId: string, fallback: Vector3): Vector3 {
  const feet = Vector3.create(fallback.x, fallback.y + HIP_Y, fallback.z)
  if (!avatarId || avatarId.toLowerCase() === DUMMY_ID) return feet

  const entity = ensureHip(avatarId)
  if (!Transform.has(entity)) return feet
  const pos = Transform.get(entity).position
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z) || pos.y < 0.3) return feet
  const dx = pos.x - fallback.x
  const dz = pos.z - fallback.z
  if (dx * dx + dz * dz > 6.25) return feet
  return Vector3.clone(pos)
}

export function createRope() {
  lines.length = 0
  for (let i = 0; i < ROPE_LINES; i++) {
    lines.push({ segments: makeSegments() })
  }
}

export function hideRope() {
  for (const line of lines) hideLine(line)
}

function hideLine(line: RopeLine) {
  for (const entity of line.segments) {
    const transform = Transform.getMutable(entity)
    transform.position = Vector3.create(0, -8, 0)
    transform.scale = Vector3.create(0.01, 0.01, 0.01)
  }
}

export function updateRopes(
  pairs: Array<{ fromId: string; toId: string; from: Vector3; to: Vector3; tension: number }>,
  _dt = 1 / 30
) {
  for (let i = 0; i < lines.length; i++) {
    const pair = pairs[i]
    if (!pair) {
      hideLine(lines[i])
      continue
    }
    updateLine(lines[i], pair.fromId, pair.toId, pair.from, pair.to, pair.tension)
  }
}

function updateLine(
  line: RopeLine,
  fromId: string,
  toId: string,
  from: Vector3,
  to: Vector3,
  tension: number
) {
  const start = hipPoint(fromId, from)
  const end = hipPoint(toId, to)
  const sag = (1 - Math.min(1, tension)) * 0.55

  for (let i = 0; i < ROPE_SEGMENTS; i++) {
    const t0 = i / ROPE_SEGMENTS
    const t1 = (i + 1) / ROPE_SEGMENTS
    const a = pointOnRope(start, end, t0, sag)
    const b = pointOnRope(start, end, t1, sag)
    placeSegment(line.segments[i], a, b, tension)
  }
}

function pointOnRope(start: Vector3, end: Vector3, t: number, sag: number): Vector3 {
  const p = Vector3.lerp(start, end, t)
  p.y -= 4 * t * (1 - t) * sag
  return p
}

function placeSegment(entity: Entity, a: Vector3, b: Vector3, tension: number) {
  const delta = Vector3.subtract(b, a)
  const length = Math.max(0.04, Vector3.length(delta))
  const mid = Vector3.lerp(a, b, 0.5)
  const dir = Vector3.scale(delta, 1 / length)
  const rotation = Quaternion.fromToRotation(Vector3.Up(), dir)

  Transform.createOrReplace(entity, {
    position: mid,
    rotation,
    scale: Vector3.create(ROPE_RADIUS, length, ROPE_RADIUS)
  })

  const hot = tension > 0.92
  const color = Color4.lerp(C.rope, hot ? C.ropeHot : C.gold, Math.max(0, (tension - ROPE_SOFT / ROPE_MAX) / 0.5))
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    roughness: 0.7,
    metallic: 0.04,
    emissiveColor: color,
    emissiveIntensity: hot ? 2.6 : 1.55
  })
}
