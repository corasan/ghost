import type { CleanupPreview, CleanupSession, JunkEntry, StashState } from "@ghost/contract"
import { router } from "expo-router"
import { type ReactNode, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { ChatHeader } from "@/components/chat/header"
import { ItemIcon } from "@/components/ghost/item-icon"
import { Unavailable } from "@/components/ghost/unavailable"
import { Body, Button, Chevron, Cond, Diamond, Meta, Mono, Said } from "@/components/ghost/ui"
import { Ghost, Gutter, Type } from "@/constants/theme"
import {
  type CleanupAction,
  errorMessage,
  useCleanup,
  useCleanupAction,
  useCleanupPreview,
  useCreateJob,
  useKeepFromCleanup,
  useStartCleanup,
  useVault,
} from "@/lib/api"
import { useCharacter } from "@/lib/character"
import {
  batchRows,
  duration,
  inHand,
  plural,
  returnable,
  say,
  segments,
  type SegmentTone,
  skipLabel,
  STASH_LABEL,
  stashMoved,
  stashSaid,
  tally,
  type Tile,
} from "@/lib/cleanup"
import { sentence } from "@/lib/format"
import { useBottomInset } from "@/lib/insets"
import { continueSession, useSessionId } from "@/lib/session"

const TILE = 37

const TRY_ASKING = [
  "Tag duplicates that have a better copy",
  "Tag weapons with a roll under 40",
  "Tag armor under 60 total",
]

const SEGMENT_TONE: Record<SegmentTone, string> = {
  clear: Ghost.good,
  current: Ghost.accent,
  ahead: Ghost.rule,
}

const STASH_TONE: Record<StashState, string> = {
  queued: Ghost.dim,
  moving: Ghost.accent,
  in_vault: Ghost.good,
  returned: Ghost.good,
  failed: Ghost.danger,
}

function Crumb({
  label,
  right,
  color = Ghost.accent,
}: {
  label: string
  right?: string
  color?: string
}) {
  return (
    <View style={styles.between}>
      <Mono size={11} color={color}>
        {label}
      </Mono>
      {right ? <Meta>{right}</Meta> : null}
    </View>
  )
}

function Headline({
  title,
  subtitle,
  figure,
  total,
  caption,
  figureColor = Ghost.ink,
}: {
  title: string
  subtitle?: string
  figure?: number
  total?: number
  caption?: string
  figureColor?: string
}) {
  return (
    <View style={[styles.between, { alignItems: "flex-end", marginTop: 12 }]}>
      <View style={{ flexShrink: 1 }}>
        <Cond size={44} style={styles.headline} lines={1}>
          {title}
        </Cond>
        {subtitle ? <Meta style={{ marginTop: 6 }}>{subtitle}</Meta> : null}
      </View>
      {figure !== undefined ? (
        <View style={{ alignItems: "flex-end" }}>
          <Cond size={44} color={figureColor} style={styles.headline}>
            {figure}
            {total !== undefined ? <Text style={{ color: Ghost.dim }}>/{total}</Text> : null}
          </Cond>
          {caption ? <Meta style={{ marginTop: 6 }}>{caption}</Meta> : null}
        </View>
      ) : null}
    </View>
  )
}

function Footer({ children, note }: { children: ReactNode; note?: string | null }) {
  const bottomInset = useBottomInset()
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
      {note ? (
        <Meta color={Ghost.danger} style={{ marginBottom: 8 }}>
          {note}
        </Meta>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>{children}</View>
    </View>
  )
}

function VaultSpace({
  from,
  to,
  capacity,
  note,
}: {
  from: number
  to: number
  capacity: number
  note: string
}) {
  const full = capacity > 0 && Math.max(from, to) / capacity >= 0.9
  const tone = full ? Ghost.danger : Ghost.muted
  const base = Math.min(from, to)
  const share = (n: number) => `${capacity > 0 ? Math.min(100, (n / capacity) * 100) : 0}%` as const
  return (
    <View style={{ marginTop: 20 }}>
      <View style={styles.between}>
        <Mono>VAULT SPACE</Mono>
        <Cond size={18} style={{ letterSpacing: 0.7 }}>
          <Text style={{ color: Ghost.dim }}>{from} → </Text>
          <Text style={{ color: full ? Ghost.danger : Ghost.ink }}>{to}</Text>
          <Text style={{ color: Ghost.dim }}> / {capacity}</Text>
        </Cond>
      </View>
      <View style={styles.meter}>
        <View style={{ width: share(base), backgroundColor: tone }} />
        {to > from ? (
          <View style={{ width: share(to - from), backgroundColor: tone, opacity: 0.4 }} />
        ) : null}
      </View>
      <Meta style={{ marginTop: 8 }}>{note}</Meta>
    </View>
  )
}

function Step({
  index,
  title,
  figure,
  detail,
  last,
}: {
  index: string
  title: string
  figure: string
  detail: string
  last?: boolean
}) {
  return (
    <View style={[styles.step, last && { borderBottomWidth: 1, borderBottomColor: Ghost.rule }]}>
      <Mono size={11} style={{ paddingTop: 5 }}>
        {index}
      </Mono>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.between}>
          <Cond size={18} style={{ lineHeight: 22 }}>
            {title}
          </Cond>
          <Meta>{figure}</Meta>
        </View>
        <Meta size={14} style={{ marginTop: 3, lineHeight: 20 }}>
          {detail}
        </Meta>
      </View>
    </View>
  )
}

function PlanView({ preview, name }: { preview: CleanupPreview; name: string }) {
  const start = useStartCleanup()
  const { vault } = preview
  const spare = vault.capacity - vault.after
  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}>
        <Crumb label="VAULT › CLEANUP" right={name} />
        <Headline title="CLEAN UP MODE" />
        <View style={{ marginTop: 18 }}>
          <Said>
            <Text style={{ color: Ghost.danger, fontFamily: Type.bodyMedium }}>
              {plural(preview.junk, "item")}
            </Text>{" "}
            {preview.junk === 1 ? "is" : "are"} tagged junk. I’ll deliver them in batches that fill
            every slot, and you delete them in game.
          </Said>
        </View>
        <View style={{ marginTop: 22 }}>
          <Step
            index="01"
            title="STASH"
            figure={`${plural(preview.stash, "item")} → vault`}
            detail="Everything you’re carrying goes to the vault. Equipped gear stays on."
          />
          <Step
            index="02"
            title="DELIVER"
            figure={`${preview.junk} · ${plural(preview.batches, "batch", "batches")}`}
            detail="Every slot fills to its limit of nine. Delete a batch and the next one follows."
            last={preview.returnable === 0}
          />
          {preview.returnable > 0 ? (
            <Step
              index="03"
              title="RETURN"
              figure={plural(preview.returnable, "item")}
              detail={`Optional. Your keepers go back to ${name} when you’re done.`}
              last
            />
          ) : null}
        </View>
        <VaultSpace
          from={vault.count}
          to={vault.after}
          capacity={vault.capacity}
          note={
            preview.fits
              ? `The stash fits with ${plural(spare, "slot")} to spare.`
              : `The stash needs ${plural(preview.stash, "slot")} and the vault has ${vault.capacity - vault.count} free. Make room first.`
          }
        />
        {preview.equippedJunk.length > 0 ? (
          <Meta color={Ghost.dim} style={{ marginTop: 14 }}>
            Skipping {plural(preview.equippedJunk.length, "junk item")} you have equipped:{" "}
            {preview.equippedJunk.join(", ")}.
          </Meta>
        ) : null}
      </ScrollView>
      <Footer note={start.isError ? errorMessage(start.error) : null}>
        <Button label="NOT NOW" onPress={() => router.navigate("/vault")} />
        <Button
          label={start.isPending ? "STARTING…" : "START CLEANUP"}
          tone="solid"
          flex={1.5}
          disabled={!preview.fits || start.isPending}
          onPress={() => start.mutate(preview.characterId)}
        />
      </Footer>
    </>
  )
}

function EmptyView({ name, characterId }: { name: string; characterId: string }) {
  const createJob = useCreateJob()
  const sessionId = useSessionId()

  const ask = (prompt: string) =>
    createJob.mutate(
      { kind: "chat", prompt, characterId, sessionId },
      {
        onSuccess: (job) => {
          if (job.sessionId !== null) continueSession(job.sessionId)
          router.navigate("/")
        },
      },
    )

  const tagJunk = () =>
    createJob.mutate(
      {
        kind: "vault_cleanup",
        prompt: "Clean up my vault: flag duplicates with a better copy and low rolls.",
        characterId,
        sessionId,
      },
      { onSuccess: () => router.navigate("/vault") },
    )

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}>
        <Crumb label="VAULT › CLEANUP" right={name} />
        <Headline title="CLEAN UP MODE" />
        <View style={styles.empty}>
          <View style={{ flexDirection: "row", gap: 3 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <View
                key={i}
                style={[styles.dashed, { width: 28, height: 28, borderColor: Ghost.ruleStrong }]}
              />
            ))}
          </View>
          <View style={{ alignItems: "center", gap: 8 }}>
            <Cond size={24} style={{ letterSpacing: 1.2 }}>
              NOTHING TAGGED AS JUNK
            </Cond>
            <Meta size={14} style={{ textAlign: "center", maxWidth: 290, lineHeight: 20 }}>
              Cleanup works through items you’ve tagged junk. Ask Ghost to flag duplicates and low
              rolls. You review the list before anything moves.
            </Meta>
          </View>
        </View>
        <Mono style={{ marginTop: 22, paddingBottom: 10 }}>TRY ASKING</Mono>
        {TRY_ASKING.map((prompt) => (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            disabled={createJob.isPending}
            onPress={() => ask(prompt)}
            style={({ pressed }) => [styles.ask, pressed && { opacity: 0.6 }]}
          >
            <Body size={15} color={Ghost.soft}>
              {prompt}
            </Body>
            <Chevron />
          </Pressable>
        ))}
        <Meta color={Ghost.dim} style={{ marginTop: 6 }}>
          You can also tag any item yourself from its actions.
        </Meta>
      </ScrollView>
      <Footer note={createJob.isError ? errorMessage(createJob.error) : null}>
        <Button
          label="ASK GHOST TO TAG JUNK"
          tone="solid"
          disabled={createJob.isPending}
          onPress={tagJunk}
        />
      </Footer>
    </>
  )
}

function StashingView({ session, name }: { session: CleanupSession; name: string }) {
  const act = useCleanupAction()
  const moved = stashMoved(session)
  const total = session.stash.length
  return (
    <>
      <View style={[styles.page, { paddingBottom: 0 }]}>
        <Crumb label="CLEANUP › STEP 1 OF 2" />
        <Headline
          title="STASHING"
          subtitle="Carried gear → vault"
          figure={moved}
          total={total}
          caption="moved"
        />
        <View style={[styles.meter, { height: 3 }]}>
          <View
            style={{
              width: `${total > 0 ? (moved / total) * 100 : 100}%`,
              backgroundColor: Ghost.accent,
            }}
          />
        </View>
        <View style={{ marginTop: 16 }}>
          <Said size={14}>{stashSaid(name, session.stash.filter((e) => e.junk).length)}</Said>
        </View>
        <Mono style={{ paddingTop: 18, paddingBottom: 6 }}>CARRIED · {total}</Mono>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Gutter }}>
        {session.stash.map((entry) => (
          <View
            key={entry.itemInstanceId}
            style={[styles.carried, { opacity: entry.state === "queued" ? 0.5 : 1 }]}
          >
            <ItemIcon
              icon={entry.icon}
              size={40}
              element={entry.damageType}
              gearTier={entry.gearTier}
              masterwork={entry.masterwork}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Body size={15} lines={1} style={{ fontFamily: Type.bodyMedium, flexShrink: 1 }}>
                  {entry.name}
                </Body>
                {entry.junk ? (
                  <View style={styles.junk}>
                    <Mono size={9} color={Ghost.danger}>
                      JUNK
                    </Mono>
                  </View>
                ) : null}
              </View>
              <Meta lines={1}>{entry.meta}</Meta>
            </View>
            <Meta color={STASH_TONE[entry.state]}>{STASH_LABEL[entry.state]}</Meta>
          </View>
        ))}
      </ScrollView>
      <Footer note={act.isError ? errorMessage(act.error) : session.error}>
        <View style={{ flex: 1, gap: 8 }}>
          <Button
            label="STOP"
            disabled={act.isPending}
            onPress={() => act.mutate({ id: session.id, action: "stop" })}
          />
          <Meta color={Ghost.dim} style={{ textAlign: "center" }}>
            Anything already moved stays in the vault.
          </Meta>
        </View>
      </Footer>
    </>
  )
}

function TileView({
  tile,
  selected,
  onPress,
}: {
  tile: Tile
  selected: boolean
  onPress: (entry: JunkEntry) => void
}) {
  if (tile.kind === "empty") return <View style={[styles.dashed, styles.tile]} />
  if (tile.kind === "done") {
    return (
      <View style={[styles.dashed, styles.tile, styles.center]}>
        <Diamond size={6} color={tile.deleted ? Ghost.good : Ghost.dim} />
      </View>
    )
  }
  const { entry } = tile
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.name}
      accessibilityState={{ selected }}
      onPress={() => onPress(entry)}
      style={[styles.tile, { opacity: tile.arrived ? 1 : 0.45 }]}
    >
      <ItemIcon
        icon={entry.icon}
        size={TILE}
        element={entry.damageType}
        gearTier={entry.gearTier}
        masterwork={entry.masterwork}
      />
      {selected ? <View pointerEvents="none" style={styles.ring} /> : null}
    </Pressable>
  )
}

function BatchView({ session, name }: { session: CleanupSession; name: string }) {
  const act = useCleanupAction()
  const keep = useKeepFromCleanup()
  const [picked, setPicked] = useState<string | null>(null)
  const rows = batchRows(session)
  const selected = rows
    .flatMap((row) => row.tiles)
    .flatMap((tile) =>
      tile.kind === "item" && tile.entry.itemInstanceId === picked ? [tile.entry] : [],
    )[0]
  const paused = session.stage === "paused"
  const { deleted } = tally(session)
  const busy = act.isPending || keep.isPending
  const failure = act.isError ? act.error : keep.isError ? keep.error : null

  return (
    <>
      <View style={[styles.page, { paddingBottom: 0 }]}>
        <Crumb label="CLEANUP › STEP 2 OF 2" />
        <Headline
          title={`BATCH ${session.batch + 1}`}
          subtitle={`of ${session.batches} · ${inHand(session)} in hand`}
          figure={deleted}
          total={session.junk.length}
          caption="deleted"
        />
        <View style={{ flexDirection: "row", gap: 3, marginTop: 14 }}>
          {segments(session).map((segment, i) => (
            <View
              key={i}
              style={{
                flex: segment.weight,
                height: 3,
                backgroundColor: SEGMENT_TONE[segment.tone],
              }}
            />
          ))}
        </View>
        <View style={{ marginTop: 16 }}>
          <Said size={14}>{say(session)}</Said>
        </View>
        <View style={[styles.between, { paddingTop: 16, paddingBottom: 6 }]}>
          <Mono>ON {name.toUpperCase()} NOW</Mono>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Diamond size={6} color={paused ? Ghost.dim : Ghost.good} />
            <Mono color={paused ? Ghost.dim : Ghost.good}>{paused ? "PAUSED" : "WATCHING"}</Mono>
          </View>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Gutter }}>
        {rows.map((row) => (
          <View key={row.slot} style={styles.slot}>
            <View style={[styles.between, { paddingBottom: 7 }]}>
              <Cond size={16} style={{ lineHeight: 20 }}>
                {row.label}
              </Cond>
              <Meta color={row.left > 0 ? Ghost.muted : Ghost.good}>
                {row.left > 0 ? `${row.left} left` : "Clear"}
              </Meta>
            </View>
            <View style={styles.between}>
              {row.tiles.map((tile, i) => (
                <TileView
                  key={tile.kind === "empty" ? `empty-${i}` : tile.entry.itemInstanceId}
                  tile={tile}
                  selected={tile.kind === "item" && tile.entry.itemInstanceId === picked}
                  onPress={(entry) =>
                    setPicked((current) =>
                      current === entry.itemInstanceId ? null : entry.itemInstanceId,
                    )
                  }
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.picked}>
        {selected ? (
          <>
            <ItemIcon
              icon={selected.icon}
              size={40}
              element={selected.damageType}
              gearTier={selected.gearTier}
              masterwork={selected.masterwork}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Body size={15} lines={1} style={{ fontFamily: Type.bodyMedium }}>
                {selected.name}
              </Body>
              <Meta lines={1}>{selected.meta}</Meta>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Keep ${selected.name}`}
              disabled={busy}
              onPress={() =>
                keep.mutate(
                  { id: session.id, itemId: selected.itemInstanceId },
                  { onSuccess: () => setPicked(null) },
                )
              }
              style={({ pressed }) => [styles.keep, (pressed || busy) && { opacity: 0.6 }]}
            >
              <Cond size={13} color={Ghost.accent}>
                KEEP
              </Cond>
            </Pressable>
          </>
        ) : (
          <Meta color={Ghost.dim}>Tap an item to see what it is, or to keep it.</Meta>
        )}
      </View>
      <Footer note={failure ? errorMessage(failure) : session.error}>
        <Button
          label={paused ? "RESUME" : "PAUSE"}
          disabled={busy}
          onPress={() => act.mutate({ id: session.id, action: paused ? "resume" : "pause" })}
        />
        <Button
          label={skipLabel(session)}
          tone="accent"
          flex={1.5}
          disabled={busy}
          onPress={() => act.mutate({ id: session.id, action: "skip" })}
        />
      </Footer>
    </>
  )
}

function Tally({
  label,
  detail,
  value,
  color = Ghost.ink,
  last,
}: {
  label: string
  detail?: string
  value: number
  color?: string
  last?: boolean
}) {
  return (
    <View style={[styles.tally, last && { borderBottomWidth: 1, borderBottomColor: Ghost.rule }]}>
      <View style={{ flexShrink: 1 }}>
        <Body size={15} color={Ghost.soft}>
          {label}
        </Body>
        {detail ? <Meta style={{ marginTop: 2 }}>{detail}</Meta> : null}
      </View>
      <Cond size={18} color={color}>
        {value}
      </Cond>
    </View>
  )
}

function DoneView({ session, name }: { session: CleanupSession; name: string }) {
  const act = useCleanupAction()
  const vault = useVault().data
  const { deleted, kept, skipped, failed } = tally(session)
  const back = returnable(session)
  const returning = session.stage === "returning"
  const equipped = session.equippedJunk
  const now = vault?.count ?? session.vault.before
  const after = returning ? now : now - back
  const free = session.vault.capacity - after
  const send = (action: CleanupAction) => act.mutate({ id: session.id, action })

  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.page}>
        <Crumb label="CLEANUP COMPLETE" color={Ghost.good} />
        <Headline
          title="ALL CLEAR"
          subtitle={`${plural(session.batches, "batch", "batches")} · ${duration(session.startedAt, session.finishedAt ?? session.startedAt)}`}
          figure={deleted}
          caption="deleted"
          figureColor={Ghost.good}
        />
        <View style={{ marginTop: 22 }}>
          <Tally label="Deleted in game" value={deleted} color={Ghost.good} />
          <Tally label="Kept" detail="Junk tag removed, left in vault" value={kept} />
          <Tally
            label="Skipped"
            detail={
              equipped.length > 0
                ? `${equipped.join(", ")} ${equipped.length === 1 ? "is" : "are"} equipped`
                : "Back in the vault, still tagged junk"
            }
            value={skipped + equipped.length}
            last={failed === 0}
          />
          {failed > 0 ? (
            <Tally
              label="Couldn’t move"
              detail="Still tagged junk"
              value={failed}
              color={Ghost.danger}
              last
            />
          ) : null}
        </View>
        <VaultSpace
          from={session.vault.before}
          to={after}
          capacity={session.vault.capacity}
          note={
            back > 0 && !returning
              ? `${plural(free, "slot")} free, after your ${plural(back, "item")} return.`
              : `${plural(free, "slot")} free.`
          }
        />
        <View style={{ marginTop: 22 }}>
          <Said>
            {returning
              ? `Bringing your ${plural(back, "item")} back to ${name}.`
              : back > 0
                ? `Your other ${plural(back, "item")} ${back === 1 ? "is" : "are"} still in the vault. Bring them back to ${name}?`
                : "Nothing else to bring back."}
          </Said>
        </View>
      </ScrollView>
      <Footer note={act.isError ? errorMessage(act.error) : session.error}>
        {back > 0 || returning ? (
          <>
            <Button
              label="LEAVE IN VAULT"
              disabled={returning || act.isPending}
              onPress={() => send("close")}
            />
            <Button
              label={returning ? "RETURNING…" : `RETURN ${plural(back, "ITEM", "ITEMS")}`}
              tone="solid"
              flex={1.2}
              disabled={returning || act.isPending}
              onPress={() => send("return")}
            />
          </>
        ) : (
          <Button
            label="DONE"
            tone="solid"
            disabled={act.isPending}
            onPress={() => send("close")}
          />
        )}
      </Footer>
    </>
  )
}

export default function CleanupScreen() {
  const { character, characters } = useCharacter()
  const cleanup = useCleanup()
  const session = cleanup.data ?? null
  const characterId = session?.characterId ?? character?.characterId
  const owner = characters.find((each) => each.characterId === characterId) ?? character
  const preview = useCleanupPreview(session === null ? characterId : undefined)
  const name = owner ? sentence(owner.classType) : "your Guardian"

  const body = (() => {
    if (session !== null) {
      switch (session.stage) {
        case "stashing":
          return <StashingView session={session} name={name} />
        case "delivering":
        case "paused":
          return <BatchView session={session} name={name} />
        case "finished":
        case "returning":
          return <DoneView session={session} name={name} />
      }
    }
    if (preview.data && characterId) {
      return preview.data.junk === 0 ? (
        <EmptyView name={name} characterId={characterId} />
      ) : (
        <PlanView preview={preview.data} name={name} />
      )
    }
    if (cleanup.isError || preview.isError) {
      return (
        <View style={styles.page}>
          <Unavailable
            error={cleanup.error ?? preview.error}
            onRetry={() => void Promise.all([cleanup.refetch(), preview.refetch()])}
          />
        </View>
      )
    }
    return (
      <Body color={Ghost.dim} style={[styles.page, { paddingTop: 32 }]}>
        Loading…
      </Body>
    )
  })()

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg, backgroundImage: Ghost.glow }}>
      <ChatHeader character={character} ruled={false} />
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: Gutter, paddingTop: 2, paddingBottom: 16 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  center: { alignItems: "center", justifyContent: "center" },
  headline: { letterSpacing: 0.4, lineHeight: 42 },
  meter: { marginTop: 8, height: 4, backgroundColor: Ghost.rule, flexDirection: "row" },
  step: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  footer: {
    paddingHorizontal: Gutter,
    paddingTop: 12,
    backgroundColor: Ghost.bg,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  empty: {
    marginTop: 26,
    paddingTop: 28,
    paddingBottom: 26,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Ghost.rule,
    alignItems: "center",
    gap: 16,
  },
  dashed: { borderWidth: 1, borderStyle: "dashed", borderColor: Ghost.line },
  ask: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  carried: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  junk: { borderWidth: 1, borderColor: Ghost.danger, paddingHorizontal: 4, paddingVertical: 1 },
  slot: { paddingTop: 8, paddingBottom: 10, borderTopWidth: 1, borderTopColor: Ghost.rule },
  tile: { width: TILE, height: TILE },
  ring: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderColor: Ghost.accent,
    shadowColor: Ghost.accent,
    shadowOpacity: 0.55,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  picked: {
    height: 66,
    paddingHorizontal: Gutter,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.bg,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  keep: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
  },
  tally: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
})
