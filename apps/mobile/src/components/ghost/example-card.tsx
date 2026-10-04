import { StyleSheet, Text, View } from "react-native"

import { Ghost, Rarity, Type } from "@/constants/theme"
import type { Example, PlanRow } from "@/lib/sample"
import { ActionButton, Check, Mono, StatRow, Swatch } from "./ui"

function Row({ row, check, side }: { row: PlanRow; check?: boolean; side: string }) {
  return (
    <View style={[styles.row, row.held && { opacity: 0.45 }]}>
      {check ? <Check on={!row.held} /> : null}
      <Swatch rarity={row.rarity} size={36} bar />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{row.name}</Text>
        <Mono size={9}>{row.meta}</Mono>
      </View>
      <Mono color={Ghost.dim}>{side}</Mono>
    </View>
  )
}

function Actions({ labels }: { labels: readonly [string, string] }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <ActionButton label={labels[0]} />
      <ActionButton label={labels[1]} tone="accent" flex={1.4} />
    </View>
  )
}

// The structured answer Ghost gives for a request: a build plan, a ranked
// weapon roll, or a transfer plan.
export function ExampleCard({ example }: { example: Example }) {
  if (example.kind === "roll") {
    const { best } = example
    const tone = Rarity[best.rarity].color
    return (
      <View style={{ gap: 8 }}>
        <View style={[styles.card, { overflow: "hidden" }]}>
          <View style={{ height: 3, backgroundColor: tone }} />
          <View style={{ flexDirection: "row", gap: 12, padding: 12 }}>
            <Swatch rarity={best.rarity} size={64} />
            <View style={{ flex: 1 }}>
              <View style={styles.between}>
                <Text style={styles.bestName}>{best.name}</Text>
                <Mono size={12} color={Ghost.good} style={{ letterSpacing: 0 }}>
                  ROLL {best.score}
                </Mono>
              </View>
              <Mono color={tone} style={{ marginTop: 2 }}>
                {best.meta}
              </Mono>
              <View style={styles.perks}>
                {best.perks.map((perk) => (
                  <Text
                    key={perk.name}
                    style={[
                      styles.perk,
                      perk.hit && { borderColor: Ghost.good, color: Ghost.good },
                    ]}
                  >
                    {perk.name}
                  </Text>
                ))}
              </View>
            </View>
          </View>
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6 }}>
            {best.bars.map((bar) => (
              <View key={bar.label} style={styles.bar}>
                <Mono size={9} style={{ width: 52 }}>
                  {bar.label}
                </Mono>
                <View style={styles.track}>
                  <View
                    style={{
                      width: `${bar.value}%`,
                      height: 4,
                      backgroundColor: Ghost.accent,
                      opacity: bar.hit ? 1 : 0.6,
                    }}
                  />
                </View>
                <Mono size={9} color={Ghost.text} style={{ width: 28, textAlign: "right" }}>
                  {bar.value}
                </Mono>
              </View>
            ))}
          </View>
          <View style={styles.split}>
            <Text style={[styles.splitText, { color: Ghost.muted }]}>{example.actions[0]}</Text>
            <View style={{ width: 1, backgroundColor: Ghost.line }} />
            <Text style={[styles.splitText, { color: Ghost.accent, fontFamily: Type.semibold }]}>
              {example.actions[1]}
            </Text>
          </View>
        </View>
        {example.rest.map((row) => (
          <View key={row.name} style={[styles.card, { paddingHorizontal: 14, borderRadius: 10 }]}>
            <Row row={row} side={`ROLL ${row.score}`} />
          </View>
        ))}
      </View>
    )
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.card, styles.plan]}>
        <View style={[styles.between, { paddingVertical: 8 }]}>
          <Mono color={Ghost.accent}>{example.title}</Mono>
          <Mono color={Ghost.dim}>{example.aside}</Mono>
        </View>
        {example.kind === "build" ? (
          <View style={{ paddingBottom: 12 }}>
            <StatRow stats={example.stats} size={16} />
          </View>
        ) : null}
        {example.rows.map((row) => (
          <View key={row.name} style={styles.ruled}>
            <Row row={row} check side={row.side} />
          </View>
        ))}
        <View style={[styles.ruled, { paddingVertical: 10 }]}>
          {example.kind === "build" ? (
            <Text style={styles.note}>{example.note}</Text>
          ) : (
            <Mono color={Ghost.dim}>{example.more}</Mono>
          )}
        </View>
        <Actions labels={example.actions} />
      </View>
      {example.kind === "plan" ? (
        <Text style={[styles.note, { color: Ghost.dim, paddingHorizontal: 4 }]}>
          {example.note}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: Ghost.card, borderWidth: 1, borderColor: Ghost.line, borderRadius: 12 },
  plan: { borderColor: Ghost.accentLine, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  ruled: { borderTopWidth: 1, borderTopColor: Ghost.line },
  name: { fontFamily: Type.regular, fontSize: 14, color: Ghost.text },
  bestName: { fontFamily: Type.semibold, fontSize: 16, color: Ghost.text },
  perks: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  perk: {
    fontFamily: Type.regular,
    fontSize: 11,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Ghost.lineStrong,
    color: Ghost.textSoft,
  },
  bar: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Ghost.bg, overflow: "hidden" },
  split: { flexDirection: "row", borderTopWidth: 1, borderTopColor: Ghost.line },
  splitText: { flex: 1, padding: 11, textAlign: "center", fontFamily: Type.regular, fontSize: 14 },
  note: { fontFamily: Type.regular, fontSize: 12, lineHeight: 17, color: Ghost.muted },
})
