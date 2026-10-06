export type Rect = { x: number; y: number; width: number; height: number }

export type TooltipPlacement = {
  left: number
  top: number
  width: number
  /** The caret's centre, from the tip's left edge. */
  caret: number
  side: "below" | "above"
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Where a tip of `height` sits in `host` to point at `anchor`: centred on the
 * anchor and kept `margin` inside the host, below the anchor unless only above fits.
 */
export const placeTooltip = ({
  anchor,
  host,
  height,
  maxWidth,
  margin,
  gap,
  caretInset,
}: {
  anchor: Rect
  host: { width: number; height: number }
  height: number
  maxWidth: number
  margin: number
  gap: number
  caretInset: number
}): TooltipPlacement => {
  const width = Math.min(maxWidth, host.width - margin * 2)
  const centre = anchor.x + anchor.width / 2
  const left = clamp(centre - width / 2, margin, host.width - margin - width)
  const below = anchor.y + anchor.height + gap
  const above = anchor.y - gap - height
  const fitsBelow = below + height <= host.height - margin
  const side = fitsBelow || above < margin ? "below" : "above"
  return {
    left,
    top: side === "below" ? below : above,
    width,
    caret: clamp(centre - left, caretInset, width - caretInset),
    side,
  }
}
