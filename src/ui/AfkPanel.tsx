import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'
import { hud, uiActions } from '../state'
import { DialogActionButton } from './Buttons'
import { C } from './theme'

export const AfkPanel = () => {
  const mobile = isMobile()
  const w = mobile ? 640 : 720
  const h = mobile ? 360 : 320
  const secs = Math.max(0, Math.ceil(hud.afkSecondsLeft))

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <UiEntity uiTransform={{ width: w, height: h, padding: 3 }} uiBackground={{ color: C.frame }}>
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            padding: { left: 28, right: 28, top: 24, bottom: 20 },
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiBackground={{ color: C.panel }}
        >
          <Label
            value="Are you there?"
            fontSize={mobile ? 28 : 34}
            color={C.gold}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: mobile ? 40 : 44 }}
          />
          <Label
            value="Tap Yes to keep playing."
            fontSize={mobile ? 18 : 22}
            color={C.text}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: 32, margin: { top: 8 } }}
          />
          <Label
            value={`Asking again in ${secs}s if nobody answers.`}
            fontSize={mobile ? 16 : 18}
            color={C.mute}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: 28, margin: { top: 4, bottom: 18 } }}
          />
          <DialogActionButton
            label="Yes"
            primary
            width={mobile ? 200 : 220}
            height={mobile ? 56 : 60}
            fontSize={22}
            onPress={() => uiActions.afkHere()}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
