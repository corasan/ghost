import { router, Stack } from "expo-router"
import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { Banner, Mono, StatRow, Swatch } from "@/components/ghost/ui"
import { Segmented } from "@/components/native"
import { Ghost, Rarity, Type } from "@/constants/theme"
import { type GearItem, guardian } from "@/lib/sample"

function Weapon({ item }: { item: GearItem }) {
  const tone = Rarity[item.rarity].color
  return (
    <View style={[styles.card, styles.weapon, { borderTopColor: tone }]}>
      <Swatch rarity={item.rarity} size={48} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.weaponName}>
          {item.name}
        </Text>
        <Mono size={9} color={tone} style={{ marginTop: 2 }}>
          {item.slot}
        </Mono>
        <Mono size={12} color={Ghost.power} style={{ marginTop: 6, letterSpacing: 0 }}>
          {item.power}
        </Mono>
      </View>
    </View>
  )
}

function Armor({ item }: { item: GearItem }) {
  const tone = Rarity[item.rarity].color
  return (
    <View style={[styles.card, styles.armor, { borderLeftColor: tone }]}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.armorName}>
          {item.name}
        </Text>
        <Mono size={9} color={item.rarity === "exotic" ? tone : Ghost.muted}>
          {item.slot}
        </Mono>
      </View>
      <Mono size={11} color={Ghost.power} style={{ letterSpacing: 0 }}>
        {item.power}
      </Mono>
    </View>
  )
}

export default function GuardianScreen() {
  // Only the first character has sample gear until the server sends equipment.
  const [character, setCharacter] = useState(guardian.classes[0] ?? "")
  return (
    <>
      <Stack.Screen options={{ title: "Equipped" }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 20 }}
      >
        <View style={styles.between}>
          <View style={{ gap: 6 }}>
            <Mono style={{ letterSpacing: 1.2 }}>{guardian.subtitle}</Mono>
            <Mono color={Ghost.accent}>
              VAULT {guardian.vault.used}/{guardian.vault.size}
            </Mono>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Mono style={{ letterSpacing: 1.2 }}>POWER</Mono>
            <Text style={styles.power}>{guardian.power}</Text>
          </View>
        </View>
        <Segmented
          options={guardian.classes.map((name) => ({ value: name, label: name }))}
          value={character}
          onChange={setCharacter}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={styles.column}>
            <Mono size={9} color={Ghost.dim}>
              WEAPONS
            </Mono>
            {guardian.weapons.map((item) => (
              <Weapon key={item.name} item={item} />
            ))}
          </View>
          <View style={[styles.column, { gap: 6 }]}>
            <Mono size={9} color={Ghost.dim} style={{ marginBottom: 4 }}>
              ARMOR
            </Mono>
            {guardian.armor.map((item) => (
              <Armor key={item.name} item={item} />
            ))}
          </View>
        </View>
        <View style={styles.stats}>
          <StatRow stats={guardian.stats} />
        </View>
        <Banner
          text={guardian.suggestion.text}
          action="Ask Ghost"
          onPress={() =>
            router.navigate({ pathname: "/ghost", params: { prompt: guardian.suggestion.prompt } })
          }
        />
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
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
