import type { ItemSummary, Job, Plan } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { router } from "expo-router"
import { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { PlanRowView } from "@/components/chat/plan-block"
import { liveLabel } from "@/lib/plan-card"
import { Unavailable } from "@/components/ghost/unavailable"
import { ItemIcon } from "@/components/ghost/item-icon"
import { Body, Button, Chip, Cond, Cut, Mono, PageHeader, Said, Tick } from "@/components/ghost/ui"
import { Ghost, Gutter, Type } from "@/constants/theme"
import { useApplyPlan, useCreateJob, useJobs, useSetDecision, useVault } from "@/lib/api"
import { useCharacter } from "@/lib/character"
import { upper } from "@/lib/format"
import { usePullRefresh } from "@/lib/refresh"
import { usePlanSelection } from "@/lib/selection"
import { useSessionId } from "@/lib/session"
import { activeFilters, filterVault, isWeapon, removeFilter, SORT_LABEL } from "@/lib/vault-filter"
import {
  clearPicked,
  replaceVaultFilter,
  setVaultFilter,
  togglePicked,
  usePicked,
  useVaultFilter,
} from "@/lib/vault-store"

function itemMeta(item: ItemSummary) {
  if (isWeapon(item)) {
    const head = [item.typeName, item.damageType === "none" ? null : item.damageType]
      .filter(Boolean)
      .map((s) => upper(String(s)))
      .join(" · ")
    return item.perks.length > 0 ? `${head} · ${item.perks.slice(-2).join(" · ")}` : head
  }
  return [item.typeName, item.classType, item.statTotal !== null ? `${item.statTotal} TOTAL` : null]
    .filter(Boolean)
    .map((s) => upper(String(s)))
    .join(" · ")
}

function VaultRow({
  item,
  selecting,
  picked,
  onPress,
  onLongPress,
}: {
  item: ItemSummary
  selecting: boolean
  picked: boolean
  onPress: () => void
  onLongPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: picked } : undefined}
      accessibilityHint={selecting ? undefined : "Opens details. Long press for actions."}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, (picked || pressed) && { backgroundColor: Ghost.panel }]}
    >
      {selecting ? <Tick on={picked} under={Ghost.bg} /> : null}
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
            {item.name}
          </Body>
          {item.decision === "junk" ? <Tag label="JUNK" color={Ghost.danger} /> : null}
          {item.duplicates > 0 ? <Tag label={`×${item.duplicates + 1}`} color={Ghost.dim} /> : null}
        </View>
        <Mono style={{ marginTop: 3, letterSpacing: 0.7 }} lines={1}>
          {itemMeta(item)}
        </Mono>
      </View>
      <Cond size={17} color={Ghost.gold} style={{ letterSpacing: 0 }}>
        {item.power ?? "—"}
      </Cond>
    </Pressable>
  )
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Mono size={8} color={color}>
        {label}
      </Mono>
    </View>
  )
}

/**
 * Cleanup mode: Ghost's flagged list replaces the vault. Untick anything to
 * keep, then tag the rest as junk. Bungie's API can't dismantle items, so
 * junk tags are the hand-off: filter by JUNK in game-side tools or here.
 */
function Cleanup({ job, plan }: { job: Job; plan: Plan }) {
  const insets = useSafeAreaInsets()
  const apply = useApplyPlan()
  const [kind, setKind] = useState<"all" | "dupes" | "low">("all")
  const selection = usePlanSelection(job.id, plan)
  const isDupe = (meta: string) => /DUPLICATE/i.test(meta)
  const dupes = plan.rows.filter((row) => isDupe(row.meta)).length
  const rows = plan.rows.filter(
    (row) => kind === "all" || (kind === "dupes" ? isDupe(row.meta) : !isDupe(row.meta)),
  )
  const ticked = selection.selected.size

  return (
    <>
      {job.result ? (
        <View style={{ marginHorizontal: Gutter, marginTop: 18 }}>
          <Said size={14}>{job.result}</Said>
        </View>
      ) : null}
      <View style={styles.chips}>
        <Chip
          label={`FLAGGED ${plan.rows.length}`}
          active={kind === "all"}
          onPress={() => setKind("all")}
        />
        <Chip label={`DUPES ${dupes}`} active={kind === "dupes"} onPress={() => setKind("dupes")} />
        <Chip
          label={`LOW ROLL ${plan.rows.length - dupes}`}
          active={kind === "low"}
          onPress={() => setKind("low")}
        />
      </View>
      <LegendList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(row) => row.itemInstanceId}
        recycleItems
        extraData={selection.selected}
        contentContainerStyle={{ paddingHorizontal: Gutter - 14, paddingTop: 8 }}
        renderItem={({ item: row }) => (
          <PlanRowView
            row={row}
            applied={false}
            under={Ghost.bg}
            ticked={selection.selected.has(row.itemInstanceId)}
            onToggle={() => selection.toggle(row.itemInstanceId)}
          />
        )}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          label={ticked === plan.rows.length ? "KEEP ALL" : "SELECT ALL"}
          onPress={() => selection.setAll(ticked !== plan.rows.length)}
        />
        <Button
          label={apply.isPending ? "TAGGING…" : liveLabel(plan.confirmLabel, ticked)}
          tone="danger"
          flex={1.3}
          disabled={ticked === 0 || apply.isPending}
          onPress={() => apply.mutate({ jobId: job.id, selected: [...selection.selected] })}
        />
      </View>
    </>
  )
}

function Filters({ shown }: { shown: number }) {
  const filter = useVaultFilter()
  const active = activeFilters(filter)
  return (
    <View style={{ paddingTop: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: Gutter }}>
        <Cut fill={Ghost.panel} border={Ghost.line} style={{ flex: 1 }}>
          <TextInput
            value={filter.query}
            onChangeText={(query) => setVaultFilter({ query })}
            placeholder="Name, perk or type"
            placeholderTextColor={Ghost.dim}
            keyboardAppearance="dark"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.search}
          />
        </Cut>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filter and sort, ${active.length} filters on, sorted by ${SORT_LABEL[filter.sort]}`}
          onPress={() => router.push("/vault-filter")}
          style={[styles.filter, active.length > 0 && { borderColor: Ghost.accent }]}
        >
          <Mono size={8} color={active.length > 0 ? Ghost.accent : Ghost.dim}>
            {active.length > 0 ? `FILTER · ${active.length}` : "FILTER"}
          </Mono>
          <Cond size={13}>{SORT_LABEL[filter.sort]}</Cond>
        </Pressable>
      </View>
      {active.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: Gutter, alignItems: "center" }}
        >
          {active.map((each) => (
            <Chip
              key={each.id}
              label={`${each.label} ×`}
              active
              onPress={() => replaceVaultFilter(removeFilter(filter, each.id))}
            />
          ))}
          <Mono style={{ marginLeft: 6 }}>{shown} SHOWN</Mono>
        </ScrollView>
      ) : null}
    </View>
  )
}

export default function VaultScreen() {
  const insets = useSafeAreaInsets()
  const vault = useVault()
  const jobs = useJobs()
  const createJob = useCreateJob()
  const setDecision = useSetDecision()
  const { character } = useCharacter()
  const sessionId = useSessionId()
  const filter = useVaultFilter()
  const picked = usePicked()
  const pull = usePullRefresh(vault.refetch)

  const items = vault.data?.items ?? []
  const shown = useMemo(() => filterVault(items, filter), [items, filter])

  const latestCleanup = jobs.data?.find(
    (job) => job.kind === "vault_cleanup" || job.plan?.kind === "cleanup",
  )
  const reviewing =
    latestCleanup !== undefined &&
    (latestCleanup.status === "queued" || latestCleanup.status === "running")
  const cleanupPlan =
    latestCleanup?.plan?.kind === "cleanup" && latestCleanup.plan.status === "proposed"
      ? latestCleanup.plan
      : undefined
  const cleanup = cleanupPlan ? latestCleanup : undefined

  const count = vault.data?.count ?? 0
  const capacity = vault.data?.capacity ?? 0
  const fill = capacity > 0 ? count / capacity : 0
  const pickedItems = items.filter((item) => item.itemInstanceId && picked.has(item.itemInstanceId))
  const selecting = pickedItems.length > 0

  const startCleanup = () =>
    createJob.mutate({
      kind: "vault_cleanup",
      prompt: "Clean up my vault: flag duplicates with a better copy and low rolls.",
      characterId: character?.characterId ?? null,
      sessionId,
    })

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <PageHeader
        title="VAULT"
        subtitle={
          cleanup ? "CLEANUP MODE" : reviewing ? "GHOST IS REVIEWING" : `${shown.length} SHOWN`
        }
        subtitleColor={cleanup ? Ghost.danger : Ghost.dim}
        figure={vault.data ? count : "—"}
        figureSuffix={vault.data ? `/${capacity}` : undefined}
        caption={vault.data ? `${capacity - count} FREE` : "SPACE"}
      >
        <View style={styles.meter}>
          <View
            style={{
              width: `${Math.min(100, fill * 100)}%`,
              backgroundColor: fill >= 0.9 ? Ghost.danger : Ghost.accent,
            }}
          />
        </View>
      </PageHeader>

      {!vault.data ? (
        <View style={{ paddingHorizontal: Gutter }}>
          {vault.isPending ? (
            <Body color={Ghost.dim} style={{ paddingTop: 32 }}>
              Loading…
            </Body>
          ) : (
            <Unavailable error={vault.error} onRetry={() => void vault.refetch()} />
          )}
        </View>
      ) : cleanup && cleanupPlan ? (
        <Cleanup job={cleanup} plan={cleanupPlan} />
      ) : (
        <>
          <Pressable
            disabled={reviewing || createJob.isPending}
            onPress={startCleanup}
            style={{ marginHorizontal: Gutter, marginTop: 18 }}
          >
            <Said size={14}>
              {reviewing
                ? "Reviewing your vault for duplicates and weak rolls against current community picks…"
                : "Let Ghost flag duplicates with a better copy and rolls the community rates poorly."}
              {reviewing ? null : (
                <Body size={14} color={Ghost.accent}>
                  {" "}
                  START CLEANUP ›
                </Body>
              )}
            </Said>
          </Pressable>
          <Filters shown={shown.length} />
          <LegendList
            style={{ flex: 1 }}
            data={shown}
            keyExtractor={(item) => item.itemInstanceId ?? `${item.itemHash}`}
            recycleItems
            estimatedItemSize={63}
            extraData={picked}
            keyboardDismissMode="on-drag"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 16 }}
            ListEmptyComponent={
              <Body color={Ghost.dim} style={{ paddingHorizontal: Gutter, paddingTop: 24 }}>
                Nothing matches. Loosen a filter or clear the search.
              </Body>
            }
            renderItem={({ item }) => (
              <View style={{ paddingHorizontal: Gutter }}>
                <VaultRow
                  item={item}
                  selecting={selecting}
                  picked={item.itemInstanceId !== null && picked.has(item.itemInstanceId)}
                  onPress={() => {
                    if (item.itemInstanceId === null) return
                    if (selecting) togglePicked(item.itemInstanceId)
                    else
                      router.push({ pathname: "/item/[id]", params: { id: item.itemInstanceId } })
                  }}
                  onLongPress={() => {
                    if (item.itemInstanceId === null) return
                    router.push({
                      pathname: "/item-actions/[id]",
                      params: { id: item.itemInstanceId, select: "1" },
                    })
                  }}
                />
              </View>
            )}
          />
          {pickedItems.length > 0 ? (
            <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
              <Button label="CLEAR" flex={0.7} onPress={clearPicked} />
              <Button
                label={`ASK ABOUT ${pickedItems.length}`}
                onPress={() =>
                  createJob.mutate({
                    kind: "chat",
                    prompt: `Are these worth keeping? ${pickedItems.map((item) => item.name).join(", ")}`,
                    characterId: character?.characterId ?? null,
                    sessionId,
                  })
                }
              />
              <Button
                label={`JUNK ${pickedItems.length}`}
                tone="danger"
                onPress={() => {
                  for (const item of pickedItems) {
                    if (item.itemInstanceId)
                      setDecision.mutate({ id: item.itemInstanceId, decision: "junk" })
                  }
                  clearPicked()
                }}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  meter: { marginTop: 14, height: 3, backgroundColor: Ghost.rule, flexDirection: "row" },
  chips: { flexDirection: "row", gap: 6, paddingHorizontal: Gutter, paddingTop: 16 },
  search: {
    height: 40,
    paddingHorizontal: 12,
    fontFamily: Type.body,
    fontSize: 15,
    color: Ghost.ink,
  },
  filter: {
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
    paddingHorizontal: 10,
    justifyContent: "center",
    minWidth: 92,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
  },
  footer: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: Gutter,
    paddingTop: 12,
    backgroundColor: Ghost.bg,
    borderTopWidth: 1,
    borderTopColor: Ghost.headerRule,
  },
})
