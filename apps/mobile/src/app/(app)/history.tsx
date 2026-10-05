import type { HistoryGroup } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Body, Cond, Mono, PageHeader } from "@/components/ghost/ui"
import { usePullRefresh } from "@/lib/refresh"
import { Ghost, Gutter, Type } from "@/constants/theme"
import { useHistory, useUndoPlan } from "@/lib/api"
import { clock, isToday } from "@/lib/format"

const tone = {
  ok: Ghost.good,
  failed: Ghost.danger,
  held: Ghost.dim,
  undone: Ghost.muted,
} as const

const statusLabel = { ok: "OK", failed: "FAILED", held: "HELD", undone: "UNDONE" } as const

function Group({ group }: { group: HistoryGroup }) {
  const undo = useUndoPlan()
  const moves = group.calls.filter((call) => call.status === "ok").length
  return (
    <View style={{ gap: 10, opacity: group.undone ? 0.55 : 1 }}>
      <View style={styles.between}>
        <Body size={16} style={{ fontFamily: Type.bodyMedium, flex: 1 }} lines={1}>
          “{group.prompt}”
        </Body>
        <Mono>{clock(group.at)}</Mono>
      </View>
      {group.calls.length > 0 ? (
        <View style={styles.calls}>
          {group.calls.map((call) => (
            <View key={`${call.label}${call.status}`} style={styles.between}>
              <View style={[styles.dot, { backgroundColor: tone[call.status] }]} />
              <Mono size={12} color={Ghost.soft} style={{ letterSpacing: 0, flex: 1 }} lines={1}>
                {call.label}
              </Mono>
              <Mono color={tone[call.status]}>{statusLabel[call.status]}</Mono>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {group.undoable ? (
          <Pressable
            accessibilityRole="button"
            disabled={undo.isPending}
            onPress={() => undo.mutate(group.jobId)}
            style={styles.undo}
          >
            <Cond size={13}>{undo.isPending ? "UNDOING…" : "UNDO"}</Cond>
          </Pressable>
        ) : null}
        <Mono>
          {group.undone
            ? "UNDONE"
            : group.calls.length === 0
              ? "ANSWER ONLY · NOTHING MOVED"
              : `${moves} ${moves === 1 ? "CALL" : "CALLS"} · ${group.undoable ? "REVERSIBLE" : "NOTHING TO UNDO"}`}
        </Mono>
      </View>
    </View>
  )
}

/** Every call Ghost made, grouped under the request that triggered it. Undo reverses the group. */
export default function HistoryScreen() {
  const insets = useSafeAreaInsets()
  const history = useHistory()
  const pull = usePullRefresh(history.refetch)
  const groups = history.data ?? []
  const today = groups
    .filter((group) => isToday(group.at))
    .reduce((sum, group) => sum + group.calls.filter((call) => call.status === "ok").length, 0)

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <LegendList
        data={groups}
        keyExtractor={(group) => group.jobId}
        recycleItems
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View style={{ paddingBottom: 26 }}>
            <PageHeader title="HISTORY" subtitle="TODAY" figure={today} caption="ACTIONS" />
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 22 }} />}
        ListEmptyComponent={
          <Body color={Ghost.dim} style={{ paddingHorizontal: Gutter }}>
            {history.isPending
              ? "Loading…"
              : history.isError
                ? "Can't reach the Ghost server."
                : "Nothing yet. Everything Ghost does on your account is logged here, and can be undone."}
          </Body>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: Gutter }}>
            <Group group={item} />
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  calls: {
    borderLeftWidth: 1,
    borderLeftColor: Ghost.ruleStrong,
    marginLeft: 3,
    paddingLeft: 16,
    gap: 8,
  },
  dot: {
    position: "absolute",
    left: -19.5,
    top: 5,
    width: 6,
    height: 6,
    transform: [{ rotate: "45deg" }],
  },
  undo: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
  },
})
