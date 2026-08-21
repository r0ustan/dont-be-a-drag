export const C = {
  ink: { r: 0.06, g: 0.08, b: 0.11, a: 0.94 },
  inkSolid: { r: 0.07, g: 0.09, b: 0.13, a: 1 },
  panel: { r: 0.09, g: 0.11, b: 0.16, a: 0.96 },
  row: { r: 0.13, g: 0.16, b: 0.22, a: 1 },
  frame: { r: 0.89, g: 0.29, b: 0.22, a: 1 },
  accent: { r: 0.95, g: 0.38, b: 0.28, a: 1 },
  dim: { r: 0, g: 0, b: 0, a: 0.58 },
  text: { r: 0.96, g: 0.97, b: 0.98, a: 1 },
  mute: { r: 0.62, g: 0.68, b: 0.74, a: 1 },
  gold: { r: 1, g: 0.78, b: 0.28, a: 1 },
  green: { r: 0.28, g: 0.86, b: 0.52, a: 1 },
  teal: { r: 0.22, g: 0.78, b: 0.78, a: 1 },
  red: { r: 0.95, g: 0.22, b: 0.28, a: 1 },
  track: { r: 0.16, g: 0.2, b: 0.26, a: 1 },
  btnPrimary: { r: 0.89, g: 0.29, b: 0.22, a: 1 },
  btnPrimaryText: { r: 1, g: 1, b: 1, a: 1 },
  btnSecondary: { r: 0.11, g: 0.14, b: 0.19, a: 1 },
  btnSecondaryText: { r: 0.96, g: 0.97, b: 0.98, a: 1 },
  btnDisabled: { r: 0.34, g: 0.36, b: 0.4, a: 1 },
  btnDisabledText: { r: 0.7, g: 0.72, b: 0.76, a: 1 },
  close: { r: 0.16, g: 0.18, b: 0.24, a: 1 },
  touchCapture: { r: 0, g: 0, b: 0, a: 0.001 }
}

export const PANEL_W = 1032
export const PANEL_H = 648
export const PANEL_TOP_MARGIN = 96
export const CONTENT_LEFT = 62
export const CONTENT_TOP = 96
export const CONTENT_BOTTOM = 65
export const CONTENT_W = PANEL_W - CONTENT_LEFT * 2
export const PLAQUE_W = 320
export const PLAQUE_H = 82
export const PLAQUE_TOP = -8

export type PanelMetrics = {
  panelW: number
  panelH: number
  contentLeft: number
  contentTop: number
  contentBottom: number
  contentW: number
  plaqueW: number
  plaqueH: number
  plaqueTop: number
}

export function getPanelMetrics(mobile: boolean): PanelMetrics {
  if (mobile) {
    const panelW = 700
    const contentLeft = 22
    return {
      panelW,
      panelH: 560,
      contentLeft,
      contentTop: 78,
      contentBottom: 36,
      contentW: panelW - contentLeft * 2,
      plaqueW: 280,
      plaqueH: 68,
      plaqueTop: -4
    }
  }
  return {
    panelW: PANEL_W,
    panelH: PANEL_H,
    contentLeft: CONTENT_LEFT,
    contentTop: CONTENT_TOP,
    contentBottom: CONTENT_BOTTOM,
    contentW: CONTENT_W,
    plaqueW: PLAQUE_W,
    plaqueH: PLAQUE_H,
    plaqueTop: PLAQUE_TOP
  }
}
