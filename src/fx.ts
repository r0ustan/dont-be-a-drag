import { engine, Entity, LightSource, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

const POOL = 128
const LIFE = 0.42
const GRAVITY = 9
const HIDDEN = Vector3.create(0, -80, 0)

const PALETTE = [
  Color4.create(1, 1, 1, 1),
  Color4.create(0.45, 0.95, 1, 1),
  Color4.create(0.15, 0.55, 1, 1),
  Color4.create(1, 0.35, 0.95, 1),
  Color4.create(1, 0.85, 0.35, 1)
]

const FLAME_PALETTE = [
  Color4.create(1, 0.96, 0.35, 1),
  Color4.create(1, 0.9, 0.22, 1),
  Color4.create(1, 0.82, 0.12, 1),
  Color4.create(1, 0.72, 0.05, 1),
  Color4.create(1, 0.58, 0.02, 1)
]

type BurstStyle = {
  palette: Color4[]
  flash: Color4
  flashLight: Color3
}

type Shard = {
  entity: Entity
  vx: number
  vy: number
  vz: number
  wx: number
  wy: number
  wz: number
  life: number
  maxLife: number
  g: number
  sx: number
  sy: number
  sz: number
}

const shards: Shard[] = []
let flash: Entity | null = null
let flashLight: Entity | null = null
let flashLife = 0
let booted = false

function rand(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function paint(entity: Entity, color: Color4, intensity: number) {
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    roughness: 1,
    metallic: 0,
    emissiveColor: color,
    emissiveIntensity: intensity
  })
}

function hide(entity: Entity) {
  const transform = Transform.getMutable(entity)
  transform.position.x = HIDDEN.x
  transform.position.y = HIDDEN.y
  transform.position.z = HIDDEN.z
  transform.scale = Vector3.create(0.001, 0.001, 0.001)
}

function makeBox(): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.clone(HIDDEN), scale: Vector3.create(0.001, 0.001, 0.001) })
  MeshRenderer.setBox(entity)
  paint(entity, PALETTE[0], 8)
  return entity
}

function boot() {
  if (booted) return
  booted = true
  for (let i = 0; i < POOL; i++) {
    shards.push({
      entity: makeBox(),
      vx: 0,
      vy: 0,
      vz: 0,
      wx: 0,
      wy: 0,
      wz: 0,
      life: 0,
      maxLife: LIFE,
      g: GRAVITY,
      sx: 0.1,
      sy: 0.1,
      sz: 0.1
    })
  }
  flash = makeBox()
  flashLight = engine.addEntity()
  Transform.create(flashLight, { position: Vector3.clone(HIDDEN) })
  LightSource.create(flashLight, {
    active: false,
    color: Color3.create(0.55, 0.9, 1),
    intensity: 0,
    range: 5.5,
    shadow: false,
    type: LightSource.Type.Point({})
  })
  engine.addSystem(tickKnockFx)
}

function takeShard(): Shard | null {
  let oldest: Shard | null = null
  for (const shard of shards) {
    if (shard.life <= 0) return shard
    if (!oldest || shard.life < oldest.life) oldest = shard
  }
  return oldest
}

function fireShard(
  origin: Vector3,
  ox: number,
  oy: number,
  oz: number,
  sx: number,
  sy: number,
  sz: number,
  speed: number,
  color: Color4,
  intensity: number,
  life = LIFE * rand(0.78, 1.12),
  gravity = GRAVITY
) {
  const shard = takeShard()
  if (!shard) return
  const len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1
  shard.vx = (ox / len) * speed
  shard.vy = (oy / len) * speed + rand(1.2, 3.4)
  shard.vz = (oz / len) * speed
  shard.wx = rand(-520, 520)
  shard.wy = rand(-520, 520)
  shard.wz = rand(-520, 520)
  shard.life = life
  shard.maxLife = life
  shard.g = gravity
  shard.sx = sx
  shard.sy = sy
  shard.sz = sz
  paint(shard.entity, color, intensity)
  const transform = Transform.getMutable(shard.entity)
  transform.position.x = origin.x + ox
  transform.position.y = origin.y + oy
  transform.position.z = origin.z + oz
  transform.scale = Vector3.create(sx, sy, sz)
  transform.rotation = Quaternion.fromAngleAxis(rand(0, 360), Vector3.Up())
}

function spawnBurst(origin: Vector3, style: BurstStyle) {
  boot()
  const color = () => style.palette[Math.floor(Math.random() * style.palette.length)]

  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      for (let iz = -1; iz <= 1; iz++) {
        if (ix === 0 && iy === 0 && iz === 0) continue
        const ox = ix * 0.11 + rand(-0.03, 0.03)
        const oy = iy * 0.11 + rand(-0.03, 0.03)
        const oz = iz * 0.11 + rand(-0.03, 0.03)
        const s = rand(0.08, 0.16)
        fireShard(origin, ox, oy, oz, s, s, s, rand(5.5, 11), color(), rand(7, 12))
      }
    }
  }

  for (let i = 0; i < 18; i++) {
    const ox = rand(-1, 1)
    const oy = rand(-0.35, 1)
    const oz = rand(-1, 1)
    fireShard(
      origin,
      ox,
      oy,
      oz,
      rand(0.03, 0.06),
      rand(0.03, 0.06),
      rand(0.22, 0.5),
      rand(8, 15),
      color(),
      13,
      LIFE * rand(0.7, 1.05)
    )
  }

  for (let i = 0; i < 64; i++) {
    const ox = rand(-1, 1)
    const oy = rand(-0.5, 1)
    const oz = rand(-1, 1)
    const needle = Math.random() < 0.55
    fireShard(
      origin,
      ox,
      oy,
      oz,
      needle ? rand(0.02, 0.04) : rand(0.04, 0.07),
      needle ? rand(0.02, 0.04) : rand(0.04, 0.07),
      needle ? rand(0.14, 0.32) : rand(0.04, 0.07),
      rand(10, 18),
      color(),
      rand(10, 16),
      rand(0.18, 0.34),
      3.5
    )
  }

  if (flash) {
    flashLife = 0.28
    paint(flash, style.flash, 14)
    const transform = Transform.getMutable(flash)
    transform.position.x = origin.x
    transform.position.y = origin.y
    transform.position.z = origin.z
    transform.scale = Vector3.create(0.22, 0.22, 0.22)
    transform.rotation = Quaternion.Identity()
  }
  if (flashLight) {
    const transform = Transform.getMutable(flashLight)
    transform.position.x = origin.x
    transform.position.y = origin.y
    transform.position.z = origin.z
    const light = LightSource.getMutable(flashLight)
    light.active = true
    light.color = style.flashLight
    light.intensity = 9000
    light.range = 6
  }
}

export function spawnKnockBurst(origin: Vector3) {
  spawnBurst(origin, {
    palette: PALETTE,
    flash: Color4.create(1, 1, 1, 1),
    flashLight: Color3.create(0.55, 0.9, 1)
  })
}

export function spawnFlameBurst(origin: Vector3) {
  spawnBurst(origin, {
    palette: FLAME_PALETTE,
    flash: Color4.create(1, 0.88, 0.18, 1),
    flashLight: Color3.create(1, 0.72, 0.12)
  })
}

function tickKnockFx(dt: number) {
  for (const shard of shards) {
    if (shard.life <= 0) continue
    shard.life -= dt
    if (shard.life <= 0) {
      hide(shard.entity)
      continue
    }
    const u = Math.max(0, shard.life / shard.maxLife)
    shard.vy -= shard.g * dt
    const transform = Transform.getMutable(shard.entity)
    transform.position.x += shard.vx * dt
    transform.position.y += shard.vy * dt
    transform.position.z += shard.vz * dt
    const fade = 0.18 + 0.82 * u
    transform.scale = Vector3.create(shard.sx * fade, shard.sy * fade, shard.sz * fade)
    transform.rotation = Quaternion.multiply(
      transform.rotation,
      Quaternion.fromAngleAxis(shard.wy * dt, Vector3.Up())
    )
    transform.rotation = Quaternion.multiply(
      transform.rotation,
      Quaternion.fromAngleAxis(shard.wx * dt, Vector3.Right())
    )
    transform.rotation = Quaternion.multiply(
      transform.rotation,
      Quaternion.fromAngleAxis(shard.wz * dt, Vector3.Forward())
    )
  }

  if (!flash || flashLife <= 0) return
  flashLife -= dt
  if (flashLife <= 0) {
    hide(flash)
    if (flashLight) {
      const light = LightSource.getMutable(flashLight)
      light.active = false
      light.intensity = 0
      hide(flashLight)
    }
    return
  }
  const u = 1 - flashLife / 0.28
  const pulse = u < 0.28 ? u / 0.28 : 1 - (u - 0.28) / 0.72
  const s = 0.18 + pulse * 0.95
  const transform = Transform.getMutable(flash)
  transform.scale = Vector3.create(s, s, s)
  if (flashLight) {
    const light = LightSource.getMutable(flashLight)
    light.active = true
    light.intensity = 9000 * pulse
    light.range = 6 * pulse
  }
}
