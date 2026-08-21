import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { C } from './theme'

export const DialogActionButton = ({
  label,
  primary = false,
  width,
  height,
  fontSize,
  disabled = false,
  onPress
}: {
  label: string
  primary?: boolean
  width: number
  height: number
  fontSize: number
  disabled?: boolean
  onPress?: () => void
}) => {
  const fill = disabled ? C.btnDisabled : primary ? C.btnPrimary : C.btnSecondary
  const text = disabled ? C.btnDisabledText : primary ? C.btnPrimaryText : C.btnSecondaryText
  const border = disabled ? C.btnDisabled : primary ? C.btnPrimary : C.frame

  return (
    <UiEntity
      uiTransform={{
        width,
        height,
        padding: 2,
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: border }}
      onMouseDown={disabled ? undefined : onPress}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: fill }}
      >
        <Label
          value={label}
          fontSize={fontSize}
          color={text}
          textAlign="middle-center"
          textWrap="nowrap"
          uiTransform={{ width: '100%', height: '100%' }}
        />
      </UiEntity>
    </UiEntity>
  )
}

export const MiniTextButton = ({
  label,
  width,
  fontSize,
  disabled = false,
  onPress
}: {
  label: string
  width: number
  fontSize: number
  disabled?: boolean
  onPress?: () => void
}) => {
  const height = Math.round(width / (196 / 52))
  return (
    <DialogActionButton
      label={label}
      primary={false}
      width={width}
      height={height}
      fontSize={fontSize}
      disabled={disabled}
      onPress={onPress}
    />
  )
}
