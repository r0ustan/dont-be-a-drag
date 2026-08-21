export type Phase = 'lobby' | 'waiting' | 'countdown' | 'playing' | 'won' | 'failed'

export type HudState = {
  phase: Phase
  title: string
  subtitle: string
  hint: string
  partnerName: string
  tension: number
  timeMs: number
  readyCount: number
  practice: boolean
  banner: string
  iAmReady: boolean
  howToOpen: boolean
  resultDismissed: boolean
  roster: string
  canStart: boolean
  iAmPlaying: boolean
  inQueue: boolean
  serverReady: boolean
  spectatePrompt: boolean
  bannerAlpha: number
  afkPrompt: boolean
  afkSecondsLeft: number
}

export const hud: HudState = {
  phase: 'lobby',
  title: "DON'T BE A DRAG!",
  subtitle: 'Find 2-4 players and link up',
  hint: 'Link up, then press Start when your team is ready.',
  partnerName: '',
  tension: 0,
  timeMs: 0,
  readyCount: 0,
  practice: false,
  banner: '',
  iAmReady: false,
  howToOpen: false,
  resultDismissed: false,
  roster: '',
  canStart: false,
  iAmPlaying: false,
  inQueue: false,
  serverReady: false,
  spectatePrompt: false,
  bannerAlpha: 1,
  afkPrompt: false,
  afkSecondsLeft: 0
}

export function setHud(partial: Partial<HudState>) {
  Object.assign(hud, partial)
}

export const uiActions: {
  join: () => void
  practice: () => void
  start: () => void
  spectateYes: () => void
  spectateNo: () => void
  afkHere: () => void
} = {
  join: () => undefined,
  practice: () => undefined,
  start: () => undefined,
  spectateYes: () => undefined,
  spectateNo: () => undefined,
  afkHere: () => undefined
}
