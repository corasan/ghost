import type { ItemSummary, Job, Plan } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { AnimatedLegendList } from "@legendapp/list/reanimated"
import { router } from "expo-router"
import { type ReactNode, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native"
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { PlanRowView } from "@/components/chat/plan-block"
import { liveLabel } from "@/lib/plan-card"
import { Unavailable } from "@/components/ghost/unavailable"
import { ItemIcon } from "@/components/ghost/item-icon"
import {
  Bars,
  Body,
  Button,
  Chip,
  Cond,
  Cut,
  Meta,
  Mono,
  PageHeader,
  Said,
  Tick,
  useOpenDrawer,
} from "@/components/ghost/ui"
import { Ghost, Gutter, Type } from "@/constants/theme"
import {
  useApplyPlan,
  useCleanupPreview,
  useCreateJob,
  useJobs,
  useSetDecision,
  useVault,
} from "@/lib/api"
import { vaultSaid } from "@/lib/cleanup"
import { useCharacter } from "@/lib/character"
import { sentence } from "@/lib/format"
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
import { useBottomInset } from "@/lib/insets"

function itemMeta(item: ItemSummary) {
  if (isWeapon(item)) {
    const head = [item.typeName, item.damageType === "none" ? null : sentence(item.damageType)]
      .filter(Boolean)
      .join(" · ")
    return item.perks.length > 0 ? `${head} · ${item.perks.slice(-2).join(" · ")}` : head
  }
  return [
    item.typeName,
    item.classType ? sentence(item.classType) : null,
    item.statTotal !== null ? `${item.statTotal} total` : null,
  ]
    .filter(Boolean)
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
          {item.decision === "junk" ? <Tag label="Junk" color={Ghost.danger} /> : null}
          {item.duplicates > 0 ? <Tag label={`×${item.duplicates + 1}`} color={Ghost.dim} /> : null}
        </View>
        <Meta style={{ marginTop: 2 }} lines={1}>
          {itemMeta(item)}
        </Meta>
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
      <Meta size={12} color={color}>
        {label}
      </Meta>
    </View>
  )
}

/**
 * Cleanup mode: Ghost's flagged list replaces the vault. Untick anything to
 * keep, then tag the rest as junk. Bungie's API can't dismantle items, so
 * junk tags are the hand-off: filter by JUNK in game-side tools or here.
 */
function Cleanup({ job, plan }: { job: Job; plan: Plan }) {
  const bottomInset = useBottomInset()
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
      <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
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

function CleanupCard({ name }: { name: string }) {
  return (
    <Cut border={Ghost.ruleStrong} style={{ marginHorizontal: Gutter, marginTop: 16, padding: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Cond size={18} style={{ lineHeight: 22 }}>
            CLEAN UP MODE
          </Cond>
          <Meta style={{ marginTop: 3 }}>
            Ghost sends your junk to {name} in batches. You delete it in game.
          </Meta>
        </View>
        <Button
          label="CLEAN UP"
          tone="solid"
          flex={0}
          compact
          onPress={() => router.navigate("/cleanup")}
        />
      </View>
    </Cut>
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
          <Meta size={12} color={active.length > 0 ? Ghost.accent : Ghost.muted}>
            {active.length > 0 ? `Filter · ${active.length}` : "Filter"}
          </Meta>
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
          <Meta style={{ marginLeft: 6 }}>{shown} shown</Meta>
        </ScrollView>
      ) : null}
    </View>
  )
}

const BAR = 40

/**
 * Pins `pinned` under a compact bar once the list has scrolled `top` away.
 * The panel translates rather than resizing, so the list never re-lays-out.
 */
function CollapsingHeader({
  scroll,
  title,
  figure,
  top,
  pinned,
  onHeight,
}: {
  scroll: SharedValue<number>
  title: string
  figure: ReactNode
  top: ReactNode
  pinned: ReactNode
  onHeight: (height: number) => void
}) {
  const insets = useSafeAreaInsets()
  const openDrawer = useOpenDrawer()
  const barHeight = insets.top + BAR
  const [topHeight, setTopHeight] = useState(0)
  const collapse = Math.max(1, topHeight - barHeight)

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(scroll.get(), collapse) }],
  }))
  const fading = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.get(), [0, collapse], [1, 0], Extrapolation.CLAMP),
  }))
  const leaving = useAnimatedStyle(() => ({
    opacity: interpolate(
      scroll.get(),
      [collapse * 0.5, collapse * 0.75],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }))
  const arriving = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.get(), [collapse * 0.7, collapse], [0, 1], Extrapolation.CLAMP),
  }))

  return (
    <>
      <Animated.View
        onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
        style={[styles.panel, panel]}
      >
        <Animated.View
          onLayout={(event) => setTopHeight(event.nativeEvent.layout.height)}
          style={fading}
        >
          {top}
        </Animated.View>
        {pinned}
      </Animated.View>
      <View style={[styles.bar, { height: barHeight, paddingTop: insets.top }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          hitSlop={14}
          onPress={openDrawer}
          style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <Bars color={Ghost.accent} />
          <View style={{ justifyContent: "center" }}>
            <Animated.View style={arriving}>
              <Cond size={20}>{title}</Cond>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: "center" }, leaving]}>
              <Mono size={11} color={Ghost.accent}>
                GHOST
              </Mono>
            </Animated.View>
          </View>
        </Pressable>
        <Animated.View style={arriving}>{figure}</Animated.View>
      </View>
    </>
  )
}

export default function VaultScreen() {
  const bottomInset = useBottomInset()
  const vault = useVault()
  const jobs = useJobs()
  const createJob = useCreateJob()
  const setDecision = useSetDecision()
  const { character } = useCharacter()
  const sessionId = useSessionId()
  const filter = useVaultFilter()
  const picked = usePicked()
  const pull = usePullRefresh(vault.refetch)
  const scroll = useSharedValue(0)
  const [headerHeight, setHeaderHeight] = useState(0)

  const items = vault.data?.items ?? []
  const preview = useCleanupPreview(character?.characterId)
  const vaultJunk = items.filter((item) => item.decision === "junk").length
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

  const header = (
    <PageHeader
      title="VAULT"
      subtitle={
        cleanup ? "Cleanup mode" : reviewing ? "Ghost is reviewing" : `${shown.length} shown`
      }
      subtitleColor={cleanup ? Ghost.danger : Ghost.dim}
      figure={vault.data ? count : "—"}
      figureSuffix={vault.data ? `/${capacity}` : undefined}
      caption={vault.data ? `${capacity - count} free` : "Space"}
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
  )

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      {vault.data && !cleanup ? null : header}

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
          <AnimatedLegendList
            style={{ flex: 1 }}
            sharedValues={{ scrollOffset: scroll }}
            data={shown}
            keyExtractor={(item) => item.itemInstanceId ?? `${item.itemHash}`}
            recycleItems
            estimatedItemSize={63}
            extraData={picked}
            keyboardDismissMode="on-drag"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            progressViewOffset={headerHeight}
            scrollIndicatorInsets={{ top: headerHeight }}
            contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: bottomInset + 16 }}
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
          <CollapsingHeader
            scroll={scroll}
            onHeight={setHeaderHeight}
            top={
              <>
                {header}
                <View style={{ marginHorizontal: Gutter, marginTop: 16 }}>
                  <Said size={14}>
                    {reviewing
                      ? "Reviewing your vault for duplicates and weak rolls against current community picks…"
                      : vaultSaid(count, capacity, preview.data?.junk ?? vaultJunk)}
                  </Said>
                </View>
                <CleanupCard name={character ? sentence(character.classType) : "your Guardian"} />
              </>
            }
            pinned={<Filters shown={shown.length} />}
            title="VAULT"
            figure={
              <Cond size={20}>
                {count}
                <Cond size={20} color={Ghost.dim}>
                  /{capacity}
                </Cond>
              </Cond>
            }
          />
          {pickedItems.length > 0 ? (
            <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
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
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 8,
    backgroundColor: Ghost.bg,
  },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Gutter,
    backgroundColor: Ghost.bg,
  },
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
