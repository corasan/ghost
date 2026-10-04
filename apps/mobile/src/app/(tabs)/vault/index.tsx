import { router, Stack } from "expo-router"
import { useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { Banner, Check, Mono, Swatch } from "@/components/ghost/ui"
import { Segmented } from "@/components/native"
import { Ghost, Type } from "@/constants/theme"
import { type FlaggedItem, flagged, guardian } from "@/lib/sample"

type Filter = "all" | FlaggedItem["reason"]

const scoreColor = (score: number) =>
  score >= 60 ? Ghost.good : score >= 40 ? Ghost.power : Ghost.danger

export default function VaultScreen() {
  const [filter, setFilter] = useState<Filter>("all")
  const [kept, setKept] = useState(
    () => new Set(flagged.filter((item) => item.keep).map((item) => item.id)),
  )

  const toggle = (id: string) =>
    setKept((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const dupes = flagged.filter((item) => item.reason === "dupe").length
  const shown = flagged.filter((item) => filter === "all" || item.reason === filter)
  const selected = flagged.filter((item) => !kept.has(item.id))
  const { used, size } = guardian.vault

  // Chat lives in one place: both actions hand the selection to the Ghost
  // tab as a queued request, which the user still has to send.
  const ask = (verb: string) =>
    router.navigate({
      pathname: "/ghost",
      params: { prompt: `${verb}: ${selected.map((item) => item.name).join(", ")}` },
    })

  const dismantle = () =>
    Alert.alert(
      `Dismantle ${selected.length} items?`,
      "Dismantled items are gone for good. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismantle",
          style: "destructive",
          onPress: () => ask("Dismantle these vault items"),
        },
      ],
    )

  return (
    <>
      <Stack.Screen options={{ title: "Vault" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="checklist" disabled={selected.length === 0}>
          <Stack.Toolbar.MenuAction icon="tag" onPress={() => ask("Tag these vault items as junk")}>
            {`Tag ${selected.length} as junk`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={dismantle}>
            {`Dismantle ${selected.length}`}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}
      >
        <View style={styles.between}>
          <Mono color={Ghost.danger} style={{ letterSpacing: 1.2 }}>
            CLEANUP MODE
          </Mono>
          <Mono size={11}>
            {used}
            <Text style={{ color: Ghost.dim }}>/{size}</Text>
          </Mono>
        </View>
        <View style={styles.meter}>
          <View
            style={{ width: `${(used / size) * 100}%`, height: 2, backgroundColor: Ghost.danger }}
          />
        </View>
        <Banner
          text={`Flagged ${flagged.length} items: ${dupes} duplicates with a better copy, ${flagged.length - dupes} low rolls. Untick anything you want to keep.`}
        />
        <Segmented
          options={[
            { value: "all", label: `Flagged · ${flagged.length}` },
            { value: "dupe", label: "Dupes" },
            { value: "low", label: "Low roll" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <View>
          {shown.map((item) => {
            const keep = kept.has(item.id)
            return (
              <Pressable
                key={item.id}
                onPress={() => toggle(item.id)}
                style={[styles.row, keep && { opacity: 0.45 }]}
              >
                <Check on={!keep} />
                <Swatch rarity={item.rarity} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Mono size={9} style={{ marginTop: 2 }}>
                    {keep ? `${item.why} · YOU UNTICKED` : item.why}
                  </Mono>
                  <Text numberOfLines={1} style={styles.perks}>
                    {item.perks}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Mono size={12} color={scoreColor(item.score)} style={{ letterSpacing: 0 }}>
                    ROLL {item.score}
                  </Mono>
                  <Mono size={9} color={Ghost.dim} style={{ letterSpacing: 0 }}>
                    {item.power}
                  </Mono>
                </View>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meter: { height: 2, backgroundColor: Ghost.card },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.line,
  },
  name: { fontFamily: Type.medium, fontSize: 14, color: Ghost.text },
  perks: { fontFamily: Type.regular, fontSize: 11, color: Ghost.dim, marginTop: 4 },
})
