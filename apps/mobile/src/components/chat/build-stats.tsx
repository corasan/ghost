import type { PlanStat } from "@ghost/contract"
import { StyleSheet, View } from "react-native"

import { Body, Cond, Diamond, Mono } from "@/components/ghost/ui"
import { Ghost } from "@/constants/theme"
import { change, orderBuildStats } from "@/lib/build-order"

const signed = (delta: number) => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`)

function StatRow({ stat }: { stat: PlanStat }) {
  const delta = change(stat)
  const explained = stat.effect !== undefined && (stat.target || delta > 0)
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <View style={styles.name}>
          {stat.target ? <Diamond size={5} /> : null}
          <Cond size={15} color={stat.target || delta !== 0 ? Ghost.ink : Ghost.muted}>
            {stat.label}
          </Cond>
        </View>
        <View style={styles.numbers}>
          {delta !== 0 ? <Mono size={10}>{stat.before} ›</Mono> : null}
          <Cond
            size={20}
            color={stat.target ? Ghost.good : Ghost.ink}
            style={{ letterSpacing: 0, lineHeight: 20 }}
          >
            {stat.value}
          </Cond>
          <View style={styles.delta}>
            {delta !== 0 ? (
              <Mono size={10} color={delta > 0 ? Ghost.good : Ghost.danger}>
                {signed(delta)}
              </Mono>
            ) : null}
          </View>
          <View style={styles.masterwork}>
            {stat.masterworked !== undefined ? (
              <Mono size={10} color={Ghost.gold}>
                {stat.masterworked} MW
              </Mono>
            ) : null}
          </View>
        </View>
      </View>
      {explained ? (
        <Body size={12} color={Ghost.muted} style={{ lineHeight: 16, marginTop: 4 }}>
          {stat.effect}
        </Body>
      ) : null}
    </View>
  )
}

/**
 * A build at a glance: each of the six stats as it is now, with the build
 * on, and with every piece masterworked, plus what the stats it improves do.
 */
export function BuildStats({ stats }: { stats: readonly PlanStat[] }) {
  const pending = stats.some((stat) => stat.masterworked !== undefined)
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
      <View style={[styles.line, { paddingBottom: 6 }]}>
        <Mono>BUILD STATS</Mono>
        <Mono>{pending ? "NOW › WITH BUILD · MASTERWORKED" : "NOW › WITH BUILD"}</Mono>
      </View>
      {orderBuildStats(stats).map((stat) => (
        <StatRow key={stat.label} stat={stat} />
      ))}
    </View>
  )
}

/**
 * The build in one line for the chat: each stat's value with the build on
 * and how far it moves. The full breakdown lives in the details sheet.
 */
export function BuildStrip({ stats }: { stats: readonly PlanStat[] }) {
  return (
    <View style={styles.strip}>
      {stats.map((stat) => {
        const delta = change(stat)
        return (
          <View key={stat.label} style={{ flex: 1 }}>
            <Cond
              size={18}
              color={stat.target ? Ghost.good : Ghost.ink}
              style={{ letterSpacing: 0, lineHeight: 18 }}
            >
              {stat.value}
            </Cond>
            <Mono size={7} style={{ marginTop: 3 }} lines={1}>
              {stat.label}
            </Mono>
            <Mono
              size={8}
              color={delta > 0 ? Ghost.good : delta < 0 ? Ghost.danger : Ghost.dim}
              style={{ marginTop: 3 }}
            >
              {delta === 0 ? "—" : signed(delta)}
            </Mono>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", paddingHorizontal: 14, paddingBottom: 12 },
  row: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: Ghost.rule },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { flexDirection: "row", alignItems: "center", gap: 7 },
  numbers: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  delta: { width: 30, alignItems: "flex-end" },
  masterwork: { width: 52, alignItems: "flex-end" },
})
