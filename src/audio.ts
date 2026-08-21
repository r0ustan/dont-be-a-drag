import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

const CLIP = {
  death: 'sounds/death.mp3',
  doorOpen: 'sounds/DoorOpen.mp3',
  doorUnlock: 'sounds/DoorUnlock.mp3',
  hit: 'sounds/hit.mp3',
  gong: 'sounds/gong.mp3',
  lobby: 'sounds/lobby.mp3',
  music: 'sounds/music.mp3',
  wilhelm: 'sounds/wilhelm.mp3',
  win: 'sounds/win.mp3'
} as const

type Bed = 'off' | 'lobby' | 'music'

let deathEnt: Entity
let doorOpenEnt: Entity
let doorUnlockEnt: Entity
let hitEnt: Entity
let gongEnt: Entity
let lobbyEnt: Entity
let musicEnt: Entity
let wilhelmEnt: Entity
let winEnt: Entity
let booted = false
let bed: Bed = 'off'
let doorOpenAt = 0
const gateWasOpen = new Map<number, boolean>()
const padsWereOn = new Map<string, boolean>()

function make(clip: string, loop: boolean, volume: number) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, 0, 0) })
  AudioSource.create(entity, {
    audioClipUrl: clip,
    playing: false,
    loop,
    volume,
    global: true
  })
  return entity
}

function oneshot(entity: Entity, clip: string, volume = 1) {
  if (!booted) return
  AudioSource.createOrReplace(entity, {
    audioClipUrl: clip,
    playing: true,
    loop: false,
    volume,
    global: true,
    currentTime: 0
  })
}

export function setupAudio() {
  if (booted) return
  booted = true
  deathEnt = make(CLIP.death, false, 1)
  doorOpenEnt = make(CLIP.doorOpen, false, 1)
  doorUnlockEnt = make(CLIP.doorUnlock, false, 1)
  hitEnt = make(CLIP.hit, false, 0.9)
  gongEnt = make(CLIP.gong, false, 1)
  lobbyEnt = make(CLIP.lobby, true, 0.38)
  musicEnt = make(CLIP.music, true, 0.42)
  wilhelmEnt = make(CLIP.wilhelm, false, 1)
  winEnt = make(CLIP.win, false, 1)
  setMusicBed('lobby')
}

export function setMusicBed(next: Bed) {
  if (!booted || next === bed) return
  bed = next
  AudioSource.createOrReplace(lobbyEnt, {
    audioClipUrl: CLIP.lobby,
    playing: next === 'lobby',
    loop: true,
    volume: 0.38,
    global: true,
    currentTime: next === 'lobby' ? 0 : undefined
  })
  AudioSource.createOrReplace(musicEnt, {
    audioClipUrl: CLIP.music,
    playing: next === 'music',
    loop: true,
    volume: 0.42,
    global: true,
    currentTime: next === 'music' ? 0 : undefined
  })
}

export function playDeath() {
  setMusicBed('off')
  oneshot(deathEnt, CLIP.death)
}

export function playWilhelm() {
  oneshot(wilhelmEnt, CLIP.wilhelm)
}

export function playHit() {
  oneshot(hitEnt, CLIP.hit, 0.9)
}

export function playGong() {
  oneshot(gongEnt, CLIP.gong)
}

export function playWin() {
  setMusicBed('off')
  oneshot(winEnt, CLIP.win)
}

export function playDoorOpen() {
  if (!booted) return
  const now = Date.now()
  if (now - doorOpenAt < 90) return
  doorOpenAt = now
  oneshot(doorOpenEnt, CLIP.doorOpen)
}

export function playDoorUnlock() {
  oneshot(doorUnlockEnt, CLIP.doorUnlock)
}

export function noteGate(id: number, open: boolean) {
  const was = gateWasOpen.get(id) === true
  gateWasOpen.set(id, open)
  if (open && !was) playDoorOpen()
}

export function notePads(id: string, both: boolean) {
  const was = padsWereOn.get(id) === true
  padsWereOn.set(id, both)
  if (both && !was) playDoorUnlock()
}

export function resetAudioCues() {
  gateWasOpen.clear()
  padsWereOn.clear()
  doorOpenAt = 0
}
