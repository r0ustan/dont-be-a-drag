import ReactEcs, { Label, ReactEcsRenderer, ScreenInsetArea, UiEntity } from '@dcl/sdk/react-ecs'
import { getNotification } from './notify'
import { hud, setHud } from './state'
import { BottomBar } from './ui/BottomBar'
import { AfkPanel } from './ui/AfkPanel'
import { HowToPanel } from './ui/HowToPanel'
import { ResultPanel } from './ui/ResultPanel'
import { SpectatePanel } from './ui/SpectatePanel'
import { C } from './ui/theme'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(MainUi, {
    virtualWidth: 1920,
    virtualHeight: 1080,
    screenInset: 'none'
  })
}

function runClock() {
  const ms = Math.max(0, Math.floor(hud.timeMs))
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = ms % 1000
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`
}

const MainUi = () => {
  const note = getNotification()
  const showResult = hud.iAmPlaying && hud.phase === 'failed' && !hud.resultDismissed
  const showHowTo = hud.howToOpen && !showResult
  const showSpectate = hud.spectatePrompt && !showResult && !showHowTo
  const showAfk = hud.afkPrompt && !showResult
  const overlayOpen = showHowTo || showResult || showSpectate || showAfk
  const inRun =
    hud.iAmPlaying &&
    (hud.phase === 'countdown' || hud.phase === 'playing' || hud.phase === 'won' || hud.phase === 'failed')
  const showBanner = hud.banner !== '' && !overlayOpen && hud.iAmPlaying
  const showBottom = !overlayOpen && !inRun
  const showLobbyHint = !overlayOpen && showBottom && !hud.iAmReady && (hud.phase === 'lobby' || hud.phase === 'waiting')

  const closeOverlay = () => {
    if (showAfk) return
    if (showHowTo) setHud({ howToOpen: false })
    if (showResult) setHud({ resultDismissed: true, banner: '' })
    if (showSpectate) setHud({ spectatePrompt: false })
  }

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
      {overlayOpen && (
        <UiEntity
          uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}
          uiBackground={{ color: C.dim }}
          onMouseDown={closeOverlay}
        />
      )}
      <ScreenInsetArea>
        <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
          {showBottom && <BottomBar />}
          {(hud.phase === 'playing' || hud.phase === 'won') && !overlayOpen && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 64,
                positionType: 'absolute',
                position: { top: 18, left: 0 },
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              <UiEntity uiTransform={{ width: 420, height: 64, flexShrink: 0 }}>
                <Label
                  value={runClock()}
                  fontSize={42}
                  font="monospace"
                  color={C.gold}
                  textAlign="middle-left"
                  uiTransform={{ width: 420, height: 64 }}
                />
              </UiEntity>
            </UiEntity>
          )}
          {showBanner && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: hud.phase === 'won' ? 160 : 110,
                positionType: 'absolute',
                position: { top: 220, left: 0 },
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              <Label
                value={hud.banner}
                fontSize={hud.banner.length > 12 ? 52 : 84}
                color={{
                  ...(hud.phase === 'failed' ? C.red : hud.phase === 'won' ? C.green : C.gold),
                  a: hud.phase === 'won' ? hud.bannerAlpha : 1
                }}
                textAlign="middle-center"
                uiTransform={{ width: 1700, height: hud.phase === 'won' ? 90 : 110 }}
              />
              {hud.phase === 'won' && !!hud.subtitle && (
                <Label
                  value={hud.subtitle}
                  fontSize={28}
                  color={{ ...C.text, a: hud.bannerAlpha }}
                  textAlign="middle-center"
                  uiTransform={{ width: 1700, height: 40 }}
                />
              )}
            </UiEntity>
          )}
          {showHowTo && <HowToPanel />}
          {showResult && <ResultPanel />}
          {showSpectate && <SpectatePanel />}
          {showAfk && <AfkPanel />}
          {note.visible && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 72,
                positionType: 'absolute',
                position: { top: 140, left: 0 },
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              <UiEntity
                uiTransform={{
                  width: 'auto',
                  height: 64,
                  padding: { left: 36, right: 36, top: 12, bottom: 12 },
                  flexShrink: 0
                }}
                uiBackground={{ color: C.ink }}
              >
                <Label
                  value={note.text}
                  fontSize={28}
                  color={C.text}
                  textAlign="middle-center"
                  uiTransform={{ width: 'auto', height: 40 }}
                />
              </UiEntity>
            </UiEntity>
          )}
          {showLobbyHint && (
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 36,
                positionType: 'absolute',
                position: { bottom: 128, left: 0 },
                justifyContent: 'center'
              }}
            >
              <Label value={hud.hint} fontSize={16} color={C.mute} textAlign="middle-center" uiTransform={{ width: 900, height: 36 }} />
            </UiEntity>
          )}
        </UiEntity>
      </ScreenInsetArea>
    </UiEntity>
  )
}
