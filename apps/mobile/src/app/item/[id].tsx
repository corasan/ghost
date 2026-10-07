import type { ItemDetail, ItemPerk } from "@ghost/contract"
import { Image } from "expo-image"
import { useLocalSearchParams } from "expo-router"
import { ScrollView, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { SetBonusText } from "@/components/ghost/set-bonus"
import { ArmorStatLine, Body, Meta, Mono } from "@/components/ghost/ui"
import { ItemActions } from "@/components/item/actions"
import { ItemHeader } from "@/components/item/header"
import { PerkRatings } from "@/components/item/perk-ratings"
import { Ghost, Type } from "@/constants/theme"
import { errorMessage, useItemDetail } from "@/lib/api"
import { useBottomInset } from "@/lib/insets"
import { type ArmorSet, armorSet } from "@/lib/plan-card"

function Stats({ stats }: { stats: ItemDetail["stats"] }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 10 }}>
      <Mono>STATS</Mono>
      <ArmorStatLine stats={stats} />
    </View>
  )
}

function ArmorSetSection({ set }: { set: ArmorSet }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Mono>ARMOR SET</Mono>
        <Meta>
          {set.worn} of {set.of} worn
        </Meta>
      </View>
      <Body size={17} style={{ fontFamily: Type.bodyMedium }}>
        {set.name}
      </Body>
      {set.bonuses.map(({ bonus, on }) => (
        <View
          key={bonus.name}
          style={[{ flexDirection: "row", gap: 12 }, !on && { opacity: 0.45 }]}
        >
          <PlugIcon icon={bonus.icon} size={28} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <SetBonusText bonus={bonus} />
          </View>
          {on ? (
            <Meta color={Ghost.good} style={{ marginTop: 2 }}>
              Active
            </Meta>
          ) : null}
        </View>
      ))}
    </View>
  )
}

const PERK_ICON = 36

const WEAPON_SLOTS = new Set(["kinetic", "energy", "power"])

function ExoticPerk({ perk }: { perk: ItemPerk }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <Mono>EXOTIC PERK</Mono>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ width: 2, backgroundColor: Ghost.gold }} />
        <PerkIcon icon={perk.icon} round={false} enhanced={false} />
        <View style={{ flex: 1 }}>
          <Body size={15} color={Ghost.gold} style={{ fontFamily: Type.bodyMedium }}>
            {perk.name}
          </Body>
          <Body size={14} color={Ghost.muted} style={{ lineHeight: 20, marginTop: 2 }}>
            {perk.description.trim()}
          </Body>
        </View>
      </View>
    </View>
  )
}

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
            <Body size={14} color={Ghost.muted} style={{ lineHeight: 20, marginTop: 2 }}>
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

  const { item, perks, stats, setBonuses, exoticPerk } = detail.data
  const set = armorSet(setBonuses)
  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: 28, paddingBottom: bottomInset + 20, gap: 22 }}
    >
      <ItemHeader item={item} size={72} />
      {exoticPerk ? <ExoticPerk perk={exoticPerk} /> : null}
      {stats.length > 0 ? <Stats stats={stats} /> : null}
      {set ? <ArmorSetSection set={set} /> : null}
      {perks.length > 0 ? <Perks perks={perks} /> : null}
      {item.itemInstanceId !== null && WEAPON_SLOTS.has(item.slot) ? (
        <PerkRatings itemId={item.itemInstanceId} />
      ) : null}
      <ItemActions item={item} />
    </ScrollView>
  )
}
