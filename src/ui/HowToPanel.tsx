import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'
import { setHud } from '../state'
import { DialogActionButton } from './Buttons'
import { PanelFrame } from './RevampPanel'
import { C } from './theme'

const STEPS = [
  'Link up with 2-4 players.',
  'Or try PRACTICE for single player.',
  'Get to the top of the parkour to win.',
  'Hint: Stay close together and be patient.'
]

export const HowToPanel = () => {
  const mobile = isMobile()
  const rowH = mobile ? 48 : 56
  const bodySize = mobile ? 16 : 20

  return (
    <PanelFrame titleText="How To Play" onClose={() => setHud({ howToOpen: false })}>
      {STEPS.map((line) => {
        const hint = line.startsWith('Hint:')
        return (
          <UiEntity
            key={line}
            uiTransform={{
              width: '100%',
              height: rowH,
              margin: { bottom: mobile ? 6 : 8 },
              padding: { left: 12, right: 12 },
              justifyContent: 'center',
              alignItems: 'center'
            }}
            uiBackground={hint ? undefined : { color: C.row }}
          >
            <Label
              value={line}
              fontSize={bodySize}
              color={hint ? C.teal : C.text}
              textAlign="middle-center"
              textWrap="wrap"
              uiTransform={{ width: '100%', height: '100%' }}
            />
          </UiEntity>
        )
      })}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: mobile ? 64 : 70,
          justifyContent: 'center',
          alignItems: 'center',
          margin: { top: mobile ? 4 : 6 }
        }}
      >
        <DialogActionButton
          label="Got it"
          primary
          width={mobile ? 280 : 220}
          height={mobile ? 56 : 56}
          fontSize={mobile ? 24 : 22}
          onPress={() => setHud({ howToOpen: false })}
        />
      </UiEntity>
    </PanelFrame>
  )
}
