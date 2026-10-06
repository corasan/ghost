import type {
  AbilityKind,
  ArmorMod,
  Job,
  LoadoutPlug,
  Plan,
  SubclassLoadout,
  PlanRow,
  SetBonus,
} from "@ghost/contract"
import { Image } from "expo-image"
import { router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"

import { BuildHeader, ModPips } from "@/components/chat/build-card"
import { BuildStats } from "@/components/chat/build-stats"
import { RowRight } from "@/components/chat/plan-block"
import { ChargeNote, ChargeTag, Situational } from "@/components/ghost/charge"
import { ItemIcon } from "@/components/ghost/item-icon"
import { PlugIcon } from "@/components/ghost/plug-icon"
import { SetBonusText } from "@/components/ghost/set-bonus"
import { SubclassBanner } from "@/components/ghost/subclass-banner"
import { Body, Button, Chevron, Mono } from "@/components/ghost/ui"
import { Ghost, Gutter, Type } from "@/constants/theme"
import { errorMessage, useApplyPlan, useJob } from "@/lib/api"
import { chargedMods } from "@/lib/charge"
import { firstSentence } from "@/lib/effect-text"
import { useFooterHeight } from "@/lib/footer"
import {
  bySlot,
  modPips,
  pendingMasterwork,
  signed,
  type SynergyPart,
  synergyParts,
} from "@/lib/plan-card"
import { usePlanSelection } from "@/lib/selection"
import { useBottomInset } from "@/lib/insets"

const replacing = (plug: LoadoutPlug) =>
  plug.swap && plug.replaces ? `Replaces ${plug.replaces}` : null

function Described({ plug, kind }: { plug: LoadoutPlug; kind?: string }) {
  const line = [kind, replacing(plug), firstSentence(plug.description)].filter(Boolean).join(" · ")
  return (
    <View style={[styles.entry, styles.plug, { alignItems: "flex-start" }]}>
      <PlugIcon icon={plug.icon} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body
          size={14}
          color={plug.swap ? Ghost.accent : Ghost.ink}
          style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }}
        >
          {plug.name}
        </Body>
        {line ? (
          <Body size={11} color={Ghost.dim} style={{ lineHeight: 15, marginTop: 1 }} lines={2}>
            {line}
          </Body>
        ) : null}
      </View>
      {plug.swap ? <Mono color={Ghost.accent}>SWAP</Mono> : null}
    </View>
  )
}

const ABILITY_LABEL: Record<AbilityKind, string> = {
  class: "CLASS",
  jump: "JUMP",
  melee: "MELEE",
  grenade: "GRENADE",
}

function Loadout({ loadout }: { loadout: SubclassLoadout }) {
  const [open, setOpen] = useState(false)
  return (
    <SubclassBanner
      loadout={loadout}
      chevron={open ? "up" : "down"}
      hint="Shows the super, abilities, aspects and fragments"
      expanded={open}
      onPress={() => setOpen((was) => !was)}
    >
      {open ? (
        <View style={styles.loadoutBody}>
          {loadout.super ? <Described plug={loadout.super} kind="Super" /> : null}
          {(loadout.abilities ?? []).map((ability) => (
            <View key={ability.kind} style={[styles.entry, styles.plug]}>
              <PlugIcon icon={ability.icon} size={22} />
              <Body
                size={13}
                color={ability.swap ? Ghost.accent : Ghost.soft}
                style={{ flex: 1, lineHeight: 17 }}
              >
                {ability.name}
              </Body>
              <Mono size={10} color={ability.swap ? Ghost.accent : Ghost.dim}>
                {ability.swap
                  ? `SWAP · ${ABILITY_LABEL[ability.kind]}`
                  : ABILITY_LABEL[ability.kind]}
              </Mono>
            </View>
          ))}
          {loadout.aspects.map((aspect) => (
            <Described key={aspect.name} plug={aspect} />
          ))}
          {loadout.fragments.map((fragment) => (
            <View key={fragment.name} style={[styles.entry, styles.plug]}>
              <PlugIcon icon={fragment.icon} size={22} />
              <Body
                size={13}
                color={fragment.swap ? Ghost.accent : Ghost.soft}
                style={{ flex: 1, lineHeight: 17 }}
              >
                {fragment.name}
              </Body>
              {fragment.mods.length === 0 ? (
                <Mono size={10}>—</Mono>
              ) : (
                fragment.mods.map((mod) => (
                  <Mono key={mod.label} size={10} color={mod.delta > 0 ? Ghost.good : Ghost.danger}>
                    {signed(mod.delta)} {mod.label}
                  </Mono>
                ))
              )}
            </View>
          ))}
        </View>
      ) : null}
    </SubclassBanner>
  )
}

function ModLine({ mod, copies }: { mod: ArmorMod; copies: number }) {
  const [open, setOpen] = useState(false)
  const effect = [
    mod.swap && mod.replaces ? `Replaces ${mod.replaces}` : null,
    firstSentence(mod.description),
  ]
    .filter(Boolean)
    .join(" · ")
  const body = (
    <>
      {mod.icon ? <Image source={mod.icon} style={styles.modIcon} transition={120} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body
          size={13}
          color={mod.swap ? Ghost.accent : Ghost.ink}
          style={{ fontFamily: Type.bodyMedium, lineHeight: 16 }}
        >
          {mod.name}
        </Body>
        {effect ? (
          <Body size={11} color={Ghost.dim} style={{ lineHeight: 14, marginTop: 1 }}>
            {effect}
          </Body>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Mono color={mod.swap ? Ghost.accent : Ghost.dim} style={{ letterSpacing: 0.7 }}>
          {mod.swap ? `SWAP · ${mod.cost}` : mod.cost}
        </Mono>
        {mod.charged ? <ChargeTag /> : null}
      </View>
    </>
  )
  if (!mod.charged) return <View style={[styles.mod, styles.modHead]}>{body}</View>
  return (
    <View style={styles.mod}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Shows what the mod adds with Armor Charge"
        onPress={() => setOpen((was) => !was)}
        style={({ pressed }) => [styles.modHead, pressed && { opacity: 0.6 }]}
      >
        {body}
      </Pressable>
      {open ? <ChargeNote mod={mod} copies={copies} /> : null}
    </View>
  )
}

function Mods({ row, copies }: { row: PlanRow; copies: ReadonlyMap<string, number> }) {
  const mods = row.armorMods
  if (mods === undefined) return null
  const free = row.freeModSlots ?? 0
  return (
    <View>
      <View style={styles.modsHead}>
        <Mono size={8}>MODS</Mono>
        {row.energy ? (
          <Mono size={8}>
            ENERGY {row.energy.used}/{row.energy.capacity}
          </Mono>
        ) : null}
      </View>
      {mods.map((mod, i) => (
        <ModLine key={`${mod.name}${i}`} mod={mod} copies={copies.get(mod.name) ?? 1} />
      ))}
      {free > 0 ? (
        <View style={[styles.mod, styles.modHead]}>
          <Body size={13} color={Ghost.dim} style={{ lineHeight: 16 }}>
            {free} {free === 1 ? "slot free" : "slots free"}
          </Body>
        </View>
      ) : null}
    </View>
  )
}

function Piece({
  row,
  copies,
  applied,
  open,
  onToggle,
}: {
  row: PlanRow
  copies: ReadonlyMap<string, number>
  applied: boolean
  open: boolean
  onToggle: () => void
}) {
  const stats = row.stats ?? []
  const now = stats.reduce((sum, stat) => sum + stat.value, 0)
  const then = stats.reduce((sum, stat) => sum + (stat.masterworked ?? stat.value), 0)
  const pips = modPips(row)
  return (
    <View style={styles.piece}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Shows stats and mods"
        onPress={onToggle}
        style={({ pressed }) => [styles.pieceHead, pressed && { opacity: 0.6 }]}
      >
        <ItemIcon
          icon={row.icon}
          size={48}
          element={row.damageType}
          gearTier={row.gearTier}
          masterwork={row.masterwork}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body size={15} style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }} lines={1}>
            {row.name}
          </Body>
          <Mono style={{ marginTop: 3, letterSpacing: 0.7 }} lines={1}>
            {row.error ?? row.meta}
          </Mono>
          {then > now ? (
            <Mono color={Ghost.gold} style={{ marginTop: 3, letterSpacing: 0.7 }}>
              {now} → {then} MASTERWORKED
            </Mono>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <RowRight row={row} applied={applied} />
          {pips ? <ModPips pips={pips} /> : null}
        </View>
        <Chevron direction={open ? "up" : "down"} size={6} />
      </Pressable>
      {open ? (
        <View style={styles.pieceBody}>
          {stats.length > 0 ? (
            <View style={{ flexDirection: "row", gap: 6 }}>
              {stats.map((stat) => (
                <View key={stat.label} style={{ flex: 1 }}>
                  <Mono
                    size={12}
                    color={
                      stat.masterworked !== undefined
                        ? Ghost.gold
                        : stat.value > 0
                          ? Ghost.ink
                          : Ghost.dim
                    }
                    style={{ letterSpacing: 0 }}
                  >
                    {stat.value}
                  </Mono>
                  <Mono size={7} style={{ marginTop: 3 }} lines={1}>
                    {stat.label}
                  </Mono>
                </View>
              ))}
            </View>
          ) : null}
          <Mods row={row} copies={copies} />
        </View>
      ) : null}
    </View>
  )
}

const SYNERGY_LABEL: Record<SynergyPart["kind"], string> = {
  exotic: "EXOTIC",
  setBonuses: "SET BONUS",
  mods: "MODS",
}

function Prose({ text }: { text: string | undefined }) {
  if (!text) return null
  return (
    <Body size={14} color={Ghost.soft} style={{ lineHeight: 20 }}>
      {text}
    </Body>
  )
}

function BonusRow({ bonus, offBuild = false }: { bonus: SetBonus; offBuild?: boolean }) {
  return (
    <View style={[styles.plug, styles.bonus]}>
      <PlugIcon icon={bonus.icon} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <SetBonusText bonus={bonus} />
      </View>
      {offBuild ? (
        <Mono size={8} color={Ghost.gold} style={{ letterSpacing: 1, marginTop: 4 }}>
          OFF-BUILD
        </Mono>
      ) : null}
    </View>
  )
}

function SynergyPartView({ part }: { part: SynergyPart }) {
  switch (part.kind) {
    case "exotic":
      return (
        <>
          <View style={styles.plug}>
            <ItemIcon icon={part.row.icon} size={36} gearTier={part.row.gearTier} />
            <Body size={14} style={{ flex: 1, fontFamily: Type.bodyMedium, lineHeight: 18 }}>
              {part.row.name}
            </Body>
          </View>
          <Prose text={part.text} />
        </>
      )
    case "setBonuses":
      return (
        <>
          {part.on.map(({ bonus, offBuild }) => (
            <BonusRow key={`${bonus.set}${bonus.name}`} bonus={bonus} offBuild={offBuild} />
          ))}
          {part.short.length > 0 ? (
            <View style={[styles.short, part.on.length > 0 && { marginTop: 4 }]}>
              <Mono size={8} style={{ letterSpacing: 1 }}>
                ONE PIECE AWAY
              </Mono>
              {part.short.map((bonus) => (
                <BonusRow key={`${bonus.set}${bonus.name}`} bonus={bonus} />
              ))}
            </View>
          ) : null}
          <Prose text={part.text} />
        </>
      )
    case "mods":
      return <Prose text={part.text} />
  }
}

/** How the exotic, the set bonuses and the mods play into the build. */
function Synergy({ parts }: { parts: readonly SynergyPart[] }) {
  return (
    <View>
      <Mono style={styles.label}>SYNERGY</Mono>
      {parts.map((part) => (
        <View key={part.kind} style={styles.synergyPart}>
          <Mono size={8} style={{ letterSpacing: 1 }}>
            {SYNERGY_LABEL[part.kind]}
          </Mono>
          <SynergyPartView part={part} />
        </View>
      ))}
    </View>
  )
}

function Confirm({ job, plan, inset }: { job: Job; plan: Plan; inset: number }) {
  const selection = usePlanSelection(job.id, plan)
  const apply = useApplyPlan()
  const selected = [...selection.selected]
  if (plan.status !== "proposed" || selection.actionableCount === 0) return null
  return (
    <View style={[styles.footer, { paddingBottom: inset + 12 }]}>
      {apply.isError ? (
        <Body size={13} color={Ghost.danger}>
          {errorMessage(apply.error)}
        </Body>
      ) : null}
      <View style={{ flexDirection: "row" }}>
        <Button
          label={apply.isPending ? "WORKING…" : plan.confirmLabel.toUpperCase()}
          tone="solid"
          under={Ghost.panel}
          disabled={selected.length === 0 || apply.isPending}
          onPress={() =>
            apply.mutate({ jobId: job.id, selected }, { onSuccess: () => router.back() })
          }
        />
      </View>
    </View>
  )
}

/**
 * The build card unfolded in the same order: what each part of the subclass
 * does, the stats now, with the build and masterworked, every piece by name,
 * and how the exotic, set bonuses and mods play together.
 */
export default function PlanDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const bottomInset = useBottomInset()
  const job = useJob(id)
  const [openId, setOpenId] = useState<string>()
  const footer = useFooterHeight()
  const plan = job.data?.plan

  if (!job.data || !plan) {
    return (
      <Body color={job.isError ? Ghost.danger : Ghost.dim} style={{ padding: 20, paddingTop: 32 }}>
        {job.isError ? `Couldn't load this build: ${errorMessage(job.error)}` : "Loading…"}
      </Body>
    )
  }

  const applied = plan.status !== "proposed"
  const pending = pendingMasterwork(plan)
  const loadout = plan.loadout
  const pieces = bySlot(plan.rows)
  const charged = chargedMods(plan.rows.flatMap((row) => row.armorMods ?? []))
  const copies = new Map(charged.map((entry) => [entry.mod.name, entry.copies]))
  const synergy = synergyParts(plan)

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: footer.height + 28 }]}>
        <BuildHeader
          plan={plan}
          eyebrowSize={10}
          eyebrow={[loadout?.classType, loadout?.subclass, loadout?.element]
            .filter((part) => part && part !== "none")
            .join(" · ")
            .toUpperCase()}
        />
        {loadout ? (
          <View style={styles.section}>
            <Loadout loadout={loadout} />
          </View>
        ) : null}
        <View style={styles.section}>
          <BuildStats stats={plan.stats} />
        </View>
        <View style={styles.section}>
          <View style={[styles.label, { flexDirection: "row", justifyContent: "space-between" }]}>
            <Mono>PIECES</Mono>
            {pending > 0 ? <Mono color={Ghost.gold}>{pending} NOT MASTERWORKED</Mono> : null}
          </View>
          {pieces.map((row) => (
            <Piece
              key={row.itemInstanceId}
              row={row}
              copies={copies}
              applied={applied}
              open={openId === row.itemInstanceId}
              onToggle={() =>
                setOpenId((current) =>
                  current === row.itemInstanceId ? undefined : row.itemInstanceId,
                )
              }
            />
          ))}
        </View>
        {plan.note ? (
          <Body size={13} color={Ghost.muted} style={{ lineHeight: 18, marginTop: 14 }}>
            {plan.note}
          </Body>
        ) : null}
        {plan.situational || charged.length > 0 ? (
          <View style={[styles.section, { marginTop: 24 }]}>
            <Situational summary={plan.situational} mods={charged} />
          </View>
        ) : null}
        {synergy.length > 0 ? (
          <View style={[styles.section, { marginTop: 24 }]}>
            <Synergy parts={synergy} />
          </View>
        ) : null}
      </ScrollView>
      <View collapsable={false} onLayout={footer.onLayout} style={styles.footerSlot}>
        <Confirm job={job.data} plan={plan} inset={bottomInset} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 28 },
  footerSlot: { position: "absolute", left: 0, right: 0, bottom: 0 },
  section: { marginTop: 18 },
  label: { paddingBottom: 6 },
  entry: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: Ghost.rule },
  plug: { flexDirection: "row", alignItems: "center", gap: 10 },
  loadoutBody: { paddingHorizontal: 14, paddingBottom: 8 },
  piece: { borderTopWidth: 1, borderTopColor: Ghost.rule },
  pieceHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  pieceBody: { paddingLeft: 60, paddingTop: 2, paddingBottom: 12, gap: 10 },
  modsHead: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 4 },
  modIcon: { width: 28, height: 28, backgroundColor: Ghost.swatch },
  synergyPart: { borderTopWidth: 1, borderTopColor: Ghost.rule, paddingVertical: 10, gap: 8 },
  bonus: { alignItems: "flex-start" },
  short: { opacity: 0.5, gap: 8 },
  mod: { paddingVertical: 5, borderTopWidth: 1, borderTopColor: Ghost.rule },
  modHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  footer: {
    paddingHorizontal: Gutter,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
