import type { Purpose, RatedPerk } from "@ghost/contract"
import { Pressable, StyleSheet, View } from "react-native"

import { Body, Cond, Meta, Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { errorMessage, useRatePerk, useWeaponPerks } from "@/lib/api"

const PURPOSES: ReadonlyArray<readonly [Purpose, string]> = [
  ["pve", "PVE"],
  ["pvp", "PVP"],
]

const SOURCE: Record<NonNullable<RatedPerk["source"]>, string> = {
  player: "You",
  claude: "Ghost",
  wishlist: "Wishlist",
  community: "Community",
}

const RATING_TONE: Record<RatedPerk["rating"], string> = {
  good: Ghost.good,
  ok: Ghost.muted,
  junk: Ghost.dim,
}

function PerkRow({ perk, itemId }: { perk: RatedPerk; itemId: string }) {
  const rate = useRatePerk(itemId)
  return (
    <View style={styles.perk}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body
          size={15}
          lines={1}
          color={RATING_TONE[perk.rating]}
          style={{ fontFamily: Type.bodyMedium }}
        >
          {perk.name}
        </Body>
        <Meta size={12}>{perk.source === null ? "Unrated" : SOURCE[perk.source]}</Meta>
      </View>
      {PURPOSES.map(([purpose, label]) => {
        const good = perk.good.includes(purpose)
        return (
          <Pressable
            key={purpose}
            accessibilityRole="switch"
            accessibilityLabel={`${perk.name} good for ${label}`}
            accessibilityState={{ checked: good }}
            disabled={rate.isPending}
            onPress={() => rate.mutate({ perk: perk.name, purpose, rating: good ? "ok" : "good" })}
            hitSlop={6}
            style={({ pressed }) => [
              styles.chip,
              good && styles.chipOn,
              (pressed || rate.isPending) && { opacity: 0.6 },
            ]}
          >
            <Cond size={12} color={good ? Ghost.bg : Ghost.dim}>
              {label}
            </Cond>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Each trait column's perks with whether they count as good for PvE and PvP; a tap makes it the player's call. */
export function PerkRatings({ itemId }: { itemId: string }) {
  const perks = useWeaponPerks(itemId, true)
  if (perks.isError) {
    return (
      <View style={styles.section}>
        <Mono>PERK RATINGS</Mono>
        <Meta color={Ghost.danger}>{errorMessage(perks.error)}</Meta>
      </View>
    )
  }
  const columns = perks.data?.columns ?? []
  if (perks.isSuccess && columns.length === 0) return null
  return (
    <View style={styles.section}>
      <Mono>PERK RATINGS</Mono>
      <Meta style={{ lineHeight: 18 }}>
        Cleanup keeps your best PvE and best PvP copy of {perks.data?.weapon ?? "this weapon"}. Tap
        to change what counts as good.
      </Meta>
      {perks.isPending ? <Meta color={Ghost.dim}>Loading…</Meta> : null}
      {columns.map((column, index) => (
        <View key={index} style={{ gap: 2 }}>
          <Mono size={10} style={{ paddingTop: 6 }}>
            COLUMN {index + 1}
          </Mono>
          {column.map((perk) => (
            <PerkRow key={perk.name} perk={perk} itemId={itemId} />
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, gap: 10 },
  perk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  chip: { paddingVertical: 4, paddingHorizontal: 9, borderWidth: 1, borderColor: Ghost.ruleStrong },
  chipOn: { backgroundColor: Ghost.good, borderColor: Ghost.good },
})
