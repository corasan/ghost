import type { SavedBuild } from "@ghost/contract"
import { LegendList } from "@legendapp/list/react-native"
import { router } from "expo-router"
import { useMemo } from "react"
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native"

import { BuildBadges } from "@/components/plan/build-badges"
import { ItemIcon } from "@/components/ghost/item-icon"
import { SubclassMark } from "@/components/ghost/subclass-mark"
import { Body, Chip, Cond, Cut, Meta, PageHeader } from "@/components/ghost/ui"
import { Ghost, Gutter, Type } from "@/constants/theme"
import { errorMessage, useSavedBuilds } from "@/lib/api"
import { activeFilters, BUILD_SORT_LABEL, filterBuilds, removeFilter } from "@/lib/build-filter"
import { replaceBuildFilter, setBuildFilter, useBuildFilter } from "@/lib/build-store"
import { sentence } from "@/lib/format"
import { useBottomInset } from "@/lib/insets"
import { usePullRefresh } from "@/lib/refresh"

const exoticArmorRow = (build: SavedBuild) =>
  build.plan.rows.find((row) => row.tier === "exotic" && row.name === build.facets.exoticArmor)

function BuildRow({ build }: { build: SavedBuild }) {
  const { facets } = build
  const armor = exoticArmorRow(build)
  const exotics = [facets.exoticArmor, facets.exoticWeapon].filter((name) => name !== null)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the saved build"
      onPress={() => router.push({ pathname: "/build/[id]", params: { id: build.id } })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: Ghost.panel }]}
    >
      {armor ? (
        <ItemIcon icon={armor.icon} size={48} gearTier={armor.gearTier} />
      ) : (
        <View style={styles.mark}>
          <SubclassMark
            loadout={build.plan.loadout ?? { icon: null, element: facets.element }}
            size={32}
          />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Body size={15} style={{ fontFamily: Type.bodyMedium }} lines={1}>
          {build.name}
        </Body>
        <Meta lines={1}>
          {[sentence(facets.classType), facets.subclass ?? sentence(facets.element)].join(" · ")}
        </Meta>
        {exotics.length > 0 ? (
          <Meta color={Ghost.gold} lines={1}>
            {exotics.join(" · ")}
          </Meta>
        ) : null}
        <BuildBadges build={build} />
      </View>
      {armor && build.plan.loadout ? <SubclassMark loadout={build.plan.loadout} size={28} /> : null}
    </Pressable>
  )
}

function Filters({ shown }: { shown: number }) {
  const filter = useBuildFilter()
  const active = activeFilters(filter)
  return (
    <View style={{ paddingTop: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: Gutter }}>
        <Cut fill={Ghost.panel} border={Ghost.line} style={{ flex: 1 }}>
          <TextInput
            value={filter.query}
            onChangeText={(query) => setBuildFilter({ query })}
            placeholder="Name, exotic, weapon or activity"
            placeholderTextColor={Ghost.dim}
            keyboardAppearance="dark"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.search}
          />
        </Cut>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filter and sort, ${active.length} filters on, sorted by ${BUILD_SORT_LABEL[filter.sort]}`}
          onPress={() => router.push("/build-filter")}
          style={[styles.filter, active.length > 0 && { borderColor: Ghost.accent }]}
        >
          <Meta size={12} color={active.length > 0 ? Ghost.accent : Ghost.muted}>
            {active.length > 0 ? `Filter · ${active.length}` : "Filter"}
          </Meta>
          <Cond size={13}>{BUILD_SORT_LABEL[filter.sort]}</Cond>
        </Pressable>
      </View>
      {active.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: Gutter, alignItems: "center" }}
        >
          {active.map((each) => (
            <Chip
              key={each.id}
              label={`${each.label} ×`}
              active
              onPress={() => replaceBuildFilter(removeFilter(filter, each.id))}
            />
          ))}
          <Meta style={{ marginLeft: 6 }}>{shown} shown</Meta>
        </ScrollView>
      ) : null}
    </View>
  )
}

export default function BuildsScreen() {
  const bottomInset = useBottomInset()
  const builds = useSavedBuilds()
  const filter = useBuildFilter()
  const pull = usePullRefresh(builds.refetch)
  const all = builds.data ?? []
  const shown = useMemo(() => filterBuilds(all, filter), [all, filter])
  const inGame = all.filter((build) => build.inGame !== null).length

  return (
    <View style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <PageHeader
        title="BUILDS"
        subtitle={builds.data ? `${shown.length} shown` : "Saved builds"}
        figure={builds.data ? all.length : "—"}
        caption={builds.data ? `${inGame} in game` : "Saved"}
      />
      {!builds.data ? (
        <Body
          color={builds.isError ? Ghost.danger : Ghost.dim}
          style={{ paddingHorizontal: Gutter, paddingTop: 32 }}
        >
          {builds.isError ? `Couldn't load your builds: ${errorMessage(builds.error)}` : "Loading…"}
        </Body>
      ) : all.length === 0 ? (
        <Body color={Ghost.dim} style={{ paddingHorizontal: Gutter, paddingTop: 32 }}>
          No saved builds yet. Ask Ghost for a build, then tap SAVE on its plan.
        </Body>
      ) : (
        <>
          <Filters shown={shown.length} />
          <LegendList
            style={{ flex: 1 }}
            data={shown}
            keyExtractor={(build) => build.id}
            recycleItems
            estimatedItemSize={92}
            keyboardDismissMode="on-drag"
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomInset + 16 }}
            ListEmptyComponent={
              <Body color={Ghost.dim} style={{ paddingHorizontal: Gutter, paddingTop: 24 }}>
                Nothing matches. Loosen a filter or clear the search.
              </Body>
            }
            renderItem={({ item }) => (
              <View style={{ paddingHorizontal: Gutter }}>
                <BuildRow build={item} />
              </View>
            )}
          />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  search: {
    height: 40,
    paddingHorizontal: 12,
    fontFamily: Type.body,
    fontSize: 15,
    color: Ghost.ink,
  },
  filter: {
    borderWidth: 1,
    borderColor: Ghost.ruleStrong,
    paddingHorizontal: 10,
    justifyContent: "center",
    minWidth: 92,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Ghost.rule,
  },
  mark: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
})
