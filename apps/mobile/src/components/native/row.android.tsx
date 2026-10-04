import { ListItem, Text } from "@expo/ui/jetpack-compose"
import { clickable } from "@expo/ui/jetpack-compose/modifiers"
import type { RowProps } from "./types"

export function Row({ title, subtitle, detail, onPress }: RowProps) {
  return (
    <ListItem modifiers={onPress ? [clickable(onPress)] : []}>
      <ListItem.HeadlineContent>
        <Text>{title}</Text>
      </ListItem.HeadlineContent>
      {subtitle ? (
        <ListItem.SupportingContent>
          <Text>{subtitle}</Text>
        </ListItem.SupportingContent>
      ) : null}
      {detail ? (
        <ListItem.TrailingContent>
          <Text>{detail}</Text>
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  )
}
