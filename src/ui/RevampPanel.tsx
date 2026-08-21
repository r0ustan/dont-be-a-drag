import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { isMobile } from '@dcl/sdk/platform'
import { C, getPanelMetrics } from './theme'

export const TitlePlaque = ({
  title,
  panelWidth,
  plaqueW,
  plaqueH,
  plaqueTop
}: {
  title: string
  panelWidth: number
  plaqueW: number
  plaqueH: number
  plaqueTop: number
}) => (
  <UiEntity
    uiTransform={{
      positionType: 'absolute',
      position: { top: plaqueTop, left: Math.round((panelWidth - plaqueW) / 2) },
      width: plaqueW,
      height: plaqueH,
      padding: 3,
      justifyContent: 'center',
      alignItems: 'center'
    }}
    uiBackground={{ color: C.frame }}
  >
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: C.inkSolid }}
    >
      <Label
        value={title}
        fontSize={isMobile() ? 24 : 30}
        color={C.text}
        textAlign="middle-center"
        uiTransform={{ width: plaqueW - 28, height: plaqueH }}
      />
    </UiEntity>
  </UiEntity>
)

export const CloseButton = ({ onClose }: { onClose: () => void }) => {
  const mobile = isMobile()
  const size = mobile ? 72 : 50
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: mobile ? 6 : 12, right: mobile ? 8 : 12 },
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center'
      }}
      uiBackground={{ color: C.close }}
      onMouseDown={onClose}
    >
      <Label value="X" fontSize={mobile ? 28 : 22} color={C.text} textAlign="middle-center" uiTransform={{ width: size, height: size }} />
    </UiEntity>
  )
}

type Props = {
  titleText: string
  onClose: () => void
  contentTop?: number
  children?: ReactEcs.JSX.ReactNode
}

export const PanelFrame = ({ titleText, onClose, contentTop, children }: Props) => {
  const metrics = getPanelMetrics(isMobile())
  const top = contentTop ?? metrics.contentTop
  const contentH = metrics.panelH - top - metrics.contentBottom

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}
        uiBackground={{ color: C.touchCapture }}
        onMouseDown={onClose}
      />
      <UiEntity
        uiTransform={{
          width: metrics.panelW,
          height: metrics.panelH,
          padding: 3
        }}
        uiBackground={{ color: C.frame }}
      >
        <UiEntity uiTransform={{ width: '100%', height: '100%' }} uiBackground={{ color: C.panel }}>
          <TitlePlaque
            title={titleText}
            panelWidth={metrics.panelW}
            plaqueW={metrics.plaqueW}
            plaqueH={metrics.plaqueH}
            plaqueTop={metrics.plaqueTop}
          />
          <UiEntity
            uiTransform={{
              width: metrics.contentW,
              height: contentH,
              positionType: 'absolute',
              position: { top, left: metrics.contentLeft },
              flexDirection: 'column'
            }}
          >
            {children}
          </UiEntity>
          <CloseButton onClose={onClose} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
