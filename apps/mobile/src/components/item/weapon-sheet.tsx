import type { ItemSummary, PerkColumn, Purpose, WeaponPerk, WeaponSheet } from "@ghost/contract"
import { Image } from "expo-image"
import { Fragment, type ReactNode, useState } from "react"
import { Pressable, ScrollView, StyleSheet, View, type ViewProps } from "react-native"

import { Body, Button, Cond, Meta, Mono } from "@/components/ghost/ui"
import { ItemActions } from "@/components/item/actions"
import { ItemHeader } from "@/components/item/header"
import { Ghost, Type } from "@/constants/theme"
import { errorMessage, useApplyPerks, useRatePerk, useWeaponSheet } from "@/lib/api"
import { useCharacter } from "@/lib/character"
import { upper } from "@/lib/format"
import { useBottomInset } from "@/lib/insets"
import {
  activeOf,
  canSwap,
  deltasOf,
  goodActive,
  inspectedSwap,
  isRound,
  type PerkRef,
  perkAt,
  poolSize,
  type SheetMode,
  signed,
  type Staged,
  type StatBar,
  statBars,
  type Swap,
  swapsOf,
  toggleStaged,
  VIEWING,
} from "@/lib/weapon-sheet"

const RING = 4
const COLUMN_GAP = 8
const PURPOSES: ReadonlyArray<readonly [Purpose, string]> = [
  ["pve", "PVE"],
  ["pvp", "PVP"],
]
const SOURCE: Record<NonNullable<WeaponPerk["source"]>, string> = {
  player: "Set by you",
  claude: "Rated by Ghost",
  wishlist: "Rated by Wishlist",
  community: "Rated by Community",
}

type TileLook = "active" | "inspected" | "staged" | "replaced" | "locked" | "plain"

type Ring = { borderWidth: number; borderColor?: string; borderStyle?: "dashed" }

const RING_STYLE: Record<TileLook, Ring> = {
  active: { borderWidth: 2, borderColor: Ghost.accent },
  inspected: { borderWidth: 1.5, borderColor: Ghost.ink },
  staged: { borderWidth: 2, borderColor: Ghost.ink },
  replaced: { borderWidth: 1.5, borderColor: Ghost.accent, borderStyle: "dashed" },
  locked: { borderWidth: 0 },
  plain: { borderWidth: 0 },
}

const lookOf = (mode: SheetMode, column: PerkColumn, perk: WeaponPerk, ref: PerkRef): TileLook => {
  if (mode.kind === "view") {
    const inspected = mode.inspected?.column === ref.column && mode.inspected.perk === ref.perk
    return inspected ? "inspected" : perk.active ? "active" : "plain"
  }
  const staged = mode.staged.get(column.socketIndex)
  if (staged === perk.plugHash) return "staged"
  if (perk.active) return staged === undefined ? "active" : "replaced"
  return perk.rolled ? "plain" : "locked"
}

function PerkTile({
  column,
  perk,
  look,
  size,
  onPress,
}: {
  column: PerkColumn
  perk: WeaponPerk
  look: TileLook
  size: number
  onPress: () => void
}) {
  const round = isRound(column)
  const ring = RING_STYLE[look]
  const lit = perk.active || look === "staged" || look === "inspected"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={perk.name}
      accessibilityState={{
        selected: look === "inspected" || look === "staged",
        disabled: look === "locked",
      }}
      disabled={look === "locked"}
      onPress={onPress}
      style={{ alignItems: "center", gap: 5 }}
    >
      <View style={[ring, { padding: RING - ring.borderWidth, borderRadius: round ? size : 5 }]}>
        <View
          style={[
            styles.tile,
            {
              width: size,
              height: size,
              borderRadius: round ? size / 2 : 3,
              borderColor: perk.enhanced
                ? Ghost.gold
                : look === "locked"
                  ? "#5b626d"
                  : Ghost.ruleStrong,
              borderWidth: perk.enhanced ? 1.5 : 1,
              borderStyle: look === "locked" ? "dashed" : "solid",
              opacity: look === "locked" ? 0.35 : lit ? 1 : 0.55,
            },
          ]}
        >
          {perk.icon ? (
            <Image source={perk.icon} style={StyleSheet.absoluteFill} transition={120} />
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 2 }}>
        {PURPOSES.map(([purpose]) => (
          <View
            key={purpose}
            style={[
              styles.ratingBar,
              { width: (size - 2) / 2 },
              perk.good.includes(purpose) && { backgroundColor: Ghost.good },
            ]}
          />
        ))}
      </View>
    </Pressable>
  )
}

function Matrix({
  sheet,
  mode,
  onTap,
  inspector,
}: {
  sheet: WeaponSheet
  mode: SheetMode
  onTap: (ref: PerkRef) => void
  inspector: ReactNode
}) {
  const size = sheet.columns.length > 5 ? 42 : 52
  const rows = Math.max(0, ...sheet.columns.map((column) => column.perks.length))
  const inspectedRow = mode.kind === "view" ? mode.inspected?.perk : undefined
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.matrixRow}>
        {sheet.columns.map((column) => (
          <Mono key={column.socketIndex} size={10} style={styles.columnLabel} lines={1}>
            {column.label}
          </Mono>
        ))}
      </View>
      {Array.from({ length: rows }, (_, p) => (
        <Fragment key={p}>
          <View style={styles.matrixRow}>
            {sheet.columns.map((column, c) => {
              const perk = column.perks[p]
              const ref = { column: c, perk: p }
              return (
                <View key={column.socketIndex} style={styles.cell}>
                  {perk ? (
                    <PerkTile
                      column={column}
                      perk={perk}
                      look={lookOf(mode, column, perk, ref)}
                      size={size}
                      onPress={() => onTap(ref)}
                    />
                  ) : null}
                </View>
              )
            })}
          </View>
          {inspectedRow === p ? inspector : null}
        </Fragment>
      ))}
    </View>
  )
}

function DeltaChips({ swaps }: { swaps: ReadonlyArray<Swap> }) {
  const deltas = deltasOf(swaps)
  if (deltas.length === 0) return <Mono size={12}>No stat change</Mono>
  return deltas.map(({ stat, value }) => (
    <View key={stat} style={styles.deltaChip}>
      <Mono size={12} color={value > 0 ? Ghost.good : Ghost.danger}>
        {`${stat} ${signed(value)}`}
      </Mono>
    </View>
  ))
}

function Inspector({ itemId, sheet, at }: { itemId: string; sheet: WeaponSheet; at: PerkRef }) {
  const rate = useRatePerk(itemId)
  const [width, setWidth] = useState(0)
  const column = sheet.columns[at.column]
  const perk = perkAt(sheet, at)
  if (column === undefined || perk === undefined) return null
  const active = activeOf(column)
  const swaps = inspectedSwap(sheet, at)
  const columnWidth = (width - COLUMN_GAP * (sheet.columns.length - 1)) / sheet.columns.length
  const caret = at.column * (columnWidth + COLUMN_GAP) + columnWidth / 2 - 6
  const where = perk.active ? "ON THIS COPY" : perk.rolled ? "ROLLED ON THIS COPY" : "IN THE POOL"
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ marginTop: 4, marginBottom: 6 }}
    >
      {width > 0 ? <View style={[styles.caret, { left: caret }]} /> : null}
      <View style={styles.inspector}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={[styles.inspectorIcon, { borderRadius: isRound(column) ? 16 : 3 }]}>
            {perk.icon ? <Image source={perk.icon} style={StyleSheet.absoluteFill} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Body size={16} style={{ fontFamily: Type.bodyMedium, lineHeight: 20 }}>
              {perk.name}
            </Body>
            <Mono size={10}>{`${column.label} · ${where}`}</Mono>
          </View>
        </View>
        <Body size={14} color={Ghost.soft} style={{ lineHeight: 19 }}>
          {perk.description.trim()}
        </Body>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PURPOSES.map(([purpose, label]) => {
            const good = perk.good.includes(purpose)
            return (
              <Pressable
                key={purpose}
                accessibilityRole="switch"
                accessibilityLabel={`${perk.name} good for ${label}`}
                accessibilityState={{ checked: good }}
                disabled={rate.isPending}
                onPress={() =>
                  rate.mutate({ perk: perk.name, purpose, rating: good ? "ok" : "good" })
                }
                style={({ pressed }) => [
                  styles.toggle,
                  good && { backgroundColor: Ghost.good, borderColor: Ghost.good },
                  (pressed || rate.isPending) && { opacity: 0.6 },
                ]}
              >
                <View style={[styles.box, { borderColor: good ? Ghost.bg : Ghost.dim }]}>
                  {good ? (
                    <Cond size={11} color={Ghost.bg} style={{ lineHeight: 12 }}>
                      ✓
                    </Cond>
                  ) : null}
                </View>
                <Cond size={15} color={good ? Ghost.bg : Ghost.dim}>
                  {`GOOD FOR ${label}`}
                </Cond>
              </Pressable>
            )
          })}
        </View>
        <Meta color={rate.isError ? Ghost.danger : Ghost.dim}>
          {rate.isError
            ? errorMessage(rate.error)
            : `${perk.source === null ? "Unrated" : SOURCE[perk.source]} · tap to change. Cleanup keeps your best PvE and PvP copy.`}
        </Meta>
        {perk.active || active === undefined ? null : (
          <View style={styles.versus}>
            <Meta>{`vs ${active.name}`}</Meta>
            <DeltaChips swaps={swaps} />
          </View>
        )}
      </View>
    </View>
  )
}

function Legend({ items }: { items: ReadonlyArray<readonly [string, ViewProps["style"]]> }) {
  return (
    <View style={styles.legend}>
      {items.map(([label, swatch]) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={[{ width: 12, height: 12 }, swatch]} />
          <Meta>{label}</Meta>
        </View>
      ))}
    </View>
  )
}

function StatRows({ bars }: { bars: ReadonlyArray<StatBar> }) {
  return (
    <View style={{ gap: 9 }}>
      {bars.map((bar) => (
        <View key={bar.name} style={styles.statRow}>
          <Meta size={14} color={Ghost.muted} style={{ width: 96 }} lines={1}>
            {bar.name}
          </Meta>
          <View style={styles.track}>
            <View
              style={[
                styles.segment,
                { left: 0, width: `${bar.base}%`, backgroundColor: Ghost.dim },
              ]}
            />
            <View
              style={[
                styles.segment,
                { left: `${bar.base}%`, width: `${bar.perks}%`, backgroundColor: Ghost.accent },
              ]}
            />
            <View
              style={[
                styles.segment,
                {
                  left: `${Math.min(bar.total, 100)}%`,
                  width: `${bar.gain}%`,
                  backgroundColor: Ghost.good,
                },
              ]}
            />
            <View
              style={[
                styles.segment,
                {
                  left: `${Math.min(bar.total, 100) - bar.loss}%`,
                  width: `${bar.loss}%`,
                  backgroundColor: Ghost.danger,
                },
              ]}
            />
          </View>
          <Mono size={13} color={Ghost.ink} style={{ width: 64, textAlign: "right" }}>
            {bar.total}
            {bar.delta === 0 ? null : (
              <Mono size={13} color={bar.delta > 0 ? Ghost.good : Ghost.danger}>
                {` ${signed(bar.delta)}`}
              </Mono>
            )}
          </Mono>
        </View>
      ))}
    </View>
  )
}

function Stats({
  sheet,
  swaps,
  heading,
}: {
  sheet: WeaponSheet
  swaps: ReadonlyArray<Swap>
  heading: string
}) {
  const counts = sheet.stats.filter((stat) => !stat.bar)
  return (
    <View style={styles.section}>
      <Mono>{heading}</Mono>
      <StatRows bars={statBars(sheet, swaps)} />
      <Legend
        items={[
          ["Base", { height: 6, backgroundColor: Ghost.dim }],
          ["Perks on this copy", { height: 6, backgroundColor: Ghost.accent }],
        ]}
      />
      {counts.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, columnGap: 24 }}>
          {counts.map((stat) => (
            <Mono key={stat.name} size={13} color={Ghost.ink}>
              {stat.value}
              <Mono size={13}>{` ${upper(stat.name)}`}</Mono>
            </Mono>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Summary({ sheet }: { sheet: WeaponSheet }) {
  return (
    <View style={{ flexDirection: "row", gap: 18, paddingHorizontal: 20, marginTop: -6 }}>
      {PURPOSES.map(([purpose, label]) => {
        const { good, of } = goodActive(sheet, purpose)
        return (
          <View key={purpose} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={[
                styles.badge,
                good === 0 && { backgroundColor: "transparent", borderColor: Ghost.ruleStrong },
              ]}
            >
              <Cond size={12} color={good === 0 ? Ghost.dim : Ghost.bg}>
                {label}
              </Cond>
            </View>
            <Meta>{`${good} of ${of} perks good`}</Meta>
          </View>
        )
      })}
    </View>
  )
}

function ApplyBar({
  item,
  sheet,
  staged,
  onClear,
  onDone,
}: {
  item: ItemSummary & { itemInstanceId: string }
  sheet: WeaponSheet
  staged: Staged
  onClear: () => void
  onDone: () => void
}) {
  const bottomInset = useBottomInset()
  const { character } = useCharacter()
  const apply = useApplyPerks(item.itemInstanceId)
  const swaps = swapsOf(sheet, staged)
  const carried = item.location === "character"
  const failed = apply.data?.plan?.rows.find((row) => row.outcome === "failed")?.error
  const count = `${swaps.length} CHANGE${swaps.length === 1 ? "" : "S"} STAGED`
  const moves =
    carried || character === undefined ? "" : ` · MOVES TO ${upper(character.classType)} FIRST`
  return (
    <View style={[styles.applyBar, { paddingBottom: bottomInset + 12 }]}>
      <View style={{ gap: 4 }}>
        <Mono color={Ghost.ink}>{swaps.length === 0 ? "NOTHING STAGED" : `${count}${moves}`}</Mono>
        {swaps.map((swap) => (
          <Body
            key={swap.column.socketIndex}
            size={14}
            color={Ghost.muted}
            style={{ lineHeight: 19 }}
          >
            <Body size={14} color={Ghost.dim}>{`${swap.column.label} · `}</Body>
            {swap.from.name}
            <Body size={14} color={Ghost.accent}>
              {" › "}
            </Body>
            <Body size={14} color={Ghost.ink}>
              {swap.to.name}
            </Body>
          </Body>
        ))}
        {apply.isError || failed ? (
          <Meta color={Ghost.danger}>{apply.isError ? errorMessage(apply.error) : failed}</Meta>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button label="CLEAR" under="#16191e" disabled={swaps.length === 0} onPress={onClear} />
        <Button
          label={
            apply.isPending
              ? "APPLYING…"
              : `APPLY ${swaps.length} PERK${swaps.length === 1 ? "" : "S"}`
          }
          tone="accent"
          flex={1.4}
          under="#16191e"
          disabled={swaps.length === 0 || apply.isPending || (!carried && character === undefined)}
          onPress={() => {
            const [first, ...rest] = swaps.map((swap) => ({
              socketIndex: swap.column.socketIndex,
              plugHash: swap.to.plugHash,
            }))
            const characterId = item.characterId ?? character?.characterId
            if (first === undefined || characterId === undefined) return
            apply.mutate(
              { characterId, plugs: [first, ...rest] },
              {
                onSuccess: (job) => {
                  if (!job.plan?.rows.some((row) => row.outcome === "failed")) onDone()
                },
              },
            )
          }}
        />
      </View>
    </View>
  )
}

/** A weapon's sheet: every perk it can roll, laid out like the in-game roll, with its stats. */
export function WeaponScreen({ item }: { item: ItemSummary & { itemInstanceId: string } }) {
  const bottomInset = useBottomInset()
  const sheet = useWeaponSheet(item.itemInstanceId)
  const [mode, setMode] = useState<SheetMode>(VIEWING)
  const data = sheet.data
  const applying = mode.kind === "apply"

  const tap = (ref: PerkRef) => {
    if (!data) return
    if (mode.kind === "view") {
      const same = mode.inspected?.column === ref.column && mode.inspected.perk === ref.perk
      setMode({ kind: "view", inspected: same ? null : ref })
      return
    }
    const column = data.columns[ref.column]
    const perk = perkAt(data, ref)
    if (column && perk) setMode({ kind: "apply", staged: toggleStaged(mode.staged, column, perk) })
  }

  const swaps = !data
    ? []
    : mode.kind === "apply"
      ? swapsOf(data, mode.staged)
      : mode.inspected
        ? inspectedSwap(data, mode.inspected)
        : []

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 28,
          paddingBottom: applying ? 220 + bottomInset : bottomInset + 20,
          gap: 22,
        }}
      >
        <ItemHeader item={item} size={72} />
        {data && !applying ? <Summary sheet={data} /> : null}
        <View style={styles.section}>
          <View style={styles.perksHeading}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Mono>PERKS</Mono>
              {applying ? (
                <View style={styles.modeTag}>
                  <Mono size={10} color={Ghost.bg}>
                    APPLY MODE
                  </Mono>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {data && !applying ? <Meta>{`${poolSize(data)} in the pool`}</Meta> : null}
              {data && (applying || canSwap(data)) ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setMode(applying ? VIEWING : { kind: "apply", staged: new Map() })}
                  style={{ paddingVertical: 10, paddingLeft: 4 }}
                >
                  <Cond size={14} color={Ghost.accent} style={{ letterSpacing: 1.4 }}>
                    {applying ? "DONE" : "EDIT PERKS"}
                  </Cond>
                </Pressable>
              ) : null}
            </View>
          </View>
          {applying ? (
            <Meta>Tap a perk to stage it. Nothing changes on the weapon until you apply.</Meta>
          ) : null}
          {sheet.isError ? (
            <Meta color={Ghost.danger}>{errorMessage(sheet.error)}</Meta>
          ) : !data ? (
            <Meta color={Ghost.dim}>Loading…</Meta>
          ) : (
            <>
              <Matrix
                sheet={data}
                mode={mode}
                onTap={tap}
                inspector={
                  mode.kind === "view" && mode.inspected ? (
                    <Inspector itemId={item.itemInstanceId} sheet={data} at={mode.inspected} />
                  ) : null
                }
              />
              <Legend
                items={
                  applying
                    ? [
                        ["On this copy", { borderWidth: 1.5, borderColor: Ghost.accent }],
                        ["Staged", { borderWidth: 1.5, borderColor: Ghost.ink }],
                        [
                          "Can't be applied to this copy",
                          { borderWidth: 1, borderColor: "#5b626d", borderStyle: "dashed" },
                        ],
                      ]
                    : [
                        ["On this copy", { borderWidth: 1.5, borderColor: Ghost.accent }],
                        ["Enhanced", { borderWidth: 1.5, borderColor: Ghost.gold }],
                        [
                          "Good for PvE · PvP",
                          { height: 3, width: 14, backgroundColor: Ghost.good },
                        ],
                      ]
                }
              />
            </>
          )}
        </View>
        {data && data.stats.length > 0 ? (
          <Stats sheet={data} swaps={swaps} heading={applying ? "STATS AFTER APPLYING" : "STATS"} />
        ) : null}
        {applying ? null : <ItemActions item={item} />}
      </ScrollView>
      {data && mode.kind === "apply" ? (
        <ApplyBar
          item={item}
          sheet={data}
          staged={mode.staged}
          onClear={() => setMode({ kind: "apply", staged: new Map() })}
          onDone={() => setMode(VIEWING)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, gap: 12 },
  perksHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modeTag: { paddingVertical: 2, paddingHorizontal: 6, backgroundColor: Ghost.accent },
  matrixRow: { flexDirection: "row", gap: COLUMN_GAP },
  cell: { flex: 1, minWidth: 0, alignItems: "center" },
  columnLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
    letterSpacing: 1,
  },
  tile: { overflow: "hidden", backgroundColor: Ghost.swatch },
  ratingBar: { height: 3, backgroundColor: Ghost.ruleStrong },
  caret: {
    position: "absolute",
    top: -6,
    width: 12,
    height: 12,
    zIndex: 1,
    backgroundColor: "#1d2128",
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: "#3a414c",
    transform: [{ rotate: "45deg" }],
  },
  inspector: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
    backgroundColor: "#1d2128",
    borderWidth: 1,
    borderColor: "#3a414c",
  },
  inspectorIcon: {
    width: 32,
    height: 32,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
    backgroundColor: Ghost.swatch,
  },
  toggle: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
  },
  box: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  versus: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.ruleStrong,
  },
  deltaChip: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
  },
  legend: { flexDirection: "row", flexWrap: "wrap", rowGap: 6, columnGap: 16 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { flex: 1, height: 6, backgroundColor: Ghost.rule },
  segment: { position: "absolute", top: 0, bottom: 0 },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Ghost.good,
    backgroundColor: Ghost.good,
  },
  applyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 12,
    backgroundColor: "#16191e",
    borderTopWidth: 1,
    borderTopColor: Ghost.ruleStrong,
  },
})
