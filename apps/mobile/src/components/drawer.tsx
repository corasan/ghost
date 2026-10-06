import { LegendList } from "@legendapp/list/react-native"
import { type Href, router, usePathname } from "expo-router"
import type { DrawerContentComponentProps } from "expo-router/drawer"
import { Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Body, Button, Cond, Diamond, Meta, Mono } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { getLastLatency, useBriefing, useHealth, useSavedBuilds, useSessions } from "@/lib/api"
import { selectCharacter, useCharacter } from "@/lib/character"
import { age, upper } from "@/lib/format"
import { useServerUrl } from "@/lib/server-url"
import { continueSession, startFreshSession, useSessionId } from "@/lib/session"
import { useBottomInset } from "@/lib/insets"

const where = (url: string) =>
  /localhost|127\.0\.0\.1/.test(url) ? "local" : /\.ts\.net/.test(url) ? "tailnet" : "remote"

/**
 * The app's navigation. It leads with the character so switching is one
 * tap, then the pages, each carrying its one number so the drawer often
 * answers the question by itself, then every chat you've had.
 */
export function GhostDrawer({ navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets()
  const bottomInset = useBottomInset()
  const pathname = usePathname()
  const health = useHealth()
  const url = useServerUrl()
  const latency = getLastLatency()
  const { character, characters } = useCharacter()
  const briefing = useBriefing(character?.characterId).data
  const sessions = useSessions()
  const savedBuilds = useSavedBuilds().data
  const sessionId = useSessionId()

  const go = (href: Href) => {
    navigation.closeDrawer()
    router.navigate(href)
  }

  const vaultFull = briefing ? briefing.vaultCount / briefing.vaultCapacity >= 0.9 : false
  const pages = [
    { label: "CHAT", value: "Ghost", href: "/" as const, color: Ghost.dim },
    { label: "GUARDIAN", value: "Equipped", href: "/guardian" as const, color: Ghost.dim },
    {
      label: "BUILDS",
      value: savedBuilds ? `${savedBuilds.length} saved` : "—",
      href: "/builds" as const,
      color: Ghost.dim,
    },
    {
      label: "VAULT",
      value: briefing ? `${briefing.vaultCount} / ${briefing.vaultCapacity}` : "—",
      href: "/vault" as const,
      color: vaultFull ? Ghost.danger : Ghost.dim,
    },
    {
      label: "RECENT",
      value: briefing ? `${briefing.recentCount} new` : "—",
      href: "/recent" as const,
      color: Ghost.dim,
      dot: (briefing?.undecidedCount ?? 0) > 0,
    },
    {
      label: "HISTORY",
      value: briefing ? `${briefing.actionsToday} today` : "—",
      href: "/history" as const,
      color: Ghost.dim,
    },
  ]

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.panel, paddingTop: insets.top }}>
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
              <Meta style={{ marginTop: 2 }}>{character.subclass}</Meta>
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

      {pages.map((page) => {
        const active = pathname === page.href
        return (
          <Pressable
            key={page.label}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => go(page.href)}
            style={({ pressed }) => [
              styles.between,
              styles.page,
              (pressed || active) && { backgroundColor: Ghost.swatch },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={[styles.marker, { backgroundColor: active ? Ghost.accent : undefined }]}
              />
              <Cond size={18}>{page.label}</Cond>
              {page.dot ? <Diamond size={6} /> : null}
            </View>
            <Meta color={page.color}>{page.value}</Meta>
          </Pressable>
        )
      })}

      <View style={[styles.between, styles.chatsHead]}>
        <Mono>CHATS</Mono>
        <View style={{ width: 96, flexDirection: "row" }}>
          <Button
            label="NEW CHAT"
            tone="accent"
            compact
            under={Ghost.panel}
            onPress={() => {
              startFreshSession()
              go("/")
            }}
          />
        </View>
      </View>
      <LegendList
        style={{ flex: 1 }}
        data={sessions.data ?? []}
        keyExtractor={(session) => session.id}
        recycleItems
        extraData={sessionId}
        estimatedItemSize={56}
        ListEmptyComponent={
          <Body size={13} color={Ghost.dim} style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            Nothing yet. Ask Ghost something.
          </Body>
        }
        renderItem={({ item: session }) => {
          const active = session.id === sessionId
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                continueSession(session.id)
                go("/")
              }}
              style={({ pressed }) => [
                styles.chat,
                (pressed || active) && { backgroundColor: Ghost.swatch },
              ]}
            >
              <Body size={14} color={active ? Ghost.ink : Ghost.soft} lines={1}>
                {session.title}
              </Body>
              <Meta style={{ marginTop: 2 }}>
                {age(session.lastAt)} · {session.count} {session.count === 1 ? "ask" : "asks"}
              </Meta>
            </Pressable>
          )
        }}
      />

      <View style={[styles.between, styles.footer, { paddingBottom: bottomInset + 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={[styles.dot, { backgroundColor: health.data ? Ghost.good : Ghost.danger }]}
          />
          <Meta color={health.data ? Ghost.good : Ghost.danger}>
            {health.data
              ? `MCP · ${where(url)}${latency !== null ? ` · ${latency} ms` : ""}`
              : "MCP · offline"}
          </Meta>
        </View>
        <Pressable hitSlop={10} onPress={() => go("/settings")}>
          <Meta color={Ghost.accent}>Settings</Meta>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ruled: { paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: Ghost.line },
  glyph: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  switch: { flex: 1, paddingVertical: 7, alignItems: "center", borderWidth: 1 },
  page: {
    paddingVertical: 14,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
  },
  marker: { width: 2, height: 18, marginRight: 6 },
  chatsHead: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
  },
  chat: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
  },
  footer: {
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: Ghost.line,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
