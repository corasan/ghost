import type { ItemSummary } from "@ghost/contract"
import { useMemo, useState } from "react"
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native"
import { Unavailable } from "@/components/link-bungie"
import { Body, Button, Chip, GhostBanner, Header, Loading, Mono, Swatch } from "@/components/ui"
import { useCreateJob, useJobs, useVault } from "@/lib/api"
import { upper } from "@/lib/format"
import { colors } from "@/theme"

type Filter = "all" | "weapons" | "armor"
const WEAPON_SLOTS = new Set(["kinetic", "energy", "power"])
const ARMOR_SLOTS = new Set(["helmet", "arms", "chest", "legs", "class"])

// 04 · Vault tab. Browse the vault as a list; "Cleanup" asks Ghost to flag
// what can go and shows its answer above the list.
export default function VaultScreen() {
  const vault = useVault()
  const jobs = useJobs()
  const createJob = useCreateJob()
  const [filter, setFilter] = useState<Filter>("all")
  const [cleanup, setCleanup] = useState(false)

  const cleanupJob = jobs.data
    ?.filter((j) => j.kind === "vault_cleanup")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const cleanupBusy = cleanupJob?.status === "queued" || cleanupJob?.status === "running"

  const items = useMemo(() => {
    const all = vault.data?.items ?? []
    if (filter === "weapons") return all.filter((i) => WEAPON_SLOTS.has(i.slot))
    if (filter === "armor") return all.filter((i) => ARMOR_SLOTS.has(i.slot))
    return all
  }, [vault.data, filter])

  if (vault.isPending) return <Loading label="Opening the vault" />
  if (vault.isError) return <Unavailable error={vault.error} onRetry={vault.refetch} />

  const { count, capacity } = vault.data
  const fill = Math.min(1, count / capacity)
  const barColor = cleanup || fill > 0.9 ? colors.red : colors.accent

  const askCleanup = () =>
    createJob.mutate({
      kind: "vault_cleanup",
      prompt:
        "Review my vault. Flag duplicates where I own a better copy and weapons or armor with low rolls. List each flagged item with a one-line reason. Do not dismantle or move anything.",
    })

  return (
    <View style={{ flex: 1 }}>
      <Header
        eyebrow={cleanup ? "CLEANUP MODE" : "BROWSE"}
        eyebrowColor={cleanup ? colors.red : colors.dim}
        title="Vault"
        onPressEyebrow={() => setCleanup((v) => !v)}
        right={
          <Mono size={11} style={{ paddingBottom: 4 }}>
            {count}
            <Mono size={11} color={colors.muted}>
              /{capacity}
            </Mono>
          </Mono>
        }
      />
      <View style={styles.bar}>
        <View style={{ width: `${fill * 100}%`, height: "100%", backgroundColor: barColor }} />
      </View>

      {cleanup ? (
        <GhostBanner style={{ marginHorizontal: 20, marginTop: 14 }}>
          {cleanupBusy
            ? "Looking through the vault for duplicates and low rolls…"
            : cleanupJob?.status === "done"
              ? (cleanupJob.result ?? "Nothing to flag.")
              : cleanupJob?.status === "failed"
                ? `Ghost could not review the vault: ${cleanupJob.error ?? "unknown error"}`
                : "Ask Ghost to flag duplicates with a better copy and low-scoring rolls. Nothing is dismantled without a second confirm."}
        </GhostBanner>
      ) : null}

      <View style={styles.chips}>
        {(
          [
            ["all", `All · ${vault.data.items.length}`],
            ["weapons", "Weapons"],
            ["armor", "Armor"],
          ] as const
        ).map(([key, label]) => (
          <Chip key={key} label={label} active={filter === key} onPress={() => setFilter(key)} />
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item, index) => item.itemInstanceId ?? `${item.itemHash}-${index}`}
        renderItem={({ item }) => <VaultRow item={item} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}
        onRefresh={() => void vault.refetch()}
        refreshing={vault.isRefetching}
        ListEmptyComponent={
          <Body size={13} color={colors.dim} style={{ paddingVertical: 24, textAlign: "center" }}>
            Nothing here.
          </Body>
        }
      />

      {cleanup ? (
        <View style={styles.actions}>
          <Button label="Exit cleanup" onPress={() => setCleanup(false)} />
          <Button
            label={cleanupJob?.status === "done" ? "Ask again" : "Ask Ghost to flag"}
            tone="danger"
            flex={1.3}
            onPress={askCleanup}
            busy={createJob.isPending || cleanupBusy}
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Cleanup" onPress={() => setCleanup(true)} />
        </View>
      )}
    </View>
  )
}

function VaultRow({ item }: { item: ItemSummary }) {
  const meta = [
    upper(item.typeName || item.slot),
    item.tier !== "unknown" ? upper(item.tier) : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <Pressable style={styles.row}>
      <Swatch item={item} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body weight="medium" numberOfLines={1}>
          {item.name}
          {item.quantity > 1 ? <Text style={{ color: colors.dim }}> ×{item.quantity}</Text> : null}
        </Body>
        <Mono size={9} tracking={0.8} style={{ marginTop: 2 }}>
          {meta}
        </Mono>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Mono size={12} color={colors.power} tracking={0}>
          {item.power ?? ""}
        </Mono>
        {item.damageType !== "none" && item.damageType !== "kinetic" ? (
          <Mono size={9} color={colors.muted} style={{ marginTop: 4 }}>
            {upper(item.damageType)}
          </Mono>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { marginHorizontal: 20, marginTop: 14, height: 2, backgroundColor: colors.surface },
  chips: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6, flexDirection: "row", gap: 6 },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  actions: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "row",
    gap: 8,
  },
})
