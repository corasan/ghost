import type { CharacterStats, ItemSummary } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { router } from "expo-router"
import { Pressable, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ChatHeader } from "@/components/chat/header"
import { Situational } from "@/components/ghost/charge"
import { SubclassBanner } from "@/components/ghost/subclass-banner"
import { Unavailable } from "@/components/ghost/unavailable"
import { ItemIcon } from "@/components/ghost/item-icon"
import { Body, Cond, Mono, Nudge, TierStats } from "@/components/ghost/ui"
import { Ghost, Gutter, Rarity, Type } from "@/constants/theme"
import { useGuardian, useSituational } from "@/lib/api"
import { chargedMods } from "@/lib/charge"
import { useCharacter } from "@/lib/character"
import { upper } from "@/lib/format"
import { usePullRefresh } from "@/lib/refresh"

const WEAPON_SLOTS: readonly ItemSummary["slot"][] = ["kinetic", "energy", "power"]
const ARMOR_SLOTS: readonly ItemSummary["slot"][] = ["helmet", "arms", "chest", "legs", "class"]

const STAT_LABELS: readonly (readonly [keyof CharacterStats, string])[] = [
  ["resilience", "HLT"],
  ["strength", "MEL"],
  ["discipline", "GRN"],
  ["intellect", "SUP"],
  ["recovery", "CLS"],
  ["mobility", "WPN"],
]

const STRONG_STAT = 100

type Row =
  | { type: "label"; key: string; label: string }
  | { type: "weapon" | "armor"; key: string; item: ItemSummary }

const inSlots = (equipment: readonly ItemSummary[], slots: readonly ItemSummary["slot"][]) =>
  slots.flatMap((slot) => equipment.filter((item) => item.slot === slot))

const dotted = (parts: readonly (string | null)[]) =>
  parts
    .filter(Boolean)
    .map((part) => upper(String(part)))
    .join(" · ")

const weaponMeta = (item: ItemSummary) =>
  dotted([
    item.slot,
    item.damageType === "none" || item.damageType === item.slot ? null : item.damageType,
    item.typeName,
  ])

function ItemRow({ item, kind }: { item: ItemSummary; kind: "weapon" | "armor" }) {
  const exotic = item.tier === "exotic"
  const weapon = kind === "weapon"
  const id = item.itemInstanceId
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the item"
      disabled={id === null}
      onPress={() => id && router.push({ pathname: "/item/[id]", params: { id } })}
      onLongPress={() => id && router.push({ pathname: "/item-actions/[id]", params: { id } })}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: weapon ? 8 : 6,
          borderTopWidth: 1,
          borderTopColor: Ghost.rule,
        },
        pressed && { opacity: 0.6 },
      ]}
    >
      <ItemIcon
        icon={item.icon}
        size={48}
        element={item.damageType}
        gearTier={item.gearTier}
        masterwork={item.masterwork}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body size={16} style={{ fontFamily: Type.bodyMedium, lineHeight: 19 }} lines={1}>
          {item.name}
        </Body>
        <Mono
          color={exotic ? Rarity.exotic : Ghost.dim}
          style={{ marginTop: weapon ? 3 : 2, letterSpacing: 0.7 }}
          lines={1}
        >
          {weapon ? weaponMeta(item) : dotted([item.slot, exotic ? "exotic" : null])}
        </Mono>
      </View>
      <Cond size={18} color={Ghost.gold} style={{ letterSpacing: 0 }}>
        {item.power ?? "—"}
      </Cond>
    </Pressable>
  )
}

/** The subclass on top, then stats in one row and weapons and armor down the page. */
export default function GuardianScreen() {
  const insets = useSafeAreaInsets()
  const guardian = useGuardian()
  const { character } = useCharacter()
  const situational = useSituational(character?.characterId)
  const pull = usePullRefresh(guardian.refetch, situational.refetch)

  if (!character) {
    return (
      <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
        <ChatHeader character={undefined} ruled={false} />
        <View style={{ paddingHorizontal: Gutter }}>
          {guardian.isPending ? (
            <Body color={Ghost.dim} style={{ paddingTop: 32 }}>
              Loading…
            </Body>
          ) : (
            <Unavailable error={guardian.error} onRetry={() => void guardian.refetch()} />
          )}
        </View>
      </View>
    )
  }

  const rows: Row[] = [
    { type: "label", key: "weapons", label: "WEAPONS" },
    ...inSlots(character.equipment, WEAPON_SLOTS).map((item) => ({
      type: "weapon" as const,
      key: `w-${item.slot}`,
      item,
    })),
    { type: "label", key: "armor", label: "ARMOR" },
    ...inSlots(character.equipment, ARMOR_SLOTS).map((item) => ({
      type: "armor" as const,
      key: `a-${item.slot}`,
      item,
    })),
  ]
  const postmaster = character.postmasterCount
  const capacity = guardian.data?.postmasterCapacity ?? 21

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
      <ChatHeader character={character} ruled={false} />
      <LegendList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        recycleItems
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: Gutter, paddingTop: 2, paddingBottom: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Mono size={10} color={Ghost.accent} style={{ letterSpacing: 1.4 }}>
                GUARDIAN
              </Mono>
              <Mono size={10} style={{ letterSpacing: 1.4 }}>
                {upper(character.classType)} · POWER {character.light}
              </Mono>
            </View>
            {character.loadout ? (
              <View style={{ paddingTop: 12 }}>
                <SubclassBanner
                  loadout={character.loadout}
                  chevron="right"
                  hint="Opens the subclass"
                  onPress={() => router.push("/subclass")}
                />
              </View>
            ) : null}
            <View style={{ paddingTop: 16 }}>
              <TierStats
                stats={STAT_LABELS.map(([key, label]) => ({
                  label,
                  value: character.stats[key],
                  target: character.stats[key] >= STRONG_STAT,
                }))}
              />
            </View>
          </View>
        }
        ListFooterComponent={
          <>
            {situational.data && situational.data.mods.length > 0 ? (
              <View style={{ paddingHorizontal: Gutter, paddingTop: 22 }}>
                <Situational
                  summary={situational.data.summary}
                  mods={chargedMods(situational.data.mods)}
                  pending={situational.data.pending}
                />
              </View>
            ) : null}
            {postmaster > 0 ? (
              <View style={{ paddingTop: 18 }}>
                <Nudge
                  text={`Postmaster is at ${postmaster} of ${capacity}. Clear it before you lose drops?`}
                  action="ASK"
                  prompt="Empty the postmaster into the vault"
                />
              </View>
            ) : null}
          </>
        }
        renderItem={({ item: row }) =>
          row.type === "label" ? (
            <Mono
              style={{
                paddingHorizontal: Gutter,
                paddingTop: row.key === "armor" ? 16 : 6,
                paddingBottom: 6,
                letterSpacing: 1.3,
              }}
            >
              {row.label}
            </Mono>
          ) : (
            <View style={{ paddingHorizontal: Gutter }}>
              <ItemRow item={row.item} kind={row.type} />
            </View>
          )
        }
      />
    </View>
  )
}
