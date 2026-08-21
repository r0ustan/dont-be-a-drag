import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'
import { uiActions } from '../state'
import { DialogActionButton } from './Buttons'
import { C } from './theme'

export const SpectatePanel = () => {
  const mobile = isMobile()
  const w = mobile ? 640 : 720
  const h = mobile ? 340 : 300

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
      <UiEntity
        uiTransform={{ width: w, height: h, padding: 3 }}
        uiBackground={{ color: C.frame }}
      >
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
            value="Game in progress"
            fontSize={mobile ? 28 : 34}
            color={C.gold}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: mobile ? 40 : 44 }}
          />
          <Label
            value="Waiting for the next game."
            fontSize={mobile ? 18 : 22}
            color={C.text}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: 32, margin: { top: 8 } }}
          />
          <Label
            value="Would you like to spectate?"
            fontSize={mobile ? 18 : 22}
            color={C.teal}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: 32, margin: { top: 4, bottom: 18 } }}
          />
          <UiEntity uiTransform={{ flexDirection: 'row', height: mobile ? 56 : 60, justifyContent: 'center' }}>
            <DialogActionButton
              label="Yes"
              primary
              width={mobile ? 160 : 180}
              height={mobile ? 56 : 60}
              fontSize={22}
              onPress={() => uiActions.spectateYes()}
            />
            <UiEntity uiTransform={{ width: 16, height: 1 }} />
            <DialogActionButton
              label="No"
              primary={false}
              width={mobile ? 160 : 180}
              height={mobile ? 56 : 60}
              fontSize={22}
              onPress={() => uiActions.spectateNo()}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
