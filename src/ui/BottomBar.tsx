import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'
import { hud, setHud, uiActions } from '../state'
import { DialogActionButton } from './Buttons'
import { C } from './theme'

function clock() {
  const total = Math.max(0, Math.floor(hud.timeMs / 1000))
  const m = Math.floor(total / 60)
  const r = total % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function linkedWaiting() {
  return hud.iAmReady && (hud.phase === 'lobby' || hud.phase === 'waiting' || hud.inQueue)
}

const LobbyButtons = () => {
  const mobile = isMobile()
  const w = mobile ? 128 : 180
  const h = mobile ? 56 : 64
  const font = mobile ? 16 : 20
  const gap = mobile ? 8 : 14
  const busy = hud.phase === 'countdown' || hud.phase === 'playing' || hud.phase === 'won'

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 92,
        positionType: 'absolute',
        position: { bottom: 20, left: 0 },
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', height: h }}>
        <DialogActionButton
          label={busy ? 'Join Line' : 'Link Up'}
          primary
          width={w}
          height={h}
          fontSize={font}
          onPress={() => uiActions.join()}
        />
        <UiEntity uiTransform={{ width: gap, height: 1 }} />
        <DialogActionButton
          label="Practice"
          primary={false}
          width={w}
          height={h}
          fontSize={font}
          onPress={() => uiActions.practice()}
        />
        <UiEntity uiTransform={{ width: gap, height: 1 }} />
        <DialogActionButton
          label="How To Play"
          primary={false}
          width={mobile ? 148 : 190}
          height={h}
          fontSize={mobile ? 15 : 20}
          onPress={() => setHud({ howToOpen: true })}
        />
      </UiEntity>
    </UiEntity>
  )
}

const LinkedStatus = () => {
  const mobile = isMobile()
  const barW = mobile ? 700 : 980
  const statusH = mobile ? 112 : 100

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: statusH + 8,
        positionType: 'absolute',
        position: { bottom: 40, left: 0 },
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: barW,
          height: statusH,
          padding: 3,
          flexDirection: 'row',
          alignItems: 'center'
        }}
        uiBackground={{ color: C.frame }}
      >
        <UiEntity uiTransform={{ width: '100%', height: '100%', padding: { left: 18, right: 12 } }} uiBackground={{ color: C.ink }}>
          <UiEntity
            uiTransform={{
              width: barW - 300,
              height: '100%',
              flexDirection: 'column',
              justifyContent: 'center'
            }}
          >
            <UiEntity uiTransform={{ width: '100%', height: 32, flexDirection: 'row', alignItems: 'center' }}>
              <Label
                value={hud.inQueue ? 'IN LINE' : hud.title}
                fontSize={mobile ? 20 : 26}
                color={C.text}
                textAlign="middle-left"
                textWrap="nowrap"
                uiTransform={{ width: mobile ? 380 : 520, height: 32 }}
              />
              {(hud.phase === 'playing' || hud.phase === 'won') && (
                <Label
                  value={clock()}
                  fontSize={mobile ? 20 : 24}
                  color={C.text}
                  textAlign="middle-left"
                  uiTransform={{ width: 90, height: 32 }}
                />
              )}
            </UiEntity>
            <Label
              value={hud.roster || hud.partnerName}
              fontSize={mobile ? 14 : 16}
              color={C.teal}
              textAlign="middle-left"
              uiTransform={{ width: '100%', height: 22 }}
            />
            <Label
              value={hud.subtitle}
              fontSize={mobile ? 13 : 15}
              color={C.mute}
              textAlign="middle-left"
              uiTransform={{ width: '100%', height: 20 }}
            />
          </UiEntity>
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position: { top: mobile ? 22 : 20, right: 12 },
              width: 280,
              height: 56,
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center'
            }}
          >
            <DialogActionButton
              label={hud.inQueue ? 'Wait' : 'Start'}
              primary={hud.canStart}
              disabled={!hud.canStart}
              width={mobile ? 110 : 124}
              height={52}
              fontSize={20}
              onPress={() => uiActions.start()}
            />
            <UiEntity uiTransform={{ width: 8, height: 1 }} />
            <DialogActionButton
              label={hud.inQueue ? 'Leave Line' : 'Unlink'}
              primary={false}
              width={mobile ? 110 : 124}
              height={52}
              fontSize={20}
              onPress={() => uiActions.join()}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

export const BottomBar = () => {
  return linkedWaiting() ? <LinkedStatus /> : <LobbyButtons />
}
