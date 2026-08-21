import { engine, Entity, InputModifier, Physics, Transform, Tween, TweenSequence } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { playHit } from './audio'
import { KNOCK_FORCE, KNOCK_IMPULSE } from './config'
import { spawnFlameBurst, spawnKnockBurst } from './fx'

export type FlameHazard = {
  x: number
  y: number
  z: number
  size: Vector3
  knockCd: number
  dummyKnockCd: number
  forceSource: Entity
}

export type MoverKind = 'platform' | 'hazard'
export type MoverMotion = 'slide' | 'flip' | 'orbit' | 'spin'

const FLIP_AXIS = Vector3.create(1, 0, 0)

export type Mover = {
  entity: Entity
  kind: MoverKind
  motion: MoverMotion
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  period: number
  phase: number
  size: Vector3
  restRot: Quaternion
  flipFlat: Quaternion
  flipOver: Quaternion
  flipFull: Quaternion
  forceSource: Entity
  lastX: number
  lastY: number
  lastZ: number
  knockCd: number
  dummyKnockCd: number
  orbitRadius: number
  orbitAxisX: number
  orbitAxisZ: number
  orbitSign: number
  orbitT: number
}

export type Deck = {
  x: number
  z: number
  w: number
  d: number
  top: number
}

const RESTART = 0
const HOLD_MS = 2200
const FLIP_MS = 1400
const SPIN_ORBIT = 0.15

function applyOrbit(m: Mover, t: number) {
  const ang = m.phase + m.orbitSign * (t / Math.max(0.12, m.period)) * Math.PI * 2
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const e1x = -m.orbitAxisZ
  const e1z = m.orbitAxisX
  const transform = Transform.getMutable(m.entity)
  transform.position.x = m.ax + m.orbitRadius * c * e1x
  transform.position.y = m.ay + m.orbitRadius * s
  transform.position.z = m.az + m.orbitRadius * c * e1z
  transform.rotation = m.restRot
}

function applySpin(m: Mover, t: number) {
  const deg = (m.phase + t / Math.max(0.12, m.period)) * 360
  const ang = (deg * Math.PI) / 180
  const transform = Transform.getMutable(m.entity)
  transform.position.x = m.ax + Math.cos(ang) * SPIN_ORBIT
  transform.position.y = m.ay
  transform.position.z = m.az + Math.sin(ang) * SPIN_ORBIT
  transform.rotation = Quaternion.fromAngleAxis(deg, Vector3.create(0, 1, 0))
}

function slideAlpha(m: Mover, t: number) {
  const oneWay = Math.max(0.05, m.period * 0.5)
  const cycle = oneWay * 2
  let u = t % cycle
  if (u < 0) u += cycle
  let a = u / oneWay
  if (a > 1) a = 2 - a
  return a
}

function applySlide(m: Mover, t: number) {
  const a = slideAlpha(m, t)
  const transform = Transform.getMutable(m.entity)
  transform.position.x = m.ax + (m.bx - m.ax) * a
  transform.position.y = m.ay + (m.by - m.ay) * a
  transform.position.z = m.az + (m.bz - m.az) * a
  transform.rotation = m.restRot
}

function restAt(m: Mover) {
  if (m.motion === 'orbit') {
    m.orbitT = 0
    applyOrbit(m, 0)
    snapshotMover(m)
    return
  }
  const transform = Transform.getMutable(m.entity)
  transform.position.x = m.ax
  transform.position.y = m.ay
  transform.position.z = m.az
  transform.rotation = m.restRot
  snapshotMover(m)
}

function snapshotMover(m: Mover) {
  const transform = Transform.get(m.entity)
  m.lastX = transform.position.x
  m.lastY = transform.position.y
  m.lastZ = transform.position.z
}

export function bindMover(
  entity: Entity,
  kind: MoverKind,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  size: Vector3,
  period: number,
  phase = 0,
  motion: MoverMotion = 'slide',
  restRot: Quaternion = Quaternion.Identity()
): Mover {
  return {
    entity,
    kind,
    motion,
    ax,
    ay,
    az,
    bx,
    by,
    bz,
    period,
    phase,
    size,
    restRot,
    flipFlat: Quaternion.Identity(),
    flipOver: Quaternion.fromAngleAxis(180, FLIP_AXIS),
    flipFull: Quaternion.fromAngleAxis(360, FLIP_AXIS),
    forceSource: engine.addEntity(),
    lastX: ax,
    lastY: ay,
    lastZ: az,
    knockCd: 0,
    dummyKnockCd: 0,
    orbitRadius: 0,
    orbitAxisX: 0,
    orbitAxisZ: 1,
    orbitSign: 1,
    orbitT: 0
  }
}

function rotateStep(duration: number, start: Quaternion, end: Quaternion) {
  return { duration, easingFunction: 0, mode: Tween.Mode.Rotate({ start, end }) }
}

function startFlip(m: Mover) {
  const flat = m.flipFlat
  const over = m.flipOver
  const full = m.flipFull
  if (m.phase > 0.5) {
    Tween.setRotate(m.entity, flat, over, FLIP_MS)
    TweenSequence.createOrReplace(m.entity, {
      sequence: [
        rotateStep(HOLD_MS, over, over),
        rotateStep(FLIP_MS, over, full),
        rotateStep(HOLD_MS, full, full)
      ],
      loop: RESTART
    })
  } else {
    Tween.setRotate(m.entity, flat, flat, HOLD_MS)
    TweenSequence.createOrReplace(m.entity, {
      sequence: [
        rotateStep(FLIP_MS, flat, over),
        rotateStep(HOLD_MS, over, over),
        rotateStep(FLIP_MS, over, full)
      ],
      loop: RESTART
    })
  }
  Tween.getMutable(m.entity).playing = true
}

export function startMovers(movers: Mover[]) {
  for (const m of movers) {
    if (m.motion === 'flip') {
      startFlip(m)
      snapshotMover(m)
      continue
    }
    if (m.motion === 'orbit') {
      m.orbitT = 0
      applyOrbit(m, 0)
      snapshotMover(m)
      continue
    }
    if (m.motion === 'spin') {
      applySpin(m, 0)
      snapshotMover(m)
      continue
    }
    if (Tween.has(m.entity)) Tween.deleteFrom(m.entity)
    if (TweenSequence.has(m.entity)) TweenSequence.deleteFrom(m.entity)
    applySlide(m, 0)
    snapshotMover(m)
  }
}

export function parkMovers(movers: Mover[]) {
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableGliding: true })
  })
  for (const m of movers) {
    if (Tween.has(m.entity)) Tween.deleteFrom(m.entity)
    if (TweenSequence.has(m.entity)) TweenSequence.deleteFrom(m.entity)
    restAt(m)
  }
}

function nearDeck(p: Vector3, d: Deck) {
  return (
    Math.abs(p.x - d.x) < d.w / 2 + 0.38 &&
    Math.abs(p.z - d.z) < d.d / 2 + 0.38 &&
    p.y > d.top - 0.4 &&
    p.y < d.top + 1.45
  )
}

function mostlyFlat(entity: Entity) {
  const q = Transform.get(entity).rotation
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
  return Math.abs(upY) > 0.72
}

function nearMoverDeck(p: Vector3, m: Mover) {
  const transform = Transform.get(m.entity)
  const pos = transform.position
  const inv = Quaternion.create(-transform.rotation.x, -transform.rotation.y, -transform.rotation.z, transform.rotation.w)
  const local = Vector3.rotate(Vector3.subtract(p, pos), inv)
  const top = m.size.y / 2
  return (
    Math.abs(local.x) < m.size.x / 2 + 0.38 &&
    Math.abs(local.z) < m.size.z / 2 + 0.38 &&
    local.y > top - 0.4 &&
    local.y < top + 1.45
  )
}

export function onDeck(p: Vector3, decks: Deck[], movers: Mover[]) {
  for (const d of decks) {
    if (nearDeck(p, d)) return true
  }
  for (const m of movers) {
    if (m.kind !== 'platform') continue
    if (m.motion === 'flip' && !mostlyFlat(m.entity)) continue
    if (nearMoverDeck(p, m)) return true
  }
  return false
}

function overlapping(p: Vector3, center: Vector3, size: Vector3, rotation: Quaternion) {
  const inv = Quaternion.create(-rotation.x, -rotation.y, -rotation.z, rotation.w)
  const local = Vector3.rotate(Vector3.subtract(p, center), inv)
  const bodyY = local.y + 0.9
  return (
    Math.abs(local.x) < size.x / 2 + 0.34 &&
    Math.abs(local.z) < size.z / 2 + 0.34 &&
    bodyY > -size.y / 2 &&
    local.y < size.y / 2 + 0.2
  )
}

function shoveFromPoint(player: Vector3, pos: Vector3) {
  let x = player.x - pos.x
  let z = player.z - pos.z
  if (x * x + z * z < 0.0004) {
    x = 1
    z = 0
  }
  return Vector3.create(x, 0.12, z)
}

function nearFlame(p: Vector3, center: Vector3, size: Vector3) {
  const dx = p.x - center.x
  const dz = p.z - center.z
  const dy = p.y - center.y
  const radius = Math.max(size.x, size.z) * 0.5 + 0.42
  return dx * dx + dz * dz <= radius * radius && dy > -size.y * 0.55 && dy < size.y * 0.55
}

function shoveDir(player: Vector3, pos: Vector3, lastX: number, lastZ: number) {
  const travelX = pos.x - lastX
  const travelZ = pos.z - lastZ
  let x = travelX * 8 + (player.x - pos.x)
  let z = travelZ * 8 + (player.z - pos.z)
  if (x * x + z * z < 0.0004) {
    x = player.x >= pos.x ? 1 : -1
    z = player.z >= pos.z ? 1 : -1
  }
  return Vector3.create(x, 0.12, z)
}

export type KnockBody = {
  pos: Vector3.Mutable
  vx: number
  vz: number
  knockCd: number
  hop: number
}

const DUMMY_IMPULSE = 12
const DUMMY_FORCE = 20

function applyDummyKnock(dummy: KnockBody, dir: Vector3, pos: Vector3, dt: number, impulse: boolean) {
  let x = dir.x
  let z = dir.z
  const len = Math.hypot(x, z)
  if (len < 0.0001) {
    x = dummy.pos.x >= pos.x ? 1 : -1
    z = dummy.pos.z >= pos.z ? 1 : -1
  } else {
    x /= len
    z /= len
  }
  dummy.vx += x * DUMMY_FORCE * dt
  dummy.vz += z * DUMMY_FORCE * dt
  if (!impulse) return
  dummy.vx += x * DUMMY_IMPULSE
  dummy.vz += z * DUMMY_IMPULSE
  dummy.knockCd = 0.55
  dummy.hop = 0.42
  const speed = Math.hypot(dummy.vx, dummy.vz)
  if (speed > 18) {
    dummy.vx *= 18 / speed
    dummy.vz *= 18 / speed
  }
}

export function tickMovers(
  movers: Mover[],
  dt: number,
  player: Vector3,
  live: boolean,
  motionT = 0,
  dummy?: KnockBody | null
) {
  for (const m of movers) {
    m.knockCd = Math.max(0, m.knockCd - dt)
    m.dummyKnockCd = Math.max(0, m.dummyKnockCd - dt)
    Physics.removeForceFromPlayer(m.forceSource)

    if (m.motion === 'orbit' && live) {
      m.orbitT = motionT
      applyOrbit(m, motionT)
    }
    if (m.motion === 'spin' && live) {
      applySpin(m, motionT)
    }
    if (m.motion === 'slide' && live) {
      applySlide(m, motionT)
    }

    const transform = Transform.get(m.entity)
    const pos = transform.position
    const lastX = m.lastX
    const lastZ = m.lastZ
    snapshotMover(m)

    if (m.kind !== 'hazard' || !live) continue

    if (overlapping(player, pos, m.size, transform.rotation)) {
      const dir = shoveDir(player, pos, lastX, lastZ)
      Physics.applyForceToPlayer(m.forceSource, dir, KNOCK_FORCE)
      if (m.knockCd <= 0) {
        Physics.applyImpulseToPlayer(dir, KNOCK_IMPULSE)
        spawnKnockBurst(
          Vector3.create((player.x + pos.x) * 0.5, player.y + 0.95, (player.z + pos.z) * 0.5)
        )
        playHit()
        m.knockCd = 0.55
      }
    }

    if (dummy && overlapping(dummy.pos, pos, m.size, transform.rotation)) {
      const dir = shoveDir(dummy.pos, pos, lastX, lastZ)
      const impulse = m.dummyKnockCd <= 0
      applyDummyKnock(dummy, dir, pos, dt, impulse)
      if (impulse) {
        spawnKnockBurst(
          Vector3.create((dummy.pos.x + pos.x) * 0.5, dummy.pos.y + 0.95, (dummy.pos.z + pos.z) * 0.5)
        )
        playHit()
        m.dummyKnockCd = 0.55
      }
    }
  }
}

export function tickFlameHazards(
  flames: FlameHazard[],
  dt: number,
  player: Vector3,
  live: boolean,
  dummy?: KnockBody | null
) {
  for (const f of flames) {
    f.knockCd = Math.max(0, f.knockCd - dt)
    f.dummyKnockCd = Math.max(0, f.dummyKnockCd - dt)
    Physics.removeForceFromPlayer(f.forceSource)
    if (!live) continue

    const pos = Vector3.create(f.x, f.y, f.z)
    if (nearFlame(player, pos, f.size)) {
      const dir = shoveFromPoint(player, pos)
      Physics.applyForceToPlayer(f.forceSource, dir, KNOCK_FORCE)
      if (f.knockCd <= 0) {
        Physics.applyImpulseToPlayer(dir, KNOCK_IMPULSE)
        spawnFlameBurst(
          Vector3.create((player.x + pos.x) * 0.5, player.y + 0.95, (player.z + pos.z) * 0.5)
        )
        playHit()
        f.knockCd = 0.55
      }
    }

    if (dummy && nearFlame(dummy.pos, pos, f.size)) {
      const dir = shoveFromPoint(dummy.pos, pos)
      const impulse = f.dummyKnockCd <= 0
      applyDummyKnock(dummy, dir, pos, dt, impulse)
      if (impulse) {
        spawnFlameBurst(
          Vector3.create((dummy.pos.x + pos.x) * 0.5, dummy.pos.y + 0.95, (dummy.pos.z + pos.z) * 0.5)
        )
        playHit()
        f.dummyKnockCd = 0.55
      }
    }
  }
}
