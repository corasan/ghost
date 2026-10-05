import type { DamageType, GuardianClass, ItemTier } from "@ghost/contract"
import { router } from "expo-router"
import { useMemo } from "react"
import { ScrollView, StyleSheet, View } from "react-native"

import { Button, Chip, Cond, Mono } from "@/components/ghost/ui"
import { ELEMENT_TONE, Ghost, Rarity } from "@/constants/theme"
import { useVault } from "@/lib/api"
import { upper } from "@/lib/format"
import {
  activeFilters,
  type Category,
  type Flag,
  filterVault,
  flagCounts,
  SORT_LABEL,
  type Sort,
  toggle,
} from "@/lib/vault-filter"
import { resetVaultFilter, setVaultFilter, useVaultFilter } from "@/lib/vault-store"
import { useBottomInset } from "@/lib/insets"

const CATEGORIES: readonly Category[] = ["all", "weapons", "armor"]
const SORTS: readonly Sort[] = ["power", "newest", "stats", "name"]
const TIERS: readonly ItemTier[] = ["exotic", "legendary", "rare"]
const ELEMENTS: readonly DamageType[] = ["kinetic", "arc", "solar", "void", "stasis", "strand"]
const CLASSES: readonly GuardianClass[] = ["hunter", "titan", "warlock"]
const FLAGS: readonly Flag[] = ["dupes", "junk", "new", "unlocked"]

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Mono>{label}</Mono>
      <View style={styles.wrap}>{children}</View>
    </View>
  )
}

/** Every way to narrow and order the vault, in a sheet so the list keeps the screen. */
export default function VaultFilterScreen() {
  const bottomInset = useBottomInset()
  const filter = useVaultFilter()
  const items = useVault().data?.items ?? []
  const counts = useMemo(() => flagCounts(items, filter.category), [items, filter.category])
  const shown = useMemo(() => filterVault(items, filter).length, [items, filter])
  const narrowed = activeFilters(filter).length > 0

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 28, gap: 22 }}>
        <Cond size={24} style={{ letterSpacing: 0.5 }}>
          FILTER & SORT
        </Cond>
        <Group label="SORT BY">
          {SORTS.map((sort) => (
            <Chip
              key={sort}
              label={SORT_LABEL[sort]}
              active={filter.sort === sort}
              onPress={() => setVaultFilter({ sort })}
            />
          ))}
        </Group>
        <Group label="SHOW">
          {CATEGORIES.map((category) => (
            <Chip
              key={category}
              label={upper(category)}
              active={filter.category === category}
              onPress={() => setVaultFilter({ category })}
            />
          ))}
        </Group>
        <Group label="RARITY">
          {TIERS.map((tier) => (
            <Chip
              key={tier}
              label={upper(tier)}
              tone={Rarity[tier]}
              active={filter.tiers.has(tier)}
              onPress={() => setVaultFilter({ tiers: toggle(filter.tiers, tier) })}
            />
          ))}
        </Group>
        <Group label="ELEMENT">
          {ELEMENTS.map((element) => (
            <Chip
              key={element}
              label={upper(element)}
              tone={ELEMENT_TONE[element]}
              active={filter.elements.has(element)}
              onPress={() => setVaultFilter({ elements: toggle(filter.elements, element) })}
            />
          ))}
        </Group>
        <Group label="ARMOR FOR">
          {CLASSES.map((each) => (
            <Chip
              key={each}
              label={upper(each)}
              active={filter.classes.has(each)}
              onPress={() => setVaultFilter({ classes: toggle(filter.classes, each) })}
            />
          ))}
        </Group>
        <Group label="ONLY">
          {FLAGS.map((flag) => (
            <Chip
              key={flag}
              label={`${upper(flag)} ${counts[flag]}`}
              active={filter.flags.has(flag)}
              onPress={() => setVaultFilter({ flags: toggle(filter.flags, flag) })}
            />
          ))}
        </Group>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
        <Button
          label="RESET"
          flex={0.6}
          under={Ghost.panel}
          disabled={!narrowed}
          onPress={resetVaultFilter}
        />
        <Button
          label={`SHOW ${shown}`}
          tone="solid"
          under={Ghost.panel}
          onPress={() => router.back()}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  footer: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Ghost.panel,
    borderTopWidth: 1,
    borderTopColor: Ghost.line,
  },
})
