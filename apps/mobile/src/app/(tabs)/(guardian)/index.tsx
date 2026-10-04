import type { CharacterStats, ItemSummary } from "@ghost/contract"
import { router, Stack } from "expo-router"
import { useState } from "react"
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"

import { Banner, Mono, StatRow, Swatch } from "@/components/ghost/ui"
import { Unavailable } from "@/components/ghost/unavailable"
import { Segmented } from "@/components/native"
import { Ghost, Rarity, Type } from "@/constants/theme"
import { useGuardian } from "@/lib/api"

const POSTMASTER_SIZE = 21
const weaponSlots: readonly ItemSummary["slot"][] = ["kinetic", "energy", "power"]
const armorSlots: readonly ItemSummary["slot"][] = ["helmet", "arms", "chest", "legs", "class"]

const statLabels: readonly (readonly [keyof CharacterStats, string])[] = [
  ["mobility", "MOB"],
  ["resilience", "RES"],
  ["recovery", "REC"],
  ["discipline", "DIS"],
  ["intellect", "INT"],
  ["strength", "STR"],
]

const inSlots = (equipment: readonly ItemSummary[], slots: readonly ItemSummary["slot"][]) =>
  slots.flatMap((slot) => equipment.filter((item) => item.slot === slot))

function Weapon({ item }: { item: ItemSummary }) {
  const tone = Rarity[item.tier].color
  return (
    <View style={[styles.card, styles.weapon, { borderTopColor: tone }]}>
      <Swatch rarity={item.tier} icon={item.icon} size={48} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.weaponName}>
          {item.name}
        </Text>
        <Mono size={9} color={tone} style={{ marginTop: 2 }}>
          {item.damageType === "none" || item.damageType === item.slot
            ? item.slot.toUpperCase()
            : `${item.slot} · ${item.damageType}`.toUpperCase()}
        </Mono>
        <Mono size={12} color={Ghost.power} style={{ marginTop: 6, letterSpacing: 0 }}>
          {item.power ?? "—"}
        </Mono>
      </View>
    </View>
  )
}

function Armor({ item }: { item: ItemSummary }) {
  const tone = Rarity[item.tier].color
  const exotic = item.tier === "exotic"
  return (
    <View style={[styles.card, styles.armor, { borderLeftColor: tone }]}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.armorName}>
          {item.name}
        </Text>
        <Mono size={9} color={exotic ? tone : Ghost.muted}>
          {exotic ? `${item.slot} · EXOTIC`.toUpperCase() : item.slot.toUpperCase()}
        </Mono>
      </View>
      <Mono size={11} color={Ghost.power} style={{ letterSpacing: 0 }}>
        {item.power ?? "—"}
      </Mono>
    </View>
  )
}

export default function GuardianScreen() {
  const guardian = useGuardian()
  const [selected, setSelected] = useState<string>()

  const characters = guardian.data?.characters ?? []
  const character = characters.find((each) => each.characterId === selected) ?? characters[0]

  return (
    <>
      <Stack.Screen options={{ title: "Equipped" }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={guardian.isRefetching}
            onRefresh={() => void guardian.refetch()}
            tintColor={Ghost.muted}
          />
        }
      >
        {guardian.isPending ? (
          <Text style={styles.loading}>Loading…</Text>
        ) : !guardian.data || !character ? (
          <Unavailable error={guardian.error} onRetry={() => void guardian.refetch()} />
        ) : (
          <>
            <View style={styles.between}>
              <View style={{ gap: 6 }}>
                <Mono style={{ letterSpacing: 1.2 }}>{character.classType.toUpperCase()}</Mono>
                <Mono color={Ghost.accent}>
                  VAULT {guardian.data.vaultCount}/{guardian.data.vaultCapacity}
                </Mono>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Mono style={{ letterSpacing: 1.2 }}>POWER</Mono>
                <Text style={styles.power}>{character.light}</Text>
              </View>
            </View>
            {characters.length > 1 ? (
              <Segmented
                options={characters.map((each) => ({
                  value: each.characterId,
                  label: each.classType[0]?.toUpperCase() + each.classType.slice(1),
                }))}
                value={character.characterId}
                onChange={setSelected}
              />
            ) : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={styles.column}>
                <Mono size={9} color={Ghost.dim}>
                  WEAPONS
                </Mono>
                {inSlots(character.equipment, weaponSlots).map((item) => (
                  <Weapon key={item.slot} item={item} />
                ))}
              </View>
              <View style={[styles.column, { gap: 6 }]}>
                <Mono size={9} color={Ghost.dim} style={{ marginBottom: 4 }}>
                  ARMOR
                </Mono>
                {inSlots(character.equipment, armorSlots).map((item) => (
                  <Armor key={item.slot} item={item} />
                ))}
              </View>
            </View>
            <View style={styles.stats}>
              <StatRow
                stats={statLabels.map(([key, label]) => ({ label, value: character.stats[key] }))}
              />
            </View>
            {character.postmasterCount > 0 ? (
              <Banner
                text={`Postmaster is at ${character.postmasterCount}/${POSTMASTER_SIZE}. Clear it?`}
                action="Ask Ghost"
                onPress={() =>
                  router.navigate({
                    pathname: "/ghost",
                    params: { prompt: "Empty the postmaster into the vault" },
                  })
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  loading: { fontFamily: Type.light, fontSize: 14, color: Ghost.muted },
  power: {
    fontFamily: Type.light,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -1.2,
    color: Ghost.power,
  },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  column: { flex: 1, gap: 10 },
  card: { backgroundColor: Ghost.card, borderWidth: 1, borderColor: Ghost.line },
  weapon: { borderTopWidth: 2, borderRadius: 8, padding: 10, flexDirection: "row", gap: 10 },
  weaponName: { fontFamily: Type.medium, fontSize: 14, color: Ghost.text },
  armor: {
    borderLeftWidth: 2,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  armorName: { fontFamily: Type.medium, fontSize: 13, color: Ghost.text },
  stats: { borderTopWidth: 1, borderTopColor: Ghost.line, paddingTop: 14 },
})
