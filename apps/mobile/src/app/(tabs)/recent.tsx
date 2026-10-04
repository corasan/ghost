import type { RecentItem } from "@ghost/contract"
import { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Body, Chip, Header, Loading, Mono } from "@/components/ui"
import { useRecentItems, useSetDecision } from "@/lib/api"
import { clock, groupRecent, locationLabel, sourceLabel } from "@/lib/format"
import { colors, tierFill } from "@/theme"

type Filter = "all" | "undecided" | "decided"
const WINDOW_HOURS = 48

// 06 · Recent tab. A timeline of what you just got, grouped by where it came
// from, with keep / junk decided right on the row.
export default function RecentScreen() {
  const recent = useRecentItems()
  const decide = useSetDecision()
  const [filter, setFilter] = useState<Filter>("all")

  const all = recent.data ?? []
  const undecided = all.filter((i) => i.decision === null).length
  const fresh = all.filter(
    (i) => Date.now() - new Date(i.firstSeenAt).getTime() < WINDOW_HOURS * 3_600_000,
  ).length

  const groups = useMemo(() => {
    const visible =
      filter === "undecided"
        ? all.filter((i) => i.decision === null)
        : filter === "decided"
          ? all.filter((i) => i.decision !== null)
          : all
    return groupRecent(visible)
  }, [all, filter])

  if (recent.isPending) return <Loading label="Loading recent items" />

  return (
    <View style={{ flex: 1 }}>
      <Header
        title="Recent"
        right={
          <Mono style={{ paddingBottom: 4 }}>
            {fresh} NEW · {WINDOW_HOURS}H
          </Mono>
        }
      />
      <View style={styles.chips}>
        <Chip label="All" active={filter === "all"} onPress={() => setFilter("all")} />
        <Chip
          label={`Undecided · ${undecided}`}
          active={filter === "undecided"}
          onPress={() => setFilter("undecided")}
        />
        <Chip
          label={`Decided · ${all.length - undecided}`}
          active={filter === "decided"}
          onPress={() => setFilter("decided")}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 24,
          gap: 18,
        }}
      >
        {groups.length === 0 ? (
          <Body size={13} color={colors.dim} style={{ textAlign: "center", paddingTop: 40 }}>
            Nothing yet. Items Ghost pulls from the postmaster land here.
          </Body>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={{ gap: 4 }}>
              <Mono size={9} color={colors.muted} tracking={1.3} style={{ marginBottom: 6 }}>
                {clock(group.at)} · {sourceLabel(group.source)} · {group.items.length}
              </Mono>
              {group.items.map((item) => (
                <Row
                  key={item.itemInstanceId}
                  item={item}
                  busy={decide.isPending && decide.variables?.id === item.itemInstanceId}
                  onDecide={(decision) => decide.mutate({ id: item.itemInstanceId, decision })}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

function Row({
  item,
  busy,
  onDecide,
}: {
  item: RecentItem
  busy: boolean
  onDecide: (decision: "keep" | "junk" | null) => void
}) {
  return (
    <View style={[styles.row, busy ? { opacity: 0.5 } : null]}>
      <View style={styles.swatch} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body weight="medium" numberOfLines={1}>
          {item.name ?? `Item ${item.itemHash}`}
        </Body>
        <Mono size={9} tracking={0.8} style={{ marginTop: 3 }}>
          {locationLabel(item.location)}
        </Mono>
      </View>
      {item.decision === null ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable style={styles.decide} onPress={() => onDecide("keep")} disabled={busy}>
            <Text style={{ color: colors.green, fontSize: 14 }}>✓</Text>
          </Pressable>
          <Pressable style={styles.decide} onPress={() => onDecide("junk")} disabled={busy}>
            <Text style={{ color: colors.red, fontSize: 14 }}>✕</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => onDecide(null)} disabled={busy} hitSlop={8}>
          <Mono size={9} color={item.decision === "keep" ? colors.green : colors.red}>
            {item.decision === "keep" ? "KEPT" : "JUNK"}
          </Mono>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: 20, paddingTop: 14, flexDirection: "row", gap: 6 },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  swatch: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: colors.legendary,
    backgroundColor: tierFill("legendary"),
  },
  decide: {
    width: 34,
    height: 34,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
})
