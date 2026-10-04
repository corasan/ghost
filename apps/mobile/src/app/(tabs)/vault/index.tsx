import type { ItemSummary } from "@ghost/contract"
import { router, Stack } from "expo-router"
import { useState } from "react"
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native"

import { Banner, Check, Mono, Swatch } from "@/components/ghost/ui"
import { Unavailable } from "@/components/ghost/unavailable"
import { Segmented } from "@/components/native"
import { Ghost, Type } from "@/constants/theme"
import { useVault } from "@/lib/api"

type Filter = "all" | "weapons" | "armor"

const weaponSlots: readonly ItemSummary["slot"][] = ["kinetic", "energy", "power"]
const matches = (item: ItemSummary, filter: Filter) =>
  filter === "all" ||
  (filter === "weapons"
    ? weaponSlots.includes(item.slot)
    : item.slot !== "other" && !weaponSlots.includes(item.slot))

const CLEANUP_PROMPT =
  "Look through my vault and flag duplicates with a better copy and low-scoring rolls."

export default function VaultScreen() {
  const vault = useVault()
  const [filter, setFilter] = useState<Filter>("all")
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  // Only instanced gear can be tagged or dismantled one copy at a time.
  const gear = (vault.data?.items ?? []).flatMap((item) =>
    item.itemInstanceId ? [{ ...item, id: item.itemInstanceId }] : [],
  )
  const shown = gear.filter((item) => matches(item, filter))
  const selected = gear.filter((item) => picked.has(item.id))

  const toggle = (id: string) =>
    setPicked((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })

  // Chat lives in one place: actions hand the selection to the Ghost tab as
  // a queued request, which the user still has to send.
  const ask = (prompt: string) => router.navigate({ pathname: "/ghost", params: { prompt } })
  const names = selected.map((item) => item.name).join(", ")

  const dismantle = () =>
    Alert.alert(
      `Dismantle ${selected.length} items?`,
      "Dismantled items are gone for good. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismantle",
          style: "destructive",
          onPress: () => ask(`Dismantle these vault items: ${names}`),
        },
      ],
    )

  return (
    <>
      <Stack.Screen options={{ title: "Vault" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="checklist" disabled={selected.length === 0}>
          <Stack.Toolbar.MenuAction
            icon="tag"
            onPress={() => ask(`Tag these vault items as junk: ${names}`)}
          >
            {`Tag ${selected.length} as junk`}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={dismantle}>
            {`Dismantle ${selected.length}`}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8 }}
        data={vault.data ? shown : []}
        keyExtractor={(item) => item.id}
        refreshing={vault.isRefetching}
        onRefresh={() => void vault.refetch()}
        ListHeaderComponent={
          vault.data ? (
            <View style={{ gap: 14, paddingBottom: 4 }}>
              <View style={styles.between}>
                <Mono style={{ letterSpacing: 1.2 }}>
                  {selected.length > 0 ? `${selected.length} SELECTED` : "TAP ITEMS TO SELECT"}
                </Mono>
                <Mono size={11}>
                  {vault.data.count}
                  <Text style={{ color: Ghost.dim }}>/{vault.data.capacity}</Text>
                </Mono>
              </View>
              <View style={styles.meter}>
                <View
                  style={{
                    width: `${Math.min(100, (vault.data.count / vault.data.capacity) * 100)}%`,
                    height: 2,
                    backgroundColor:
                      vault.data.count / vault.data.capacity > 0.9 ? Ghost.danger : Ghost.accent,
                  }}
                />
              </View>
              <Banner
                text="Let Ghost flag duplicates and low rolls."
                action="Start cleanup"
                onPress={() => ask(CLEANUP_PROMPT)}
              />
              <Segmented
                options={[
                  { value: "all", label: `All · ${gear.length}` },
                  { value: "weapons", label: "Weapons" },
                  { value: "armor", label: "Armor" },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </View>
          ) : (
            <View />
          )
        }
        ListEmptyComponent={
          vault.isPending ? (
            <Text style={styles.loading}>Loading…</Text>
          ) : vault.data ? (
            <View />
          ) : (
            <Unavailable error={vault.error} onRetry={() => void vault.refetch()} />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => toggle(item.id)} style={styles.row}>
            <Check on={picked.has(item.id)} />
            <Swatch rarity={item.tier} icon={item.icon} size={48} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.name}>
                {item.name}
              </Text>
              <Mono size={9} style={{ marginTop: 2 }}>
                {item.typeName.toUpperCase()}
              </Mono>
            </View>
            <Mono size={12} color={Ghost.power} style={{ letterSpacing: 0 }}>
              {item.power ?? "—"}
            </Mono>
          </Pressable>
        )}
      />
    </>
  )
}

const styles = StyleSheet.create({
  loading: { fontFamily: Type.light, fontSize: 14, color: Ghost.muted },
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
})
