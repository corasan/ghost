import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button, Chip, Cond, Mono } from '@/components/ghost/ui'
import { ELEMENT_TONE, Ghost } from '@/constants/theme'
import { useSavedBuilds } from '@/lib/api'
import {
  activeFilters,
  BUILD_SORT_LABEL,
  type BuildSort,
  type BuildState,
  type BuildWhere,
  facetOptions,
  filterBuilds,
  STATE_LABEL,
  WHERE_LABEL,
} from '@/lib/build-filter'
import { resetBuildFilter, setBuildFilter, useBuildFilter } from '@/lib/build-store'
import { upper } from '@/lib/format'
import { useBottomInset } from '@/lib/insets'
import { toggle } from '@/lib/vault-filter'

const SORTS: readonly BuildSort[] = ['newest', 'name', 'class']
const WHERE: readonly BuildWhere[] = ['all', 'in_game', 'ghost_only']
const STATES: readonly BuildState[] = ['all', 'ready', 'missing_items', 'past_artifact']

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Mono>{label}</Mono>
      <View style={styles.wrap}>{children}</View>
    </View>
  )
}

export default function BuildFilterScreen() {
  const bottomInset = useBottomInset()
  const filter = useBuildFilter()
  const builds = useSavedBuilds().data ?? []
  const options = useMemo(() => facetOptions(builds), [builds])
  const shown = useMemo(() => filterBuilds(builds, filter).length, [builds, filter])
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
              label={BUILD_SORT_LABEL[sort]}
              active={filter.sort === sort}
              onPress={() => setBuildFilter({ sort })}
            />
          ))}
        </Group>
        <Group label="SAVED">
          {WHERE.map((where) => (
            <Chip
              key={where}
              label={WHERE_LABEL[where]}
              active={filter.where === where}
              onPress={() => setBuildFilter({ where })}
            />
          ))}
        </Group>
        <Group label="READY">
          {STATES.map((state) => (
            <Chip
              key={state}
              label={STATE_LABEL[state]}
              active={filter.state === state}
              onPress={() => setBuildFilter({ state })}
            />
          ))}
        </Group>
        {options.classes.length > 1 ? (
          <Group label="CLASS">
            {options.classes.map(({ value, count }) => (
              <Chip
                key={value}
                label={`${upper(value)} ${count}`}
                active={filter.classes.has(value)}
                onPress={() => setBuildFilter({ classes: toggle(filter.classes, value) })}
              />
            ))}
          </Group>
        ) : null}
        {options.elements.length > 1 ? (
          <Group label="ELEMENT">
            {options.elements.map(({ value, count }) => (
              <Chip
                key={value}
                label={`${upper(value)} ${count}`}
                tone={ELEMENT_TONE[value]}
                active={filter.elements.has(value)}
                onPress={() => setBuildFilter({ elements: toggle(filter.elements, value) })}
              />
            ))}
          </Group>
        ) : null}
        {options.exotics.length > 0 ? (
          <Group label="EXOTIC">
            {options.exotics.map(({ value, count }) => (
              <Chip
                key={value}
                label={`${upper(value)} ${count}`}
                active={filter.exotics.has(value)}
                onPress={() => setBuildFilter({ exotics: toggle(filter.exotics, value) })}
              />
            ))}
          </Group>
        ) : null}
        {options.weaponTypes.length > 0 ? (
          <Group label="WEAPON TYPE">
            {options.weaponTypes.map(({ value, count }) => (
              <Chip
                key={value}
                label={`${upper(value)} ${count}`}
                active={filter.weaponTypes.has(value)}
                onPress={() => setBuildFilter({ weaponTypes: toggle(filter.weaponTypes, value) })}
              />
            ))}
          </Group>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
        <Button
          label="RESET"
          flex={0.6}
          under={Ghost.panel}
          disabled={!narrowed}
          onPress={resetBuildFilter}
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Ghost.panel,
    borderTopWidth: 1,
    borderTopColor: Ghost.line,
  },
})
