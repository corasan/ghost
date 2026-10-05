import type { CharacterStats, ItemSummary } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Unavailable } from "@/components/ghost/unavailable"
import { Body, Cond, Mono, Nudge, PageHeader, Swatch, TierStats } from "@/components/ghost/ui"
import { Ghost, Gutter, Rarity, Type } from "@/constants/theme"
import { useGuardian } from "@/lib/api"
import { useCharacter } from "@/lib/character"
import { usePullRefresh } from "@/lib/refresh"
import { upper } from "@/lib/format"

const WEAPON_SLOTS: readonly ItemSummary["slot"][] = ["kinetic", "energy", "power"]
const ARMOR_SLOTS: readonly ItemSummary["slot"][] = ["helmet", "arms", "chest", "legs", "class"]

const STAT_LABELS: readonly (readonly [keyof CharacterStats, string])[] = [
  ["mobility", "MOB"],
  ["resilience", "RES"],
  ["recovery", "REC"],
  ["discipline", "DIS"],
  ["intellect", "INT"],
  ["strength", "STR"],
]

type Row =
  | { type: "label"; key: string; label: string }
  | { type: "weapon" | "armor"; key: string; item: ItemSummary }

const inSlots = (equipment: readonly ItemSummary[], slots: readonly ItemSummary["slot"][]) =>
  slots.flatMap((slot) => equipment.filter((item) => item.slot === slot))

function weaponMeta(item: ItemSummary) {
  const parts = [
    item.slot,
    item.damageType === "none" || item.damageType === item.slot ? null : item.damageType,
    item.typeName,
  ]
  return parts
    .filter(Boolean)
    .map((p) => upper(String(p)))
    .join(" · ")
}

function ItemRow({ item, kind }: { item: ItemSummary; kind: "weapon" | "armor" }) {
  const exotic = item.tier === "exotic"
  const weapon = kind === "weapon"
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: weapon ? 8 : 6,
        borderTopWidth: 1,
        borderTopColor: Ghost.rule,
      }}
    >
      <Swatch tier={item.tier} icon={item.icon} size={weapon ? 44 : 28} />
      <View
        style={
          weapon
            ? { flex: 1, minWidth: 0 }
            : { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 8 }
        }
      >
        <Body size={15} style={{ fontFamily: Type.bodyMedium, flexShrink: 1 }} lines={1}>
          {item.name}
        </Body>
        <Mono
          color={exotic ? Rarity.exotic : Ghost.dim}
          style={{ marginTop: weapon ? 3 : 0, letterSpacing: 0.7 }}
        >
          {weapon ? weaponMeta(item) : exotic ? `${upper(item.slot)} · EXOTIC` : upper(item.slot)}
        </Mono>
      </View>
      <Cond size={17} color={Ghost.gold} style={{ letterSpacing: 0 }}>
        {item.power ?? "—"}
      </Cond>
    </View>
  )
}

/** The character sheet: weapons and armor as one ledger, stats as tier bars. */
export default function GuardianScreen() {
  const insets = useSafeAreaInsets()
  const guardian = useGuardian()
  const pull = usePullRefresh(guardian.refetch)
  const { character } = useCharacter()

  if (!character) {
    return (
      <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
        <PageHeader title="GUARDIAN" subtitle="EQUIPPED" figure="—" caption="POWER" />
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
      <LegendList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        recycleItems
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View>
            <PageHeader
              title={upper(character.classType)}
              subtitle={[
                character.subclass,
                character.element !== "none" ? character.element : null,
              ]
                .filter(Boolean)
                .map((s) => upper(String(s)))
                .join(" · ")}
              figure={character.light}
              figureColor={Ghost.gold}
              caption="POWER"
            />
            <View style={{ paddingHorizontal: Gutter, paddingTop: 22, paddingBottom: 16 }}>
              <TierStats
                stats={STAT_LABELS.map(([key, label]) => ({ label, value: character.stats[key] }))}
              />
            </View>
          </View>
        }
        renderItem={({ item: row }) =>
          row.type === "label" ? (
            <Mono
              style={{
                paddingHorizontal: Gutter,
                paddingTop: row.key === "armor" ? 16 : 6,
                paddingBottom: 6,
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
      {postmaster > 0 ? (
        <View style={{ paddingBottom: insets.bottom + 16, paddingTop: 8 }}>
          <Nudge
            text={`Postmaster is at ${postmaster} of ${capacity}. Clear it before you lose drops?`}
            action="ASK"
            prompt="Empty the postmaster into the vault"
          />
        </View>
      ) : null}
    </View>
  )
}
