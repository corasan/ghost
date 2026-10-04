import type { RecentItem } from "@ghost/contract"
import { Stack } from "expo-router"
import { useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"

import { Mono, Swatch } from "@/components/ghost/ui"
import { Segmented } from "@/components/native"
import { Ghost, Type } from "@/constants/theme"
import { useRecentItems } from "@/lib/api"
import { clock } from "@/lib/format"

type Decision = "kept" | "junk"

const place: Record<RecentItem["location"], string> = {
  postmaster: "STILL AT POSTMASTER",
  character: "ON CHARACTER",
  vault: "NOW IN VAULT",
}

// Items first seen in the same minute arrived together, so they share a group.
function groupByArrival(items: readonly RecentItem[]) {
  const groups = new Map<string, RecentItem[]>()
  for (const item of items) {
    const key = clock(item.firstSeenAt)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups]
}

export default function RecentScreen() {
  const recent = useRecentItems()
  const [filter, setFilter] = useState<"all" | "undecided">("all")
  // Kept on the device until the server can tag items.
  const [decisions, setDecisions] = useState<ReadonlyMap<string, Decision>>(new Map())

  const items = recent.data ?? []
  const undecided = items.filter((item) => !decisions.has(item.itemInstanceId))
  const decide = (id: string, decision: Decision) =>
    setDecisions((previous) => new Map(previous).set(id, decision))

  return (
    <>
      <Stack.Screen options={{ title: "Recent" }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 18 }}
        refreshControl={
          <RefreshControl
            refreshing={recent.isRefetching}
            onRefresh={() => void recent.refetch()}
            tintColor={Ghost.muted}
          />
        }
      >
        <Segmented
          options={[
            { value: "all", label: `All · ${items.length}` },
            { value: "undecided", label: `Undecided · ${undecided.length}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {items.length === 0 ? (
          <Text style={styles.empty}>
            {recent.isPending
              ? "Loading…"
              : recent.isError
                ? "Can't reach the Ghost server."
                : "Nothing new yet. Items Ghost pulls from the postmaster show up here."}
          </Text>
        ) : null}
        {groupByArrival(filter === "undecided" ? undecided : items).map(([time, group]) => (
          <View key={time}>
            <Mono size={9} color={Ghost.dim} style={{ marginBottom: 6 }}>
              {time} · {group.length}
            </Mono>
            {group.map((item) => {
              const decision = decisions.get(item.itemInstanceId)
              return (
                <View key={item.itemInstanceId} style={styles.row}>
                  <Swatch size={48} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.name}>
                      {item.name ?? `Item ${item.itemHash}`}
                    </Text>
                    <Mono size={9} style={{ marginTop: 3 }}>
                      {place[item.location]}
                    </Mono>
                  </View>
                  {decision ? (
                    <Mono size={9} color={decision === "kept" ? Ghost.good : Ghost.danger}>
                      {decision.toUpperCase()}
                    </Mono>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Pressable
                        accessibilityLabel="Keep"
                        style={styles.decide}
                        onPress={() => decide(item.itemInstanceId, "kept")}
                      >
                        <Text style={{ color: Ghost.good, fontSize: 14 }}>✓</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Junk"
                        style={styles.decide}
                        onPress={() => decide(item.itemInstanceId, "junk")}
                      >
                        <Text style={{ color: Ghost.danger, fontSize: 14 }}>✕</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  empty: { fontFamily: Type.light, fontSize: 14, lineHeight: 21, color: Ghost.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.line,
  },
  name: { fontFamily: Type.medium, fontSize: 14, color: Ghost.text },
  decide: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Ghost.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
})
