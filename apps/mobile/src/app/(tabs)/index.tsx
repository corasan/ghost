import type { GuardianCharacter, ItemSummary } from "@ghost/contract"
import { router } from "expo-router"
import { useState } from "react"
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { Unavailable } from "@/components/link-bungie"
import { Body, Chip, GhostBanner, Header, Loading, Mono, Swatch } from "@/components/ui"
import { useGuardian } from "@/lib/api"
import { upper } from "@/lib/format"
import { colors, fonts, tierColor } from "@/theme"

const WEAPON_SLOTS = ["kinetic", "energy", "power"] as const
const ARMOR_SLOTS = ["helmet", "arms", "chest", "legs", "class"] as const
const POSTMASTER_CAPACITY = 21

const className: Record<GuardianCharacter["classType"], string> = {
  titan: "Titan",
  hunter: "Hunter",
  warlock: "Warlock",
}

// 01 · Guardian tab. Opens here: what is equipped on the selected character,
// its stats and power, plus one banner when Ghost has something worth doing.
export default function GuardianScreen() {
  const guardian = useGuardian()
  const [selected, setSelected] = useState<string | null>(null)

  if (guardian.isPending) return <Loading label="Reading your guardian" />
  if (guardian.isError) return <Unavailable error={guardian.error} onRetry={guardian.refetch} />

  const { characters, vaultCount, vaultCapacity } = guardian.data
  const character = characters.find((c) => c.characterId === selected) ?? characters[0]
  if (character === undefined) {
    return (
      <View style={{ flex: 1 }}>
        <Header eyebrow="NO CHARACTERS" title="Equipped" />
      </View>
    )
  }

  const bySlot = (slot: ItemSummary["slot"]) => character.equipment.find((i) => i.slot === slot)
  const postmasterFull = character.postmasterCount >= POSTMASTER_CAPACITY - 3

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={guardian.isRefetching}
            onRefresh={() => void guardian.refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <Header
          eyebrow={upper(className[character.classType])}
          title="Equipped"
          right={
            <View style={{ alignItems: "flex-end" }}>
              <Mono tracking={1.2}>POWER</Mono>
              <Text style={styles.power}>{character.light}</Text>
            </View>
          }
        />

        <View style={styles.classRow}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {characters.map((c) => (
              <Chip
                key={c.characterId}
                label={className[c.classType]}
                active={c.characterId === character.characterId}
                onPress={() => setSelected(c.characterId)}
              />
            ))}
          </View>
          <Mono color={colors.accent} onPress={() => router.navigate("/vault")}>
            VAULT {vaultCount}/{vaultCapacity}
          </Mono>
        </View>

        <View style={styles.columns}>
          <View style={styles.column}>
            <Mono size={9} color={colors.muted} tracking={1.3}>
              WEAPONS
            </Mono>
            {WEAPON_SLOTS.map((slot) => {
              const item = bySlot(slot)
              return item ? (
                <WeaponCard key={slot} item={item} />
              ) : (
                <EmptySlot key={slot} slot={slot} />
              )
            })}
          </View>
          <View style={styles.column}>
            <Mono size={9} color={colors.muted} tracking={1.3}>
              ARMOR
            </Mono>
            {ARMOR_SLOTS.map((slot) => {
              const item = bySlot(slot)
              return item ? (
                <ArmorRow key={slot} item={item} />
              ) : (
                <EmptySlot key={slot} slot={slot} />
              )
            })}
          </View>
        </View>

        <View style={styles.stats}>
          {(
            [
              ["MOB", character.stats.mobility],
              ["RES", character.stats.resilience],
              ["REC", character.stats.recovery],
              ["DIS", character.stats.discipline],
              ["INT", character.stats.intellect],
              ["STR", character.stats.strength],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={{ alignItems: "center", gap: 2 }}>
              <Text style={styles.statValue}>{value}</Text>
              <Mono size={9} tracking={1}>
                {label}
              </Mono>
            </View>
          ))}
        </View>
      </ScrollView>

      {postmasterFull ? (
        <GhostBanner
          style={{ marginHorizontal: 16, marginBottom: 10 }}
          action="Ask Ghost"
          onPress={() =>
            router.navigate({
              pathname: "/ghost",
              params: {
                prompt: `Empty the ${className[character.classType]}'s postmaster into the vault`,
                kind: "postmaster_to_vault",
              },
            })
          }
        >
          Postmaster is at {character.postmasterCount}/{POSTMASTER_CAPACITY}. Clear it before it
          overflows?
        </GhostBanner>
      ) : null}
    </View>
  )
}

function WeaponCard({ item }: { item: ItemSummary }) {
  const tier = tierColor(item.tier)
  const sub =
    item.damageType === "none" || (item.slot === "kinetic" && item.damageType === "kinetic")
      ? upper(item.slot)
      : `${upper(item.slot)} · ${upper(item.damageType)}`
  return (
    <View style={[styles.weaponCard, { borderTopColor: tier }]}>
      <Swatch item={item} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body weight="medium" numberOfLines={1}>
          {item.name}
        </Body>
        <Mono size={9} color={tier} tracking={0.8} style={{ marginTop: 2 }}>
          {sub}
        </Mono>
        <Mono size={12} color={colors.power} tracking={0} style={{ marginTop: 6 }}>
          {item.power ?? "—"}
        </Mono>
      </View>
    </View>
  )
}

function ArmorRow({ item }: { item: ItemSummary }) {
  const exotic = item.tier === "exotic"
  return (
    <View style={[styles.armorRow, { borderLeftColor: tierColor(item.tier) }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body size={13} weight="medium" numberOfLines={1}>
          {item.name}
        </Body>
        <Mono size={9} color={exotic ? colors.exotic : colors.dim} tracking={0.8}>
          {exotic ? `${upper(item.slot)} · EXOTIC` : upper(item.slot)}
        </Mono>
      </View>
      <Mono size={11} color={colors.power} tracking={0}>
        {item.power ?? "—"}
      </Mono>
    </View>
  )
}

function EmptySlot({ slot }: { slot: string }) {
  return (
    <View style={[styles.armorRow, { borderLeftColor: colors.muted, opacity: 0.5 }]}>
      <Mono size={9} tracking={0.8}>
        {upper(slot)} · EMPTY
      </Mono>
    </View>
  )
}

const styles = StyleSheet.create({
  power: {
    fontFamily: fonts.light,
    fontSize: 40,
    color: colors.power,
    lineHeight: 42,
    letterSpacing: -1.2,
  },
  classRow: {
    marginTop: 18,
    marginHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  columns: { paddingHorizontal: 20, paddingTop: 20, flexDirection: "row", gap: 10 },
  column: { flex: 1, gap: 8 },
  weaponCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 2,
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    gap: 10,
  },
  armorRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 2,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  stats: {
    marginHorizontal: 20,
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statValue: { fontFamily: fonts.medium, fontSize: 18, color: colors.text, lineHeight: 22 },
})
