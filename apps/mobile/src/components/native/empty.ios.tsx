import { ContentUnavailableView } from "@expo/ui/swift-ui"
import type { EmptyProps } from "./types"

export function Empty({ title, description }: EmptyProps) {
  return <ContentUnavailableView title={title} description={description} systemImage="tray" />
}
