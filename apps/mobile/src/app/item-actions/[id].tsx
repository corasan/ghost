import { useLocalSearchParams } from "expo-router"
import { ScrollView } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Body } from "@/components/ghost/ui"
import { ItemActions } from "@/components/item/actions"
import { ItemHeader } from "@/components/item/header"
import { Ghost } from "@/constants/theme"
import { errorMessage, useItemDetail } from "@/lib/api"

export default function ItemActionsScreen() {
  const { id, select } = useLocalSearchParams<{ id: string; select?: string }>()
  const insets = useSafeAreaInsets()
  const detail = useItemDetail(id)

  if (!detail.data) {
    return (
      <Body
        color={detail.isError ? Ghost.danger : Ghost.dim}
        style={{ padding: 20, paddingTop: 32 }}
      >
        {detail.isError ? `Couldn't load this item: ${errorMessage(detail.error)}` : "Loading…"}
      </Body>
    )
  }

  return (
    <ScrollView
      nestedScrollEnabled
      contentContainerStyle={{ paddingTop: 28, paddingBottom: insets.bottom + 20, gap: 18 }}
    >
      <ItemHeader item={detail.data.item} size={48} />
      <ItemActions item={detail.data.item} selectable={select === "1"} />
    </ScrollView>
  )
}
