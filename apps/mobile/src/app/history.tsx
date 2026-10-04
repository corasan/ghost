import type { Job } from "@ghost/contract"
import { router } from "expo-router"
import { ScrollView, StyleSheet, View } from "react-native"
import { Body, Button, Divider, Header, Loading, Mono } from "@/components/ui"
import { useJobs } from "@/lib/api"
import { clock, isToday, kindLabel } from "@/lib/format"
import { colors } from "@/theme"

// 07 · Ghost › History. Every request Ghost handled, newest first, with what
// it did. Undo is not wired yet: the server does not journal the individual
// Bungie calls a job made, so there is nothing to reverse from here.
export default function HistoryScreen() {
  const jobs = useJobs()
  if (jobs.isPending) return <Loading label="Loading history" />

  const list = [...(jobs.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const today = list.filter((j) => isToday(j.createdAt)).length

  return (
    <View style={{ flex: 1 }}>
      <Header
        eyebrow="‹ GHOST"
        title="History"
        onPressEyebrow={() => router.back()}
        right={<Mono style={{ paddingBottom: 6 }}>{today} ACTIONS · TODAY</Mono>}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 22,
          paddingBottom: 32,
          gap: 20,
        }}
      >
        {list.length === 0 ? (
          <Body size={13} color={colors.dim} style={{ textAlign: "center", paddingTop: 40 }}>
            No requests yet.
          </Body>
        ) : (
          list.map((job, index) => (
            <View key={job.id} style={{ gap: 20 }}>
              <Entry job={job} />
              {index < list.length - 1 ? <Divider /> : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

function Entry({ job }: { job: Job }) {
  const dot =
    job.status === "done" ? colors.green : job.status === "failed" ? colors.red : colors.dim
  const tag =
    job.status === "done" ? "OK" : job.status === "failed" ? "FAILED" : job.status.toUpperCase()
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Body size={15} weight="medium" numberOfLines={2} style={{ flex: 1 }}>
          “{job.prompt}”
        </Body>
        <Mono color={colors.muted} tracking={0}>
          {clock(job.createdAt)}
        </Mono>
      </View>
      <View style={styles.timeline}>
        <View style={styles.line}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <Body size={13} color={colors.text2} style={{ flex: 1 }}>
            {kindLabel[job.kind]}
          </Body>
          <Mono color={dot} tracking={0}>
            {tag}
          </Mono>
        </View>
        {job.status === "done" && job.result ? (
          <Body size={12} color={colors.dim} numberOfLines={3}>
            {job.result}
          </Body>
        ) : null}
        {job.status === "failed" && job.error ? (
          <Body size={12} color={colors.red} numberOfLines={3}>
            {job.error}
          </Body>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
        <Button label="↶ Undo" flex={0} disabled />
        <Mono size={9} color={colors.muted} style={{ alignSelf: "center" }}>
          UNDO · NOT WIRED YET
        </Mono>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  timeline: {
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.12)",
    marginLeft: 5,
    paddingLeft: 16,
    gap: 8,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { position: "absolute", left: -19.5, width: 6, height: 6, borderRadius: 3 },
})
