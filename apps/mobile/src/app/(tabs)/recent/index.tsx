import { Stack } from "expo-router"
import { useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"

import { Mono, Swatch } from "@/components/ghost/ui"
import { Segmented } from "@/components/native"
import { Ghost, Type } from "@/constants/theme"
import { useRecentItems, useSetDecision } from "@/lib/api"
import { clock, groupRecent, locationLabel, sourceLabel } from "@/lib/format"

export default function RecentScreen() {
  const recent = useRecentItems()
  const setDecision = useSetDecision()
  const [filter, setFilter] = useState<"all" | "undecided">("all")

  const items = recent.data ?? []
  const undecided = items.filter((item) => item.decision === null)

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
        {groupRecent(filter === "undecided" ? undecided : items).map((group) => (
          <View key={group.key}>
            <Mono size={9} color={Ghost.dim} style={{ marginBottom: 6 }}>
              {clock(group.at)} · {sourceLabel(group.source)} · {group.items.length}
            </Mono>
            {group.items.map((item) => (
              <View key={item.itemInstanceId} style={styles.row}>
                <Swatch rarity={item.tier} icon={item.icon} size={48} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.name}>
                    {item.name ?? `Item ${item.itemHash}`}
                  </Text>
                  <Mono size={9} style={{ marginTop: 3 }}>
                    {item.typeName ? `${item.typeName.toUpperCase()} · ` : ""}
                    {locationLabel(item.location)}
                  </Mono>
                </View>
                {item.decision ? (
                  <Pressable
                    hitSlop={12}
                    accessibilityLabel="Clear decision"
                    onPress={() => setDecision.mutate({ id: item.itemInstanceId, decision: null })}
                  >
                    <Mono size={9} color={item.decision === "keep" ? Ghost.good : Ghost.danger}>
                      {item.decision === "keep" ? "KEPT" : "JUNK"}
                    </Mono>
                  </Pressable>
                ) : (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable
                      accessibilityLabel="Keep"
                      style={styles.decide}
                      onPress={() =>
                        setDecision.mutate({ id: item.itemInstanceId, decision: "keep" })
                      }
                    >
                      <Text style={{ color: Ghost.good, fontSize: 14 }}>✓</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Junk"
                      style={styles.decide}
                      onPress={() =>
                        setDecision.mutate({ id: item.itemInstanceId, decision: "junk" })
                      }
                    >
                      <Text style={{ color: Ghost.danger, fontSize: 14 }}>✕</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
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
