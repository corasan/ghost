import type { AbilityKind, LoadoutPlug, SubclassLoadout } from "@ghost/contract"
import { Image } from "expo-image"
import { router } from "expo-router"
import { ScrollView, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { PlugIcon } from "@/components/ghost/plug-icon"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { Body, Button, Cond, Cut, Mono } from "@/components/ghost/ui"
import { ELEMENT_TONE, Ghost, Gutter, Type } from "@/constants/theme"
import { useCharacter } from "@/lib/character"
import { firstParagraph } from "@/lib/effect-text"
import { upper } from "@/lib/format"
import { signed } from "@/lib/plan-card"

const ABILITY_LABEL: Record<AbilityKind, string> = {
  class: "CLASS",
  jump: "JUMP",
  melee: "MELEE",
  grenade: "GRENADE",
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
      <Mono size={8}>{slot}</Mono>
      <Cond
        size={13}
        color={Ghost.soft}
        style={{ letterSpacing: 0.5, lineHeight: 14, marginTop: -3 }}
      >
        {upper(name)}
      </Cond>
    </View>
  )
}

function Aspect({ aspect, tone }: { aspect: LoadoutPlug; tone: string }) {
  const effect = firstParagraph(aspect.description)
  return (
    <View style={[styles.entry, { paddingVertical: 11 }]}>
      <PlugIcon icon={aspect.icon} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Cond size={19} style={{ letterSpacing: 0.8, lineHeight: 20 }}>
          {upper(aspect.name)}
        </Cond>
        {effect ? (
          <Body size={12.5} color={Ghost.muted} style={{ lineHeight: 17, marginTop: 4 }}>
            {effect}
          </Body>
        ) : null}
      </View>
      {aspect.fragmentSlots ? (
        <Mono color={tone} style={{ letterSpacing: 0.9, marginTop: 5 }}>
          +{aspect.fragmentSlots} {aspect.fragmentSlots === 1 ? "SLOT" : "SLOTS"}
        </Mono>
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
          <Body size={12} color={Ghost.dim} style={{ lineHeight: 16, marginTop: 2 }}>
            {effect}
          </Body>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 3, marginTop: 3 }}>
        {fragment.mods.map((mod) => (
          <Mono
            key={mod.label}
            size={10}
            color={mod.delta > 0 ? Ghost.good : Ghost.danger}
            style={{ letterSpacing: 0.8 }}
          >
            {signed(mod.delta)} {mod.label}
          </Mono>
        ))}
      </View>
    </View>
  )
}

const fragmentCapacity = (loadout: SubclassLoadout) =>
  loadout.aspects.reduce((slots, aspect) => slots + (aspect.fragmentSlots ?? 0), 0)

/** The equipped subclass in full: abilities, what each aspect does, and what each fragment costs. */
export default function SubclassScreen() {
  const insets = useSafeAreaInsets()
  const { character } = useCharacter()
  const loadout = character?.loadout
  if (!loadout) return null

  const tone = ELEMENT_TONE[loadout.element]
  const name = loadout.subclass ?? "Subclass"
  const capacity = fragmentCapacity(loadout)

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <SubclassMark loadout={loadout} size={22} />
          <Mono size={10} color={tone} style={{ letterSpacing: 1.4 }}>
            {[loadout.element === "none" ? null : loadout.element, loadout.classType]
              .filter(Boolean)
              .map((part) => upper(String(part)))
              .join(" · ")}
          </Mono>
        </View>
        <Cond size={44} style={{ letterSpacing: 0.9, lineHeight: 44, marginTop: 8 }}>
          {upper(name)}
        </Cond>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
          {loadout.super ? (
            <Ability slot="SUPER" name={loadout.super.name} icon={loadout.super.icon} edge={tone} />
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
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
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
  content: { paddingHorizontal: Gutter, paddingTop: 30, paddingBottom: 24 },
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
    flexDirection: "row",
    paddingHorizontal: Gutter,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
