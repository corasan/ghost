import type { AbilityKind, Keyword, LoadoutPlug, SubclassLoadout } from "@ghost/contract"
import { Image } from "expo-image"
import { router } from "expo-router"
import { createContext, use, useRef, useState } from "react"
import { type HostInstance, ScrollView, StyleSheet, Text, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { Tooltip, TooltipLayer } from "@/components/ghost/tooltip"
import { Body, Button, Cond, Cut, Meta, Mono } from "@/components/ghost/ui"
import { ELEMENT_TONE, Ghost, Gutter, Type } from "@/constants/theme"
import { useCharacter } from "@/lib/character"
import { firstParagraph, plain } from "@/lib/effect-text"
import { keywordRuns, loadoutKeywords } from "@/lib/keywords"
import type { Rect } from "@/lib/tooltip"
import { useFooterHeight } from "@/lib/footer"
import { sentence, upper } from "@/lib/format"
import { signed } from "@/lib/plan-card"
import { useBottomInset } from "@/lib/insets"

const ABILITY_LABEL: Record<AbilityKind, string> = {
  class: "Class",
  jump: "Jump",
  melee: "Melee",
  grenade: "Grenade",
}

function Ability({
  slot,
  name,
  icon,
  edge,
}: {
  slot: string
  name: string
  icon: string | null | undefined
  edge: string
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
      <Cut cut={6} fill={Ghost.swatch} border={edge} under={Ghost.panel} style={styles.ability}>
        {icon ? <Image source={icon} style={{ width: 32, height: 32 }} transition={120} /> : null}
      </Cut>
      <Meta size={12}>{slot}</Meta>
      <Body size={13} color={Ghost.soft} style={{ lineHeight: 17, marginTop: -4 }}>
        {name}
      </Body>
    </View>
  )
}

type Open = { keyword: Keyword; anchor: HostInstance; within: Rect }

const KeywordContext = createContext<{
  keywords: readonly Keyword[]
  tone: string
  open: (open: Open) => void
}>({ keywords: [], tone: Ghost.accent, open: () => {} })

const LINE = 20

/** Effect text whose keywords are underlined and open their definition when tapped. */
function Effect({ text, size }: { text: string; size: number }) {
  const { keywords, tone, open } = use(KeywordContext)
  const ref = useRef<HostInstance>(null)
  return (
    <Body ref={ref} size={size} color={Ghost.muted} style={{ lineHeight: LINE, marginTop: 2 }}>
      {keywordRuns(text, keywords).map(({ text: run, keyword }, i) =>
        keyword ? (
          <Text
            key={i}
            accessibilityRole="button"
            accessibilityHint={`Shows what ${keyword.name} means`}
            suppressHighlighting
            onPress={(event) => {
              if (!ref.current) return
              const { locationX, locationY } = event.nativeEvent
              open({
                keyword,
                anchor: ref.current,
                within: { x: locationX, y: locationY - LINE / 2, width: 0, height: LINE },
              })
            }}
            style={[styles.keyword, { textDecorationColor: tone }]}
          >
            {run}
          </Text>
        ) : (
          run
        ),
      )}
    </Body>
  )
}

function KeywordName({ keyword, tone, size }: { keyword: Keyword; tone: string; size: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <PlugIcon icon={keyword.icon} size={size + 4} />
      <Cond size={size} color={tone} style={{ letterSpacing: 0.8 }}>
        {upper(keyword.name)}
      </Cond>
    </View>
  )
}

function KeywordEntry({ keyword, tone }: { keyword: Keyword; tone: string }) {
  return (
    <View style={[styles.entry, { gap: 16, paddingVertical: 12 }]}>
      <View style={{ width: 128 }}>
        <KeywordName keyword={keyword} tone={tone} size={18} />
      </View>
      <Body size={14} color={Ghost.muted} style={{ flex: 1, lineHeight: 20 }}>
        {plain(keyword.description)}
      </Body>
    </View>
  )
}

function Aspect({ aspect, tone }: { aspect: LoadoutPlug; tone: string }) {
  const effect = firstParagraph(aspect.description)
  return (
    <View style={[styles.entry, { paddingVertical: 11 }]}>
      <PlugIcon icon={aspect.icon} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body size={16} style={{ fontFamily: Type.bodyMedium, lineHeight: 20 }}>
          {aspect.name}
        </Body>
        {effect ? <Effect text={effect} size={14} /> : null}
      </View>
      {aspect.fragmentSlots ? (
        <Meta color={tone} style={{ marginTop: 2 }}>
          +{aspect.fragmentSlots} {aspect.fragmentSlots === 1 ? "slot" : "slots"}
        </Meta>
      ) : null}
    </View>
  )
}

function Fragment({ fragment }: { fragment: LoadoutPlug }) {
  const effect = firstParagraph(fragment.description)
  return (
    <View style={styles.entry}>
      <PlugIcon icon={fragment.icon} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body size={15} style={{ fontFamily: Type.bodyMedium, lineHeight: 18 }}>
          {fragment.name}
        </Body>
        {effect ? <Effect text={effect} size={14} /> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 3, marginTop: 3 }}>
        {fragment.mods.map((mod) => (
          <Meta key={mod.label} color={mod.delta > 0 ? Ghost.good : Ghost.danger}>
            {signed(mod.delta)} {sentence(mod.label)}
          </Meta>
        ))}
      </View>
    </View>
  )
}

const fragmentCapacity = (loadout: SubclassLoadout) =>
  loadout.aspects.reduce((slots, aspect) => slots + (aspect.fragmentSlots ?? 0), 0)

/** The equipped subclass in full: abilities, what each aspect does, and what each fragment costs. */
export default function SubclassScreen() {
  return (
    <TooltipLayer name="subclass">
      <Subclass />
    </TooltipLayer>
  )
}

function Subclass() {
  const bottomInset = useBottomInset()
  const { character } = useCharacter()
  const footer = useFooterHeight()
  const [open, setOpen] = useState<Open>()
  const loadout = character?.loadout
  if (!loadout) return null

  const tone = ELEMENT_TONE[loadout.element]
  const name = loadout.subclass ?? "Subclass"
  const capacity = fragmentCapacity(loadout)
  const keywords = loadoutKeywords([...loadout.aspects, ...loadout.fragments])

  return (
    <KeywordContext value={{ keywords, tone, open: setOpen }}>
      <View collapsable={false} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: footer.height + 24 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <SubclassMark loadout={loadout} size={22} />
            <Meta color={tone}>
              {[loadout.element === "none" ? null : loadout.element, loadout.classType]
                .filter(Boolean)
                .map((part) => sentence(String(part)))
                .join(" · ")}
            </Meta>
          </View>
          <Cond size={44} style={{ letterSpacing: 0.9, lineHeight: 44, marginTop: 8 }}>
            {upper(name)}
          </Cond>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
            {loadout.super ? (
              <Ability
                slot="Super"
                name={loadout.super.name}
                icon={loadout.super.icon}
                edge={tone}
              />
            ) : null}
            {(loadout.abilities ?? []).map((ability) => (
              <Ability
                key={ability.kind}
                slot={ABILITY_LABEL[ability.kind]}
                name={ability.name}
                icon={ability.icon}
                edge={Ghost.ruleStrong}
              />
            ))}
          </View>

          {loadout.aspects.length > 0 ? (
            <>
              <Mono style={[styles.label, { marginTop: 22 }]}>ASPECTS</Mono>
              {loadout.aspects.map((aspect) => (
                <Aspect key={aspect.name} aspect={aspect} tone={tone} />
              ))}
            </>
          ) : null}

          {loadout.fragments.length > 0 ? (
            <>
              <Mono style={[styles.label, { marginTop: 14 }]}>
                FRAGMENTS · {loadout.fragments.length}
                {capacity > 0 ? ` / ${capacity}` : ""}
              </Mono>
              {loadout.fragments.map((fragment) => (
                <Fragment key={fragment.name} fragment={fragment} />
              ))}
            </>
          ) : null}

          {keywords.length > 0 ? (
            <>
              <Mono style={[styles.label, { marginTop: 14 }]}>KEYWORDS</Mono>
              {keywords.map((keyword) => (
                <KeywordEntry key={keyword.name} keyword={keyword} tone={tone} />
              ))}
            </>
          ) : null}
        </ScrollView>
        <View
          onLayout={footer.onLayout}
          style={[styles.footer, { paddingBottom: bottomInset + 12 }]}
        >
          <Button
            label="ASK GHOST"
            under={Ghost.panel}
            onPress={() => {
              router.back()
              router.navigate({
                pathname: "/",
                params: { draft: `Review my ${name} setup. What would you change?` },
              })
            }}
          />
        </View>
        {open ? (
          <Tooltip
            key={open.keyword.name}
            anchor={open.anchor}
            within={open.within}
            onClose={() => setOpen(undefined)}
          >
            <KeywordName keyword={open.keyword} tone={tone} size={17} />
            <Body size={14} color={Ghost.soft} style={{ lineHeight: 20, marginTop: 6 }}>
              {plain(open.keyword.description)}
            </Body>
          </Tooltip>
        ) : null}
      </View>
    </KeywordContext>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 30 },
  ability: { height: 44, alignItems: "center", justifyContent: "center" },
  label: { letterSpacing: 1.3, paddingBottom: 8 },
  keyword: {
    color: Ghost.soft,
    textDecorationLine: "underline",
    textDecorationStyle: "solid",
  },
  entry: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    paddingHorizontal: Gutter,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
