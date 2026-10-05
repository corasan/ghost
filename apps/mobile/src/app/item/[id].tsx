import type { ItemDetail } from "@ghost/contract"
import { Image } from "expo-image"
import { useLocalSearchParams } from "expo-router"
import { ScrollView, View } from "react-native"

import { ArmorStatLine, Body, Mono } from "@/components/ghost/ui"
import { ItemActions } from "@/components/item/actions"
import { ItemHeader } from "@/components/item/header"
import { Ghost, Type } from "@/constants/theme"
import { errorMessage, useItemDetail } from "@/lib/api"
import { useBottomInset } from "@/lib/insets"

function Stats({ stats }: { stats: ItemDetail["stats"] }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 10 }}>
      <Mono>STATS</Mono>
      <ArmorStatLine stats={stats} />
    </View>
  )
}

const PERK_ICON = 36

function PerkIcon({
  icon,
  round,
  enhanced,
}: {
  icon: string | null
  round: boolean
  enhanced: boolean
}) {
  return (
    <View
      style={{
        width: PERK_ICON,
        height: PERK_ICON,
        borderWidth: enhanced ? 1.5 : 0,
        borderColor: Ghost.gold,
        borderRadius: round ? PERK_ICON / 2 : 0,
        overflow: "hidden",
        backgroundColor: Ghost.swatch,
      }}
    >
      {icon ? (
        <Image source={icon} style={{ width: "100%", height: "100%" }} transition={120} />
      ) : null}
    </View>
  )
}

function Perks({ perks }: { perks: ItemDetail["perks"] }) {
  const ordered = [...perks.filter((perk) => perk.trait), ...perks.filter((perk) => !perk.trait)]
  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <Mono>PERKS</Mono>
      {ordered.map((perk, i) => (
        <View key={`${perk.name}${i}`} style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ width: 2, backgroundColor: perk.trait ? Ghost.good : Ghost.ruleStrong }} />
          <PerkIcon icon={perk.icon} round={perk.trait} enhanced={perk.enhanced ?? false} />
          <View style={{ flex: 1 }}>
            <Body
              size={15}
              color={perk.trait ? Ghost.ink : Ghost.soft}
              style={{ fontFamily: Type.bodyMedium }}
            >
              {perk.name}
            </Body>
            <Body size={13} color={Ghost.muted} style={{ lineHeight: 18, marginTop: 2 }}>
              {perk.description.trim()}
            </Body>
          </View>
        </View>
      ))}
    </View>
  )
}

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const bottomInset = useBottomInset()
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

  const { item, perks, stats } = detail.data
  return (
    <ScrollView
      nestedScrollEnabled
      contentContainerStyle={{ paddingTop: 28, paddingBottom: bottomInset + 20, gap: 22 }}
    >
      <ItemHeader item={item} size={72} />
      {stats.length > 0 ? <Stats stats={stats} /> : null}
      {perks.length > 0 ? <Perks perks={perks} /> : null}
      <ItemActions item={item} />
    </ScrollView>
  )
}
