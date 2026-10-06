import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useRef,
  useState,
} from "react"
import { type HostInstance, Pressable, StyleSheet, View } from "react-native"
import { Portal, PortalHost } from "react-native-teleport"

import { Cut } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { placeTooltip, type Rect } from "@/lib/tooltip"

const CARET = 9
const GAP = 8
const MARGIN = 12
const MAX_WIDTH = 320

type Layer = { name: string; host: RefObject<HostInstance | null> }

const LayerContext = createContext<Layer | undefined>(undefined)

/**
 * The surface tooltips float on: it covers its parent, so mount it at the
 * root of each window a tooltip can open in (the app, a native sheet).
 */
export function TooltipLayer({ name, children }: { name: string; children: ReactNode }) {
  const host = useRef<HostInstance>(null)
  return (
    <LayerContext value={{ name, host }}>
      {children}
      <View ref={host} collapsable={false} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <PortalHost name={name} style={StyleSheet.absoluteFill} />
      </View>
    </LayerContext>
  )
}

type Measured = { anchor: Rect; host: { width: number; height: number } }

const measure = (view: HostInstance) =>
  new Promise<Rect>((resolve) =>
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })),
  )

/**
 * A chamfered tip floating over everything in the nearest `TooltipLayer`, its
 * caret on `anchor`. Any touch outside it calls `onClose`.
 */
export function Tooltip({
  anchor,
  onClose,
  under = Ghost.panel,
  children,
}: {
  anchor: HostInstance
  onClose: () => void
  under?: string
  children: ReactNode
}) {
  const layer = use(LayerContext)
  if (!layer) throw new Error("Tooltip needs a TooltipLayer above it")
  const [measured, setMeasured] = useState<Measured>()
  const [height, setHeight] = useState<number>()

  useEffect(() => {
    const host = layer.host.current
    if (!host) return
    void Promise.all([measure(host), measure(anchor)]).then(([frame, target]) =>
      setMeasured({
        anchor: { ...target, x: target.x - frame.x, y: target.y - frame.y },
        host: frame,
      }),
    )
  }, [anchor, layer])

  const place =
    measured &&
    placeTooltip({
      ...measured,
      height: height ?? 0,
      maxWidth: MAX_WIDTH,
      margin: MARGIN,
      gap: GAP,
      caretInset: CARET * 1.5,
    })

  return (
    <Portal hostName={layer.name} style={styles.source}>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        {place ? (
          <View
            pointerEvents="none"
            onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            style={[
              styles.tip,
              { left: place.left, top: place.top, width: place.width },
              height === undefined && { opacity: 0 },
            ]}
          >
            <Cut
              cut={6}
              fill={Ghost.swatch}
              border={Ghost.ruleStrong}
              under={under}
              style={styles.body}
            >
              {children}
            </Cut>
            <View
              style={[
                styles.caret,
                { left: place.caret - CARET / 2 },
                place.side === "below" ? styles.caretUp : styles.caretDown,
              ]}
            />
          </View>
        ) : null}
      </View>
    </Portal>
  )
}

const styles = StyleSheet.create({
  source: { position: "absolute" },
  tip: { position: "absolute" },
  body: { paddingVertical: 10, paddingHorizontal: 12 },
  caret: {
    position: "absolute",
    width: CARET,
    height: CARET,
    backgroundColor: Ghost.swatch,
    borderColor: Ghost.ruleStrong,
    transform: [{ rotate: "45deg" }],
  },
  caretUp: { top: -CARET / 2 + 0.5, borderTopWidth: 1, borderLeftWidth: 1 },
  caretDown: { bottom: -CARET / 2 + 0.5, borderBottomWidth: 1, borderRightWidth: 1 },
})
