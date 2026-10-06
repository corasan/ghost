import type { AbilityKind, LoadoutPlug, SubclassLoadout } from "@ghost/contract"
import { Image } from "expo-image"
import { router } from "expo-router"
import { ScrollView, StyleSheet, View } from "react-native"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { Body, Button, Cond, Cut, Meta, Mono } from "@/components/ghost/ui"
import { ELEMENT_TONE, Ghost, Gutter, Type } from "@/constants/theme"
import { useCharacter } from "@/lib/character"
import { firstParagraph } from "@/lib/effect-text"
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

function Aspect({ aspect, tone }: { aspect: LoadoutPlug; tone: string }) {
  const effect = firstParagraph(aspect.description)
  return (
    <View style={[styles.entry, { paddingVertical: 11 }]}>
      <PlugIcon icon={aspect.icon} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body size={16} style={{ fontFamily: Type.bodyMedium, lineHeight: 20 }}>
          {aspect.name}
        </Body>
        {effect ? (
          <Body size={14} color={Ghost.muted} style={{ lineHeight: 20, marginTop: 3 }}>
            {effect}
          </Body>
        ) : null}
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
        {effect ? (
          <Body size={14} color={Ghost.muted} style={{ lineHeight: 20, marginTop: 2 }}>
            {effect}
          </Body>
        ) : null}
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
  const bottomInset = useBottomInset()
  const { character } = useCharacter()
  const footer = useFooterHeight()
  const loadout = character?.loadout
  if (!loadout) return null

  const tone = ELEMENT_TONE[loadout.element]
  const name = loadout.subclass ?? "Subclass"
  const capacity = fragmentCapacity(loadout)

  return (
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
            <Ability slot="Super" name={loadout.super.name} icon={loadout.super.icon} edge={tone} />
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
      </ScrollView>
      <View onLayout={footer.onLayout} style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
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
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 30 },
  ability: { height: 44, alignItems: "center", justifyContent: "center" },
  label: { letterSpacing: 1.3, paddingBottom: 8 },
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
