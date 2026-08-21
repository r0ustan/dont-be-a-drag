import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { hud, setHud } from '../state'
import { PanelFrame } from './RevampPanel'
import { C } from './theme'

export const ResultPanel = () => {
  const won = hud.phase === 'won'
  return (
    <PanelFrame titleText={won ? 'In the ZONE!' : 'Run ended'} onClose={() => setHud({ resultDismissed: true, banner: '' })}>
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Label
          value={won ? 'You made it together.' : 'The run ended.'}
          fontSize={28}
          color={won ? C.green : C.accent}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 40 }}
        />
        <Label
          value={hud.subtitle}
          fontSize={22}
          color={C.text}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 36, margin: { top: 10 } }}
        />
        <Label
          value="Jump into the canyon to play again."
          fontSize={18}
          color={C.mute}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 32, margin: { top: 16 } }}
        />
      </UiEntity>
    </PanelFrame>
  )
}
