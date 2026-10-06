import type { RecentItem } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { useLocalSearchParams } from "expo-router"
import { useMemo, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"

import { ItemIcon } from "@/components/ghost/item-icon"
import { Body, Chip, Mono, Nudge, PageHeader } from "@/components/ghost/ui"
import { Ghost, Gutter, Type } from "@/constants/theme"
import { useJobs, useRecentItems, useSetDecision, useUndoPlan } from "@/lib/api"
import { useCharacter } from "@/lib/character"
import { usePullRefresh } from "@/lib/refresh"
import { clock, groupRecent, locationLabel, sourceLabel, upper } from "@/lib/format"
import { useBottomInset } from "@/lib/insets"

type Filter = "all" | "undecided" | "upgrades"

type Row =
  | { type: "group"; key: string; label: string; jobId: string | null }
  | { type: "item"; key: string; item: RecentItem }

function Decide({ item }: { item: RecentItem }) {
  const setDecision = useSetDecision()
  const decide = (decision: RecentItem["decision"]) =>
    setDecision.mutate({ id: item.itemInstanceId, decision })
  if (item.decision) {
    return (
      <Pressable hitSlop={12} accessibilityLabel="Undo decision" onPress={() => decide(null)}>
        <Mono color={item.decision === "keep" ? Ghost.good : Ghost.danger}>
          {item.decision === "keep" ? "KEPT" : "JUNK"}
        </Mono>
      </Pressable>
    )
  }
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Pressable accessibilityLabel="Keep" style={styles.decide} onPress={() => decide("keep")}>
        <View style={styles.check} />
      </Pressable>
      <Pressable accessibilityLabel="Junk" style={styles.decide} onPress={() => decide("junk")}>
        <Body size={13} color={Ghost.danger}>
          ✕
        </Body>
      </Pressable>
    </View>
  )
}

function ItemRow({ item }: { item: RecentItem }) {
  const meta = [
    item.typeName ? upper(item.typeName) : null,
    item.power !== null ? String(item.power) : null,
    locationLabel(item.location),
  ].filter(Boolean)
  return (
    <View style={styles.row}>
      <ItemIcon
        icon={item.icon}
        size={48}
        element={item.damageType}
        gearTier={item.gearTier}
        masterwork={item.masterwork}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Body size={15} style={{ fontFamily: Type.bodyMedium, flexShrink: 1 }} lines={1}>
            {item.name ?? `Item ${item.itemHash}`}
          </Body>
          {item.upgrade ? (
            <View style={styles.flag}>
              <Mono size={11} color={Ghost.good}>
                UPGRADE
              </Mono>
            </View>
          ) : null}
        </View>
        <Mono style={{ marginTop: 3, letterSpacing: 0.7 }} lines={1}>
          {meta.join(" · ")}
        </Mono>
      </View>
      <Decide item={item} />
    </View>
  )
}

/**
 * What you just got, grouped by where it came from, with where each item
 * lives now. A batch Ghost moved can be undone together.
 */
export default function RecentScreen() {
  const bottomInset = useBottomInset()
  const { filter: initial } = useLocalSearchParams<{ filter?: Filter }>()
  const [filter, setFilter] = useState<Filter>(initial ?? "all")
  const { character } = useCharacter()
  const recent = useRecentItems(character?.characterId)
  const pull = usePullRefresh(recent.refetch)
  const jobs = useJobs()
  const undo = useUndoPlan()

  const items = recent.data ?? []
  const undecided = items.filter((item) => item.decision === null)
  const upgrades = items.filter((item) => item.upgrade)
  const shown = filter === "all" ? items : filter === "undecided" ? undecided : upgrades

  const undoable = useMemo(
    () =>
      new Set((jobs.data ?? []).flatMap((job) => (job.plan?.status === "applied" ? [job.id] : []))),
    [jobs.data],
  )

  const rows = useMemo<Row[]>(
    () =>
      groupRecent(shown).flatMap((group) => [
        {
          type: "group" as const,
          key: `g-${group.key}`,
          label: `${clock(group.at)} · ${group.jobId ? "MOVED BY GHOST" : sourceLabel(group.source)} · ${group.items.length}`,
          jobId: group.jobId,
        },
        ...group.items.map((item) => ({
          type: "item" as const,
          key: item.itemInstanceId,
          item,
        })),
      ]),
    [shown],
  )

  const best = upgrades.find((item) => item.decision === null)

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <PageHeader
        title="RECENT"
        subtitle="LAST 48 HOURS"
        figure={items.length}
        caption={`${undecided.length} UNDECIDED`}
      />
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: Gutter, paddingTop: 18 }}>
        <Chip label="ALL" active={filter === "all"} onPress={() => setFilter("all")} />
        <Chip
          label="UNDECIDED"
          active={filter === "undecided"}
          onPress={() => setFilter("undecided")}
        />
        <Chip
          label={`UPGRADES ${upgrades.length}`}
          active={filter === "upgrades"}
          onPress={() => setFilter("upgrades")}
        />
      </View>
      <LegendList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        recycleItems
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        contentContainerStyle={{ paddingHorizontal: Gutter, paddingTop: 14, paddingBottom: 16 }}
        ListEmptyComponent={
          <Body color={Ghost.dim} style={{ paddingTop: 24 }}>
            {recent.isPending
              ? "Loading…"
              : recent.isError
                ? "Can't reach the Ghost server."
                : filter === "all"
                  ? "Nothing new in the last two days. Ghost notices new drops each time it syncs your inventory."
                  : "Nothing here right now."}
          </Body>
        }
        renderItem={({ item: row }) =>
          row.type === "group" ? (
            <View style={styles.group}>
              <Mono>{row.label}</Mono>
              {row.jobId && undoable.has(row.jobId) ? (
                <Pressable
                  hitSlop={10}
                  disabled={undo.isPending}
                  onPress={() => row.jobId && undo.mutate(row.jobId)}
                >
                  <Mono color={Ghost.accent}>{undo.isPending ? "UNDOING…" : "UNDO"}</Mono>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <ItemRow item={row.item} />
          )
        }
      />
      {best ? (
        <View style={{ paddingBottom: bottomInset + 16, paddingTop: 8 }}>
          <Nudge
            text={`${best.name ?? "A new drop"} beats what you have on in that slot.`}
            action="SWAP"
            prompt={`Equip my new ${best.name ?? "upgrade"} if it's really better than what I have on`}
          />
        </View>
      ) : (
        <View style={{ height: bottomInset }} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 14,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  flag: { borderWidth: 1, borderColor: Ghost.good, paddingHorizontal: 5, paddingVertical: 2 },
  decide: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 10,
    height: 5,
    marginTop: -3,
    borderLeftWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: Ghost.good,
    transform: [{ rotate: "-45deg" }],
  },
})
