import type { ItemSummary } from "@ghost/contract"
import { View } from "react-native"

import { Cond, Mono, Swatch } from "@/components/ghost/ui"
import { Ghost, Rarity } from "@/constants/theme"
import { useCharacter } from "@/lib/character"
import { upper } from "@/lib/format"

function useWhere(item: ItemSummary) {
  const { characters } = useCharacter()
  const owner = characters.find((each) => each.characterId === item.characterId)
  const who = owner ? upper(owner.classType) : "CHARACTER"
  if (item.location === "vault") return "IN VAULT"
  if (item.location === "postmaster") return `POSTMASTER · ${who}`
  return item.equipped ? `EQUIPPED ON ${who}` : `ON ${who}`
}

export function ItemHeader({ item, size = 64 }: { item: ItemSummary; size?: number }) {
  const where = useWhere(item)
  const kind = [item.tier, item.typeName, item.damageType === "none" ? null : item.damageType]
    .filter(Boolean)
    .map((part) => upper(String(part)))
    .join(" · ")
  const tags = [
    item.locked ? "LOCKED" : null,
    item.masterwork ? "MASTERWORK" : null,
    item.duplicates > 0 ? `${item.duplicates + 1} COPIES` : null,
    item.decision ? upper(item.decision) : null,
  ].filter(Boolean)
  return (
    <View style={{ flexDirection: "row", gap: 14, paddingHorizontal: 20 }}>
      <Swatch tier={item.tier} icon={item.icon} size={size} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Cond size={24} style={{ letterSpacing: 0.5, flexShrink: 1, lineHeight: 26 }} lines={2}>
            {upper(item.name)}
          </Cond>
          <Cond size={24} color={Ghost.gold} style={{ letterSpacing: 0, lineHeight: 26 }}>
            {item.power ?? ""}
          </Cond>
        </View>
        <Mono color={Rarity[item.tier]} style={{ marginTop: 5 }} lines={1}>
          {kind}
        </Mono>
        <Mono style={{ marginTop: 5 }} lines={1}>
          {[where, ...tags].join(" · ")}
        </Mono>
      </View>
    </View>
  )
}
