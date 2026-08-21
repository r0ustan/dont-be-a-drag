import { Color4 } from '@dcl/sdk/math'

export const SCENE_SIZE = 48
export const SCENE_HEIGHT = 66.4
export const PLATFORM_TOP = 12
export const START_WALL_H = 11.2
export const FINISH_TOP = 61.4
export const ROPE_MAX = 4
export const ROPE_SOFT = 3
export const ROPE_SEGMENTS = 16
export const ROPE_RADIUS = 0.07
export const ROPE_STIFFNESS = 26
export const ROPE_MAX_FORCE = 55
export const ROPE_SPLIT_FORCE = 72
export const ROPE_DEADZONE = 0.05
export const FALL_Y = 8
export const GROUND_Y = 1.8
export const SPAWN_Y = PLATFORM_TOP + 2
export const SPECTATE_POS = { x: 10.95, y: 25, z: 8.78 }
export const SPECTATE_LOOK = { x: 16, y: 18, z: 22 }
export const COUNTDOWN_MS = 5000
export const KNOCK_IMPULSE = 10
export const KNOCK_FORCE = 16
export const MAX_PLAYERS = 4
/** Enough for a full mesh of MAX_PLAYERS (n*(n-1)/2). */
export const ROPE_LINES = 6
export const AFK_IDLE_SEC = 30
export const AFK_PROMPT_SEC = 10
export const AFK_MOVE_EPS = 0.4

/** Permanent co-op finish leaderboard (Hetzner JSON store). */
export const LEADERBOARD_API_BASE = ''

export const C = {
  void: Color4.create(0.06, 0.045, 0.07, 1),
  canyon: Color4.create(0.42, 0.26, 0.17, 1),
  canyonDark: Color4.create(0.28, 0.16, 0.11, 1),
  wood: Color4.create(0.66, 0.44, 0.27, 1),
  woodDark: Color4.create(0.38, 0.24, 0.15, 1),
  sand: Color4.create(0.84, 0.7, 0.5, 1),
  accent: Color4.create(0.92, 0.36, 0.2, 1),
  gold: Color4.create(0.95, 0.78, 0.28, 1),
  green: Color4.create(0.22, 0.72, 0.4, 1),
  teal: Color4.create(0.16, 0.62, 0.62, 1),
  rope: Color4.create(0.78, 0.54, 0.28, 1),
  ropeHot: Color4.create(0.92, 0.18, 0.14, 1),
  white: Color4.create(1, 1, 1, 1),
  ink: Color4.create(0.12, 0.08, 0.07, 1),
  plateOff: Color4.create(0.35, 0.32, 0.3, 1),
  plateOn: Color4.create(0.3, 0.85, 0.45, 1)
}
