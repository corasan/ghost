import type { Briefing, GuardianCharacter } from "@ghost/contract"
import { type Href, router } from "expo-router"
import { Modal, Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Cond, Diamond, Mono } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { getLastLatency, useHealth } from "@/lib/api"
import { selectCharacter } from "@/lib/character"
import { upper } from "@/lib/format"
import { useServerUrl } from "@/lib/server-url"

const where = (url: string) =>
  /localhost|127\.0\.0\.1/.test(url) ? "LOCAL" : /\.ts\.net/.test(url) ? "TAILNET" : "REMOTE"

/**
 * Tapping your power opens this. It leads with the character so switching is
 * one tap, then four destinations, each carrying its one number so the menu
 * often answers the question by itself.
 */
export function GuardianMenu({
  open,
  onClose,
  character,
  characters,
  briefing,
}: {
  open: boolean
  onClose: () => void
  character: GuardianCharacter | undefined
  characters: readonly GuardianCharacter[]
  briefing: Briefing | undefined
}) {
  const insets = useSafeAreaInsets()
  const health = useHealth()
  const url = useServerUrl()
  const latency = getLastLatency()

  const go = (href: Href) => {
    onClose()
    router.push(href)
  }

  const vaultFull = briefing ? briefing.vaultCount / briefing.vaultCapacity >= 0.9 : false
  const destinations = [
    { label: "GUARDIAN", value: "EQUIPPED", href: "/guardian" as const, color: Ghost.dim },
    {
      label: "VAULT",
      value: briefing ? `${briefing.vaultCount} / ${briefing.vaultCapacity}` : "—",
      href: "/vault" as const,
      color: vaultFull ? Ghost.danger : Ghost.dim,
    },
    {
      label: "RECENT",
      value: briefing ? `${briefing.recentCount} NEW` : "—",
      href: "/recent" as const,
      color: Ghost.dim,
      dot: (briefing?.undecidedCount ?? 0) > 0,
    },
    {
      label: "HISTORY",
      value: briefing ? `${briefing.actionsToday} TODAY` : "—",
      href: "/history" as const,
      color: Ghost.dim,
    },
  ]

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close menu" style={styles.scrim} onPress={onClose} />
      <View style={[styles.panel, { top: insets.top + 2 }]}>
        <View style={[styles.between, styles.ruled, { paddingVertical: 14 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={styles.glyph}>
              <Diamond size={14} color={Ghost.ink} outline />
            </View>
            <View>
              <Cond size={20} style={{ letterSpacing: 1.2, lineHeight: 20 }}>
                {character ? upper(character.classType) : "GUARDIAN"}
              </Cond>
              {character?.subclass ? (
                <Mono style={{ marginTop: 3 }}>{upper(character.subclass)}</Mono>
              ) : null}
            </View>
          </View>
          <Cond size={22} color={Ghost.gold} style={{ letterSpacing: 0.9 }}>
            {character?.light ?? "—"}
          </Cond>
        </View>

        {characters.length > 1 ? (
          <View style={[styles.ruled, { flexDirection: "row", gap: 6, paddingVertical: 10 }]}>
            {characters.map((each) => {
              const active = each.characterId === character?.characterId
              return (
                <Pressable
                  key={each.characterId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => selectCharacter(each.characterId)}
                  style={[
                    styles.switch,
                    active ? { backgroundColor: Ghost.ink } : { borderColor: Ghost.ruleStrong },
                  ]}
                >
                  <Cond size={13} color={active ? Ghost.bg : Ghost.muted}>
                    {upper(each.classType)}
                  </Cond>
                </Pressable>
              )
            })}
          </View>
        ) : null}

        {destinations.map((item, i) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={() => go(item.href)}
            style={({ pressed }) => [
              styles.between,
              styles.destination,
              i < destinations.length - 1 && {
                borderBottomWidth: 1,
                borderBottomColor: Ghost.rule,
              },
              pressed && { backgroundColor: Ghost.swatch },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Cond size={18}>{item.label}</Cond>
              {item.dot ? <Diamond size={6} /> : null}
            </View>
            <Mono size={10} color={item.color} style={{ letterSpacing: 0.8 }}>
              {item.value}
            </Mono>
          </Pressable>
        ))}

        <View style={[styles.between, styles.footer]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={[styles.dot, { backgroundColor: health.data ? Ghost.good : Ghost.danger }]}
            />
            <Mono color={health.data ? Ghost.good : Ghost.danger}>
              {health.data
                ? `MCP · ${where(url)}${latency !== null ? ` · ${latency}MS` : ""}`
                : "MCP · OFFLINE"}
            </Mono>
          </View>
          <Pressable hitSlop={10} onPress={() => go("/settings")}>
            <Mono color={Ghost.accent}>SETTINGS</Mono>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: Ghost.scrim },
  panel: {
    position: "absolute",
    right: 12,
    width: 290,
    backgroundColor: Ghost.panel,
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
    boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
  },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ruled: { paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: Ghost.line },
  glyph: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  switch: { flex: 1, paddingVertical: 7, alignItems: "center", borderWidth: 1 },
  destination: { paddingVertical: 15, paddingHorizontal: 16 },
  footer: {
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: Ghost.line,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
