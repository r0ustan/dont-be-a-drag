import {
  Animator,
  Billboard,
  BillboardMode,
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  Material,
  MaterialTransparencyMode,
  MeshCollider,
  MeshRenderer,
  TextureFilterMode,
  TextureWrapMode,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { C, PLATFORM_TOP, SCENE_HEIGHT, SCENE_SIZE, START_WALL_H } from './config'
import { bindMover, Deck, FlameHazard, Mover, MoverKind, MoverMotion } from './movers'

export type WorldHandles = {
  plateA: Entity
  plateB: Entity
  plateAPos: Vector3
  plateBPos: Vector3
  finishCenter: Vector3
  gate: Entity
  gateClosedY: number
  midPlateA: Entity
  midPlateB: Entity
  midPlateAPos: Vector3
  midPlateBPos: Vector3
  midGate: Entity
  midGateClosedY: number
  startGate: Entity
  startGateClosedY: number
  startA: Vector3
  startB: Vector3
  startSlots: Vector3[]
  decks: Deck[]
  movers: Mover[]
  flameHazards: FlameHazard[]
}

const decks: Deck[] = []
const movers: Mover[] = []
const flameHazards: FlameHazard[] = []
const flames: { entity: Entity; frame: number; acc: number }[] = []
let flameSystemAdded = false

const FLAME_SRC = 'images/flame.png'
const FLAME_FRAMES = 10
const FLAME_FPS = 24
const FLAME_W = 0.72 * 0.85 * 0.72 * 1.15 * 1.10 * 1.2
const FLAME_H = 1.15 * 0.85 * 1.15 * 1.2
const FLAME_Y_OFFSET = 0.38
const FLAME_Y_DROP = 0.15

const FLAME_TEX = Material.Texture.Common({
  src: FLAME_SRC,
  filterMode: TextureFilterMode.TFM_POINT,
  wrapMode: TextureWrapMode.TWM_CLAMP
})

function pbr(entity: Entity, color: Color4, emissive?: Color4) {
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    roughness: 0.72,
    metallic: 0.05,
    emissiveColor: emissive ?? Color4.create(0, 0, 0, 1),
    emissiveIntensity: emissive ? 2.4 : 0
  })
}

export function box(
  position: Vector3,
  scale: Vector3,
  color: Color4,
  collider = true,
  emissive?: Color4,
  rotation = Quaternion.Identity()
): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position, scale, rotation })
  MeshRenderer.setBox(entity)
  if (collider) MeshCollider.setBox(entity, [ColliderLayer.CL_PHYSICS, ColliderLayer.CL_POINTER])
  pbr(entity, color, emissive)
  return entity
}

/** sphere.glb — ~0.80 diameter with sphere_collider; clip name Animation. */
const SPHERE_MODEL_DIAMETER = 0.8

function sphereGlb(position: Vector3, scale = 1): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: Vector3.create(scale, scale, scale)
  })
  GltfContainer.create(entity, {
    src: 'models/sphere.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  Animator.create(entity, {
    states: [
      {
        clip: 'Animation',
        playing: true,
        loop: true,
        shouldReset: false,
        speed: 1
      }
    ]
  })
  return entity
}

/** post.glb — vertical cylinder ~0.38 × 1.97 × 0.38; clip name Animation. */
const POST_MODEL = Vector3.create(0.38, 1.97, 0.38)

function postGlb(position: Vector3, rotation: Quaternion = Quaternion.Identity(), scale = 1): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: Vector3.create(scale, scale, scale),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/post.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  Animator.create(entity, {
    states: [
      {
        clip: 'Animation',
        playing: true,
        loop: true,
        shouldReset: false,
        speed: 1
      }
    ]
  })
  return entity
}

function addOrbitSpheres(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  beamTop: number,
  radius: number,
  diameter: number,
  period: number
) {
  const dx = x2 - x1
  const dz = z2 - z1
  const len = Math.hypot(dx, dz) || 1
  const ux = dx / len
  const uz = dz / len
  const cy = beamTop - 1.05
  const e1x = -uz
  const e1z = ux
  // Even spacing matching the 1st→2nd gap.
  const startT = 0.12
  const gap = 0.24 * 0.85 * 0.85
  let t = startT
  const knock = diameter || SPHERE_MODEL_DIAMETER
  for (let i = 0; i < 4; i++) {
    const cx = x1 + ux * len * t
    const cz = z1 + uz * len * t
    const ang = (i * Math.PI) / 2
    const px = cx + radius * Math.cos(ang) * e1x
    const py = cy + radius * Math.sin(ang)
    const pz = cz + radius * Math.cos(ang) * e1z
    const size = Vector3.create(knock, knock, knock)
    const entity = sphereGlb(Vector3.create(px, py, pz))
    const mover = bindMover(entity, 'hazard', cx, cy, cz, ux, cy, uz, size, period, ang, 'orbit')
    mover.orbitRadius = radius
    mover.orbitAxisX = ux
    mover.orbitAxisZ = uz
    mover.orbitSign = i % 2 === 0 ? 1 : -1
    mover.lastX = px
    mover.lastY = py
    mover.lastZ = pz
    movers.push(mover)
    t += gap
  }
}

let rockPlatformCount = 0

function platform(
  x: number,
  z: number,
  width: number,
  depth: number,
  color: Color4,
  top = PLATFORM_TOP,
  scaleOverride?: number,
  useLit = false
): Entity {
  const baseScale = 1.7
  if (isSand(color) || isDarkWood(color)) {
    const index = rockPlatformCount++
    const scale =
      scaleOverride ?? (index === 0 || index === 2 ? baseScale * 2 : baseScale)
    const rotation = Quaternion.fromEulerDegrees(0, rockYawDegrees(x, z), 0)
    const model = isSand(color) ? STATIC_ROCK_MODEL : STATIC_PLATFORM1_MODEL
    decks.push({
      x,
      z,
      w: model.x * scale,
      d: model.z * scale,
      top
    })
    const position = Vector3.create(x, top - (model.y * scale) / 2, z)
    if (useLit && !isSand(color)) return litPlatformGlb(position, scale, rotation)
    return isSand(color) ? staticRockGlb(position, scale, rotation) : staticPlatform1Glb(position, scale, rotation)
  }
  const thickness = 0.5
  decks.push({ x, z, w: width, d: depth, top })
  return box(Vector3.create(x, top - thickness / 2, z), Vector3.create(width, thickness, depth), color)
}

/** Stable per-spot yaw so client/server match; positive Y is clockwise in DCL. */
function rockYawDegrees(x: number, z: number) {
  const n = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453)
  return (n % 1) * 360
}

function isSand(color: Color4) {
  return color.r === C.sand.r && color.g === C.sand.g && color.b === C.sand.b && color.a === C.sand.a
}

function isDarkWood(color: Color4) {
  return (
    (color.r === C.wood.r && color.g === C.wood.g && color.b === C.wood.b && color.a === C.wood.a) ||
    (color.r === C.woodDark.r && color.g === C.woodDark.g && color.b === C.woodDark.b && color.a === C.woodDark.a)
  )
}

/** StaticRock2.glb — ~1.90 × 0.96 × 1.90 with baked collider. */
const STATIC_ROCK_MODEL = Vector3.create(1.904158, 0.960991, 1.90143)

function staticRockGlb(position: Vector3, scale = 1.7, rotation: Quaternion = Quaternion.Identity()): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: Vector3.create(scale, scale, scale),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/StaticRock2.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  return entity
}

/** StaticPlatform1.glb — ~1.79 × 1.48 × 1.90 with baked collider. */
const STATIC_PLATFORM1_MODEL = Vector3.create(1.786239, 1.480416, 1.897299)

function staticPlatform1Glb(
  position: Vector3,
  scale: number | Vector3 = 1.7,
  rotation: Quaternion = Quaternion.Identity()
): Entity {
  const s = typeof scale === 'number' ? Vector3.create(scale, scale, scale) : scale
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: s,
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/StaticPlatform1.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  return entity
}

/** lit.glb — same footprint as StaticPlatform1 (~1.79 × 1.48 × 1.90); no *_collider mesh. */
function litPlatformGlb(
  position: Vector3,
  scale: number | Vector3 = 1.7,
  rotation: Quaternion = Quaternion.Identity()
): Entity {
  const s = typeof scale === 'number' ? Vector3.create(scale, scale, scale) : scale
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: s,
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/lit.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return entity
}

function plank(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  top: number,
  width: number,
  _color: Color4,
  scale: Vector3 = Vector3.create(1, 1, 1)
) {
  const dx = x2 - x1
  const dz = z2 - z1
  const len = Math.hypot(dx, dz)
  const yaw = Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
  // local X = width across plank, Y = height, Z = along plank
  longGlb(
    Vector3.create((x1 + x2) / 2, top - (LONG_MODEL_SIZE * scale.y) / 2, (z1 + z2) / 2),
    scale,
    yaw
  )
  const deckW = width * scale.x + 0.55
  const steps = Math.max(2, Math.ceil((len * scale.z) / 1.5))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    decks.push({ x: x1 + dx * t, z: z1 + dz * t, w: deckW, d: deckW, top })
  }
}

/** long.glb — 2×2×2 visible Cube only (no _collider mesh). */
const LONG_MODEL_SIZE = 2

function longGlb(position: Vector3, scale: Vector3, rotation: Quaternion = Quaternion.Identity()): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale,
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/long.glb',
    // Model has no invisible *_collider mesh — collide with the visible Cube.
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return entity
}

/**
 * lobby.glb — start/finish room shell (floor + side walls + ceiling + entrance beam).
 * Floor top sits LOBBY_FLOOR_TOP above the entity origin; walls center near local Z≈0.
 * No *_collider mesh — collide with visible geometry.
 */
const LOBBY_FLOOR_TOP = 0.67672
const LOBBY_FLOOR_W = 16
const LOBBY_FLOOR_D = 12

function lobbyGlb(position: Vector3, rotation: Quaternion = Quaternion.Identity()): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: Vector3.create(1, 1, 1),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/lobby.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return entity
}

/**
 * wall.glb — room door / end-wall panel (same lobby node offset).
 * Bottom sits WALL_Y_MIN above the entity origin; face is offset along +Z.
 * Scaled on Y to match room wall height. No *_collider — collide with visible mesh.
 */
const WALL_MODEL_H = 13.5
const WALL_Y_MIN = -0.02139
/** wall.glb AABB center in model space (before any ceiling pitch). */
const WALL_MODEL_CENTER = Vector3.create(-0.01045, 6.72861, 5.88508)

function wallGlb(
  floorTop: number,
  positionXZ: Vector3,
  rotation: Quaternion = Quaternion.Identity(),
  height = START_WALL_H
): Entity {
  const scaleY = height / WALL_MODEL_H
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(positionXZ.x, floorTop - WALL_Y_MIN * scaleY, positionXZ.z),
    scale: Vector3.create(1, scaleY, 1),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/wall.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return entity
}

/** Lay wall.glb flat as a ceiling slab, just under the lobby shell so it reads from inside. */
function wallCeilingGlb(floorTop: number, center: Vector3, yaw: Quaternion, roomH: number): Entity {
  // +90° pitch: wall +Z face points down so the visible side faces the room.
  const rotation = Quaternion.multiply(yaw, Quaternion.fromEulerDegrees(90, 0, 0))
  const offset = Vector3.rotate(WALL_MODEL_CENTER, rotation)
  // Nest under lobby.glb ceiling underside (~floorTop + 11.13).
  const ceilingCenterY = floorTop + roomH - 0.3
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(center.x - offset.x, ceilingCenterY - offset.y, center.z - offset.z),
    scale: Vector3.create(1, 1, 1),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/wall.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return entity
}

function lantern(x: number, z: number, top = PLATFORM_TOP) {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(x, top + (TORCH_MODEL.y * TORCH_SCALE) / 2, z),
    scale: Vector3.create(TORCH_SCALE, TORCH_SCALE, TORCH_SCALE)
  })
  GltfContainer.create(entity, {
    src: 'models/torch.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  addTorchFlame(x, z, top + TORCH_MODEL.y * TORCH_SCALE)
}

/** torch.glb — ~0.11 × 0.40 × 0.12 with rock_collider. Scaled to lamp-post height. */
const TORCH_MODEL = Vector3.create(0.106, 0.403, 0.124)
const TORCH_SCALE = 4

function flameUvs(frame: number) {
  const w = 1 / FLAME_FRAMES
  const u0 = (frame % FLAME_FRAMES) * w
  const u1 = u0 + w
  // Plane verts run BL → TL → TR → BR; map V (flame up) along that vertical edge.
  return [u0, 0, u0, 1, u1, 1, u1, 0, u0, 1, u0, 0, u1, 0, u1, 1]
}

function initFlameMaterial(entity: Entity) {
  Material.setPbrMaterial(entity, {
    texture: FLAME_TEX,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_TEST,
    alphaTest: 0.15,
    metallic: 0,
    roughness: 1,
    emissiveColor: Color3.create(1, 0.55, 0.15),
    emissiveIntensity: 4,
    albedoColor: Color4.create(1, 1, 1, 1)
  })
}

function setFlameFrame(entity: Entity, frame: number) {
  MeshRenderer.setPlane(entity, flameUvs(frame))
}

function addTorchFlame(x: number, z: number, bowlY: number) {
  const y = bowlY + FLAME_H * FLAME_Y_OFFSET - FLAME_Y_DROP
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(x, y, z),
    scale: Vector3.create(FLAME_W, FLAME_H, 1)
  })
  Billboard.create(entity, { billboardMode: BillboardMode.BM_Y })
  const frame = flames.length % FLAME_FRAMES
  setFlameFrame(entity, frame)
  initFlameMaterial(entity)
  flames.push({ entity, frame, acc: (flames.length % 3) * 0.03 })
  flameHazards.push({
    x,
    y,
    z,
    size: Vector3.create(FLAME_W * 1.15, FLAME_H, FLAME_W * 1.15),
    knockCd: 0,
    dummyKnockCd: 0,
    forceSource: engine.addEntity()
  })
}

function tickFlames(dt: number) {
  const step = 1 / FLAME_FPS
  for (const flame of flames) {
    flame.acc += dt
    if (flame.acc < step) continue
    flame.acc -= step
    flame.frame = (flame.frame + 1) % FLAME_FRAMES
    setFlameFrame(flame.entity, flame.frame)
  }
}

function addMover(
  kind: MoverKind,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  width: number,
  height: number,
  depth: number,
  period: number,
  color: Color4,
  phase = 0,
  emissive?: Color4,
  motion: MoverMotion = 'slide',
  rotation: Quaternion = Quaternion.Identity(),
  preferSpinner = false,
  glbScale?: number
) {
  const useSpinnerGlb = (kind === 'platform' && motion === 'spin') || preferSpinner
  const useMovingGlb = kind === 'platform' && motion !== 'spin' && !preferSpinner
  const usePostGlb = kind === 'hazard'
  const spinnerScale = glbScale ?? SPINNER_SCALE
  const movingScale = glbScale ?? MOVING_PLATFORM_SCALE
  let size = Vector3.create(width, height, depth)
  let posY = ay
  let posBY = by
  if (useMovingGlb) {
    const half = (MOVING_PLATFORM_MODEL.y * movingScale) / 2
    const topA = ay + height / 2
    const topB = by + height / 2
    posY = topA - half
    posBY = topB - half
    size = Vector3.create(
      MOVING_PLATFORM_MODEL.x * movingScale,
      MOVING_PLATFORM_MODEL.y * movingScale,
      MOVING_PLATFORM_MODEL.z * movingScale
    )
  } else if (useSpinnerGlb) {
    const half = (SPINNER_MODEL.y * spinnerScale) / 2
    const topA = ay + height / 2
    const topB = by + height / 2
    posY = topA - half
    posBY = topB - half
    size = Vector3.create(
      SPINNER_MODEL.x * spinnerScale,
      SPINNER_MODEL.y * spinnerScale,
      SPINNER_MODEL.z * spinnerScale
    )
  } else if (usePostGlb) {
    size = Vector3.create(POST_MODEL.x, POST_MODEL.y, POST_MODEL.z)
  }
  const position = Vector3.create(ax, posY, az)
  const entity = useSpinnerGlb
    ? spinnerGlb(position, rotation, spinnerScale)
    : useMovingGlb
      ? movingPlatformGlb(position, rotation, movingScale)
      : usePostGlb
        ? postGlb(position, rotation)
        : box(position, size, color, true, emissive, rotation)
  const mover = bindMover(entity, kind, ax, posY, az, bx, posBY, bz, size, period, phase, motion, rotation)
  movers.push(mover)
  return mover
}

/** Authored model is ~1.9 × 0.51 × 1.84; visible Rock only (no *_collider mesh). */
const MOVING_PLATFORM_MODEL = Vector3.create(1.902757, 0.510869, 1.83677)
const MOVING_PLATFORM_SCALE = 1.7

function movingPlatformGlb(
  position: Vector3,
  rotation: Quaternion = Quaternion.Identity(),
  scale = MOVING_PLATFORM_SCALE
): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: Vector3.create(scale, scale, scale),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/MovingPlatform.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return entity
}

/** spinner.glb — ~1.89 × 0.98 × 1.34 with baked collider. */
const SPINNER_MODEL = Vector3.create(1.885573, 0.979165, 1.343318)
const SPINNER_SCALE = 1.7

function spinnerGlb(
  position: Vector3,
  rotation: Quaternion = Quaternion.Identity(),
  scale = SPINNER_SCALE
): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position,
    scale: Vector3.create(scale, scale, scale),
    rotation
  })
  GltfContainer.create(entity, {
    src: 'models/spinner.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
  })
  return entity
}

function addSpinPlatform(
  x: number,
  z: number,
  width: number,
  depth: number,
  top: number,
  color: Color4,
  period: number,
  phase = 0
) {
  addMover('platform', x, top - 0.25, z, x, top - 0.25, z, width, 0.5, depth, period, color, phase, undefined, 'spin')
}

function stackedWall(x: number, z: number, sx: number, sz: number, height: number, color: Color4) {
  const slab = 8
  let y0 = 0
  while (y0 < height - 0.01) {
    const h = Math.min(slab, height - y0)
    box(Vector3.create(x, y0 + h / 2, z), Vector3.create(sx, h, sz), color)
    y0 += h
  }
}

export function createWorld(): WorldHandles {
  decks.length = 0
  movers.length = 0
  flames.length = 0
  flameHazards.length = 0
  rockPlatformCount = 0
  if (!flameSystemAdded) {
    flameSystemAdded = true
    engine.addSystem(tickFlames)
  }

  box(Vector3.create(SCENE_SIZE / 2, -0.2, SCENE_SIZE / 2), Vector3.create(SCENE_SIZE, 0.4, SCENE_SIZE), C.void)

  const wallH = SCENE_HEIGHT
  stackedWall(SCENE_SIZE / 2, 0.3, SCENE_SIZE, 0.6, wallH, C.canyonDark)
  stackedWall(SCENE_SIZE / 2, SCENE_SIZE - 0.3, SCENE_SIZE, 0.6, wallH, C.canyonDark)
  stackedWall(0.3, SCENE_SIZE / 2, 0.6, SCENE_SIZE, wallH, C.canyonDark)
  stackedWall(SCENE_SIZE - 0.3, SCENE_SIZE / 2, 0.6, SCENE_SIZE, wallH, C.canyonDark)

  // Start room shell — lobby.glb (floor, side walls, ceiling, entrance beam).
  decks.push({ x: 10, z: 9, w: LOBBY_FLOOR_W, d: LOBBY_FLOOR_D, top: PLATFORM_TOP })
  lobbyGlb(Vector3.create(10, PLATFORM_TOP - LOBBY_FLOOR_TOP, 9.4))
  lantern(4.2, 5.2)
  lantern(15.8, 5.2)
  lantern(4.2, 12.6)
  lantern(15.8, 12.6)

  // Start gate — wall.glb at lobby origin so the panel sits in the entrance.
  const startGate = wallGlb(PLATFORM_TOP, Vector3.create(10, 0, 9.4))
  const startGateClosedY = Transform.get(startGate).position.y

  platform(10, 18.1, 5.2, 6.2, C.wood)

  platform(10, 24.9, 1.55, 7.4, C.woodDark)

  platform(10, 31.6, 6.0, 6.0, C.wood, PLATFORM_TOP, undefined, true)
  lantern(7.4, 28.9)
  lantern(12.6, 28.9)

  const y1 = 13.6
  const y2 = 15.2
  const y3 = 16.8
  addSpinPlatform(14.4, 33.2, 2.5, 2.5, y1, C.sand, 7.2, 0)
  addSpinPlatform(17.3, 33.2, 2.5, 2.5, y2, C.sand, 7.2, 0.33)
  platform(20.2, 33.2, 2.7, 2.8, C.wood, y3)

  addMover(
    'platform',
    27.2,
    y3 - 0.25,
    33.2,
    23.0,
    y3 - 0.25,
    33.2,
    2.6,
    0.5,
    2.6,
    6.2,
    C.teal,
    0,
    C.teal,
    'slide',
    Quaternion.fromEulerDegrees(180, 0, 0)
  )

  platform(30.6, 33.2, 3.2, 3.4, C.wood, y3)

  // Hazard runway: same rock, Z stretched so the platform is longer along the column sweep.
  {
    const s = 1.7
    const scaleZ = 5.6 / STATIC_PLATFORM1_MODEL.z
    const scale = Vector3.create(s, s, scaleZ)
    decks.push({
      x: 36.4,
      z: 33.2,
      w: STATIC_PLATFORM1_MODEL.z * scaleZ,
      d: STATIC_PLATFORM1_MODEL.x * s,
      top: y3
    })
    staticPlatform1Glb(
      Vector3.create(36.4, y3 - (STATIC_PLATFORM1_MODEL.y * s) / 2, 33.2),
      scale,
      Quaternion.fromEulerDegrees(0, 90, 0)
    )
  }
  addMover('hazard', 33.6, y3 + 1.15, 30.5, 33.6, y3 + 1.15, 35.9, 0.5, 1.7, 0.5, 6.4, C.accent, 0, C.accent)
  addMover('hazard', 36.4, y3 + 1.15, 35.9, 36.4, y3 + 1.15, 30.5, 0.5, 1.7, 0.5, 6.6, C.accent, Math.PI * 0.5, C.accent)
  addMover('hazard', 39.2, y3 + 1.15, 35.9, 39.2, y3 + 1.15, 30.5, 0.5, 1.7, 0.5, 6.8, C.accent, Math.PI, C.accent)

  {
    const px = 42.5
    const pz = 33.2
    const toCx = 24 - px
    const toCz = 24 - pz
    const toC = Math.hypot(toCx, toCz) || 1
    platform(px + (toCx / toC) * 1.2, pz + (toCz / toC) * 1.2, 3.2, 3.4, C.wood, y3)
  }

  const CX = 24
  const CZ = 24
  const STEPS = 36
  const Y0 = 21.0
  const Y1 = 60.85
  const R0 = 21.0
  const R1 = 6.5
  const A0 = Math.atan2(38.4 - CZ, 44.0 - CX)
  const TURNS = (A0 + Math.PI / 2) / (Math.PI * 2) + 2
  const ferries = new Set([7, 16, 26])
  const sweepers = new Set([0, 9, 14, 23])
  const flips = new Set([3, 5, 28, 31])

  const spiralAt = (i: number) => {
    const t = i / (STEPS - 1)
    const ang = A0 - t * TURNS * Math.PI * 2
    const r = R0 + (R1 - R0) * t
    return {
      x: CX + Math.cos(ang) * r,
      z: CZ + Math.sin(ang) * r,
      y: Y0 + (Y1 - Y0) * t,
      ang,
      r
    }
  }

  const firstRaw = spiralAt(0)
  const entryDx = firstRaw.x - 44.0
  const entryDz = firstRaw.z - 35.8
  const entryDist = Math.hypot(entryDx, entryDz) || 1
  const entryUx = entryDx / entryDist
  const entryUz = entryDz / entryDist
  const first = {
    ...firstRaw,
    x: firstRaw.x + entryUx * 1.3,
    z: firstRaw.z + entryUz * 1.3,
    y: firstRaw.y - 1.0
  }

  let sweepX = -Math.sin(first.ang)
  let sweepZ = Math.cos(first.ang)
  {
    const c = Math.cos((135 * Math.PI) / 180)
    const s = Math.sin((135 * Math.PI) / 180)
    const rx = sweepX * c - sweepZ * s
    const rz = sweepX * s + sweepZ * c
    sweepX = rx
    sweepZ = rz
  }
  const parX = -sweepZ
  const parZ = sweepX
  const alongSign = parX * entryUx + parZ * entryUz < 0 ? -1 : 1
  const alongX = parX * alongSign
  const alongZ = parZ * alongSign

  const beamY = firstRaw.y + 2.7
  const beamNear = 3.8
  const beamFar = 19.7
  const p1x = first.x + alongX * beamNear
  const p1z = first.z + alongZ * beamNear
  const p2x = first.x + alongX * beamFar
  const p2z = first.z + alongZ * beamFar
  plank(p1x, p1z, p2x, p2z, beamY, 1.45, C.woodDark, Vector3.create(2, 1, 1))
  const destRaw = spiralAt(2)
  const destPull = (() => {
    const toCx = CX - destRaw.x
    const toCz = CZ - destRaw.z
    const toC = Math.hypot(toCx, toCz) || 1
    return { x: (toCx / toC) * 6, z: (toCz / toC) * 6 }
  })()
  const dest = {
    ...destRaw,
    x: destRaw.x + destPull.x,
    z: destRaw.z + destPull.z
  }
  const flipAfterRaw = spiralAt(3)
  const flipAfter = {
    ...flipAfterRaw,
    x: flipAfterRaw.x + destPull.x,
    z: flipAfterRaw.z + destPull.z
  }
  const flipNextRaw = spiralAt(5)
  const flipNext = (() => {
    const toCx = CX - flipNextRaw.x
    const toCz = CZ - flipNextRaw.z
    const toC = Math.hypot(toCx, toCz) || 1
    return {
      ...flipNextRaw,
      x: flipNextRaw.x + (toCx / toC) * 2,
      z: flipNextRaw.z + (toCz / toC) * 2
    }
  })()
  const afterFlipNextRaw = spiralAt(6)
  const afterFlipNext = (() => {
    const toCx = CX - afterFlipNextRaw.x
    const toCz = CZ - afterFlipNextRaw.z
    const toC = Math.hypot(toCx, toCz) || 1
    return {
      ...afterFlipNextRaw,
      x: afterFlipNextRaw.x + (toCx / toC) * 4,
      z: afterFlipNextRaw.z + (toCz / toC) * 4
    }
  })()
  const plank2Y = beamY + 2.6
  const toDestX = dest.x - p2x
  const toDestZ = dest.z - p2z
  const toDest = Math.hypot(toDestX, toDestZ) || 1
  const su = toDestX / toDest
  const sz = toDestZ / toDest
  // Slide the second plank toward the first along the join axis.
  const joinPull = 2.5
  const skinnyX1 = p2x + su * (0.4 - joinPull)
  const skinnyZ1 = p2z + sz * (0.4 - joinPull)
  const skinnyX2 = dest.x - su * (2.3 + joinPull)
  const skinnyZ2 = dest.z - sz * (2.3 + joinPull)
  plank(skinnyX1, skinnyZ1, skinnyX2, skinnyZ2, plank2Y, 0.68, C.woodDark, Vector3.create(1, 1, 1.2))
  // Keep orbit spheres off the joint (plank was pulled in; spheres stay further along the axis).
  const sphereNear = 2.2
  addOrbitSpheres(
    p2x + su * sphereNear,
    p2z + sz * sphereNear,
    dest.x - su * 2.3,
    dest.z - sz * 2.3,
    plank2Y,
    1.12,
    0.72,
    3.3
  )

  let flipVisualIndex = 0
  for (let i = 0; i < STEPS; i++) {
    const p =
      i === 0
        ? first
        : i === 2
          ? dest
          : i === 3
            ? flipAfter
            : i === 5
              ? flipNext
              : i === 6
                ? afterFlipNext
                : spiralAt(i)
    const size = i > STEPS - 4 ? 2.9 : 2.7
    const color = i % 2 === 0 ? C.wood : C.sand
    const isFerry = ferries.has(i)
    const isFerryLand = ferries.has(i - 1)
    const isFlip = flips.has(i)
    const isMidPlaza = i === 21

    if (isMidPlaza) {
      continue
    }

    if (isFlip) {
      const axis = Vector3.create(Math.cos(p.ang), 0, Math.sin(p.ang))
      // All flippers use spinner rock. 1st & 3rd at 2x; 2nd & 4th at 1.5x.
      // Second-to-last (3rd) is 20% smaller than the usual 2x.
      let flipScale =
        flipVisualIndex % 2 === 0 ? SPINNER_SCALE * 2 : SPINNER_SCALE * 1.5
      if (flipVisualIndex === 2) flipScale = SPINNER_SCALE * 2 * 0.8
      flipVisualIndex += 1
      const mover = addMover(
        'platform',
        p.x,
        p.y - 0.25,
        p.z,
        p.x,
        p.y - 0.25,
        p.z,
        size,
        0.5,
        size,
        6.4,
        C.teal,
        i === 3 || i === 31 ? 1 : 0,
        C.teal,
        'flip',
        Quaternion.Identity(),
        true,
        flipScale
      )
      mover.flipFlat = Quaternion.Identity()
      mover.flipOver = Quaternion.fromAngleAxis(180, axis)
      mover.flipFull = Quaternion.fromAngleAxis(360, axis)
    } else if (isFerry) {
      const q = spiralAt(Math.min(STEPS - 1, i + 1))
      // Third sliding MovingPlatform (early ferry + spiral ferries 7, 16, 26).
      const upsideDown = i === 16
      addMover(
        'platform',
        p.x,
        p.y - 0.25,
        p.z,
        q.x,
        q.y - 0.25,
        q.z,
        2.8,
        0.5,
        2.8,
        6.4,
        C.teal,
        i * 0.31,
        C.teal,
        'slide',
        upsideDown ? Quaternion.fromEulerDegrees(180, 0, 0) : Quaternion.Identity()
      )
    } else if (!isFerryLand && i !== 1 && i !== 30 && i !== 33 && i !== 35 && !(i >= 32 && i % 2 === 0)) {
      // Single-torch spiral pads use lit.glb (two-torch pads are marked separately).
      const singleTorch =
        i % 6 === 0 && i !== 0 && !isFerry && !isFerryLand && !isFlip && i !== 30
      platform(p.x, p.z, size, size, color, p.y, undefined, singleTorch)
    }

    if (sweepers.has(i)) {
      const span = size / 2 + 0.15
      let dirX = i === 0 ? -Math.sin(p.ang) : Math.cos(p.ang)
      let dirZ = i === 0 ? Math.cos(p.ang) : Math.sin(p.ang)
      if (i === 0) {
        const c = Math.cos((135 * Math.PI) / 180)
        const s = Math.sin((135 * Math.PI) / 180)
        const rx = dirX * c - dirZ * s
        const rz = dirX * s + dirZ * c
        dirX = rx
        dirZ = rz
      }
      addMover(
        'hazard',
        p.x - dirX * span,
        p.y + 1.0,
        p.z - dirZ * span,
        p.x + dirX * span,
        p.y + 1.0,
        p.z + dirZ * span,
        0.5,
        1.7,
        0.5,
        6.6,
        C.accent,
        i * 0.7,
        C.accent,
        'slide'
      )
    }

    if (i % 6 === 0 && i !== 0 && !isFerry && !isFerryLand && !isFlip && i !== 30) {
      const inset = size / 2 - 0.32
      lantern(
        p.x + Math.cos(p.ang) * inset + Math.sin(p.ang) * inset,
        p.z + Math.sin(p.ang) * inset - Math.cos(p.ang) * inset,
        p.y
      )
    }
  }

  const mid = spiralAt(21)
  const ahead = spiralAt(22)
  const toAhead = Math.hypot(ahead.x - mid.x, ahead.z - mid.z) || 1
  const ux = (ahead.x - mid.x) / toAhead
  const uz = (ahead.z - mid.z) / toAhead
  const px = -uz
  const pz = ux
  const midYaw = Quaternion.fromEulerDegrees(0, (Math.atan2(ux, uz) * 180) / Math.PI, 0)
  const midTop = mid.y
  // Mid pad rock: wide/flat so both plates and lanterns sit on the top face.
  {
    const midScaleX = 4
    const midScaleY = 0.8
    const midScaleZ = 4
    const midScale = Vector3.create(midScaleX, midScaleY, midScaleZ)
    rockPlatformCount += 1
    decks.push({
      x: mid.x,
      z: mid.z,
      w: STATIC_PLATFORM1_MODEL.x * midScaleX,
      d: STATIC_PLATFORM1_MODEL.z * midScaleZ,
      top: midTop
    })
    litPlatformGlb(
      Vector3.create(mid.x, midTop - (STATIC_PLATFORM1_MODEL.y * midScaleY) / 2, mid.z),
      midScale,
      Quaternion.fromEulerDegrees(0, rockYawDegrees(mid.x, mid.z), 0)
    )
  }
  lantern(mid.x + 2.15, mid.z + 2.15, midTop - 0.1)
  lantern(mid.x - 2.15, mid.z - 2.15, midTop - 0.1)

  const midPlateAPos = Vector3.create(mid.x + px * 1.35, midTop + 0.12, mid.z + pz * 1.35)
  const midPlateBPos = Vector3.create(mid.x - px * 1.35, midTop + 0.12, mid.z - pz * 1.35)
  const midPlateA = box(midPlateAPos, Vector3.create(1.45, 0.18, 1.45), C.plateOff, true, C.plateOff)
  const midPlateB = box(midPlateBPos, Vector3.create(1.45, 0.18, 1.45), C.plateOff, true, C.plateOff)
  // Mid two-step gate — wall.glb (face at former box position along the path).
  const midGateH = 9.5
  const midGateFaceZ = WALL_MODEL_CENTER.z
  const midGate = wallGlb(
    midTop,
    Vector3.create(18 - ux * midGateFaceZ, 0, 14 - uz * midGateFaceZ),
    midYaw,
    midGateH
  )
  const midGateClosedY = Transform.get(midGate).position.y

  const slot = spiralAt(33)
  const prev = spiralAt(31)
  const along = Math.hypot(slot.x - prev.x, slot.z - prev.z) || 1
  const fux = (slot.x - prev.x) / along
  const fuz = (slot.z - prev.z) / along
  const finishYaw = Quaternion.fromEulerDegrees(0, (Math.atan2(fux, fuz) * 180) / Math.PI, 0)
  const finishTop = slot.y - 2.4
  const fx = slot.x
  const fz = slot.z
  const localXZ = (ox: number, oz: number) =>
    Vector3.create(fx + ox * fuz + oz * fux, finishTop, fz - ox * fux + oz * fuz)

  const plazaOz = 3.0
  const plaza = localXZ(0, plazaOz)
  decks.push({ x: plaza.x, z: plaza.z, w: 18, d: 18, top: finishTop })
  // Finish room shell — same lobby.glb; rotate 180° so the entrance faces the course.
  const lobbyYaw = Quaternion.multiply(finishYaw, Quaternion.fromEulerDegrees(0, 180, 0))
  lobbyGlb(Vector3.create(plaza.x, finishTop - LOBBY_FLOOR_TOP, plaza.z), lobbyYaw)
  lantern(localXZ(-5.4, -2.4).x, localXZ(-5.4, -2.4).z, finishTop)
  lantern(localXZ(5.4, -2.4).x, localXZ(5.4, -2.4).z, finishTop)
  lantern(localXZ(-5.4, 8.2).x, localXZ(-5.4, 8.2).z, finishTop)
  lantern(localXZ(5.4, 8.2).x, localXZ(5.4, 8.2).z, finishTop)

  // Back wall, ceiling, and finish gate — wall.glb
  const roomH = Math.min(START_WALL_H, SCENE_HEIGHT - 0.55 - finishTop)
  wallGlb(finishTop, plaza, finishYaw, roomH)
  wallCeilingGlb(finishTop, plaza, finishYaw, roomH)

  const plateAPos = Vector3.create(localXZ(-1.7, -1.7).x, finishTop + 0.16, localXZ(-1.7, -1.7).z)
  const plateBPos = Vector3.create(localXZ(1.7, -1.7).x, finishTop + 0.16, localXZ(1.7, -1.7).z)
  const plateA = box(plateAPos, Vector3.create(1.5, 0.18, 1.5), C.plateOff, true, C.plateOff, finishYaw)
  const plateB = box(plateBPos, Vector3.create(1.5, 0.18, 1.5), C.plateOff, true, C.plateOff, finishYaw)

  // Finish gate behind the pads (face at oz 0.15). lobbyYaw aims +Z toward the course,
  // so shift the entity by WALL_MODEL_CENTER.z so the baked offset lands on that plane.
  const gateFaceOz = 0.15
  const gate = wallGlb(
    finishTop,
    localXZ(0, gateFaceOz + WALL_MODEL_CENTER.z),
    lobbyYaw,
    roomH
  )
  const gateClosedY = Transform.get(gate).position.y

  const gold = localXZ(0, 5.0)
  const finishCenter = Vector3.create(gold.x, finishTop, gold.z)
  box(Vector3.create(gold.x, finishTop + 0.08, gold.z), Vector3.create(3.2, 0.06, 2.8), C.gold, false, C.gold, finishYaw)

  const startSlots = [
    Vector3.create(7.6, PLATFORM_TOP + 0.2, 8.1),
    Vector3.create(8.9, PLATFORM_TOP + 0.2, 9.5),
    Vector3.create(11.1, PLATFORM_TOP + 0.2, 8.1),
    Vector3.create(12.4, PLATFORM_TOP + 0.2, 9.5)
  ]

  return {
    plateA,
    plateB,
    plateAPos,
    plateBPos,
    finishCenter,
    gate,
    gateClosedY,
    midPlateA,
    midPlateB,
    midPlateAPos,
    midPlateBPos,
    midGate,
    midGateClosedY,
    startGate,
    startGateClosedY,
    startA: startSlots[0],
    startB: startSlots[1],
    startSlots,
    decks: decks.slice(),
    movers,
    flameHazards
  }
}

export function setPlateLit(entity: Entity, on: boolean) {
  const color = on ? C.plateOn : C.plateOff
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    roughness: 0.4,
    metallic: 0.1,
    emissiveColor: on ? C.plateOn : Color4.create(0, 0, 0, 1),
    emissiveIntensity: on ? 3.2 : 0
  })
}

export function setGateOpen(gate: Entity, open: boolean, closedY: number, _drop = 10) {
  const transform = Transform.getMutable(gate)
  transform.position.y = closedY
  VisibilityComponent.createOrReplace(gate, { visible: !open })
  if (GltfContainer.has(gate)) {
    const gltf = GltfContainer.getMutable(gate)
    const mask = open ? ColliderLayer.CL_NONE : ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
    gltf.visibleMeshesCollisionMask = mask
    gltf.invisibleMeshesCollisionMask = ColliderLayer.CL_NONE
  } else if (open) {
    if (MeshCollider.has(gate)) MeshCollider.deleteFrom(gate)
  } else {
    MeshCollider.setBox(gate, [ColliderLayer.CL_PHYSICS, ColliderLayer.CL_POINTER])
  }
}
