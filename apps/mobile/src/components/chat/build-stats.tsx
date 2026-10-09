import type { PlanStat } from '@ghost/contract'
import { StyleSheet, View } from 'react-native'

import { Body, Cond, Meta, Mono, StatIcon } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { orderBuildStats } from '@/lib/build-order'
import { sentence } from '@/lib/format'

/**
 * The six stats as a table: with the build on, and with every piece
 * masterworked, so the upgrade left is obvious.
 */
export function BuildStats({ stats }: { stats: readonly PlanStat[] }) {
  return (
    <View>
      <View style={[styles.line, { paddingBottom: 6 }]}>
        <Mono style={styles.name}>STATS</Mono>
        <Meta style={styles.cell}>Build</Meta>
        <Meta style={styles.cell}>Masterworked</Meta>
      </View>
      {orderBuildStats(stats).map((stat) => {
        const tone = stat.target ? Ghost.good : Ghost.ink
        return (
          <View key={stat.label} style={[styles.line, styles.row]}>
            <View style={[styles.name, { flexDirection: 'row', alignItems: 'center', gap: 9 }]}>
              <StatIcon
                label={stat.label}
                size={16}
                color={stat.target ? Ghost.good : Ghost.muted}
              />
              <Body size={15} color={tone}>
                {sentence(stat.label)}
              </Body>
            </View>
            <Cond size={18} color={tone} style={[styles.cell, { letterSpacing: 0 }]}>
              {stat.value}
            </Cond>
            <Mono
              size={14}
              color={stat.masterworked === undefined ? Ghost.dim : Ghost.gold}
              style={[styles.cell, { letterSpacing: 0 }]}
            >
              {stat.masterworked ?? '—'}
            </Mono>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { paddingVertical: 5, borderTopWidth: 1, borderTopColor: Ghost.rule },
  name: { flex: 1 },
  cell: { width: 92, textAlign: 'right' },
})
