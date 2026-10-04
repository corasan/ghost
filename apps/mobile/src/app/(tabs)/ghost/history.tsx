import type { Job } from "@ghost/contract"
import { router, Stack } from "expo-router"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"

import { Mono } from "@/components/ghost/ui"
import { Ghost, Type } from "@/constants/theme"
import { useJobs } from "@/lib/api"
import { clock, kindLabel } from "@/lib/format"

const outcome: Record<Job["status"], { label: string; color: string }> = {
  queued: { label: "QUEUED", color: Ghost.muted },
  running: { label: "RUNNING", color: Ghost.accent },
  done: { label: "OK", color: Ghost.good },
  failed: { label: "FAILED", color: Ghost.danger },
}

export default function HistoryScreen() {
  const jobs = useJobs()
  const requests = jobs.data ?? []

  return (
    <>
      <Stack.Screen options={{ title: "History" }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, paddingTop: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={jobs.isRefetching}
            onRefresh={() => void jobs.refetch()}
            tintColor={Ghost.muted}
          />
        }
      >
        {requests.length === 0 ? (
          <Text style={styles.empty}>
            {jobs.isPending
              ? "Loading…"
              : jobs.isError
                ? "Can't reach the Ghost server."
                : "Nothing yet. Everything you ask Ghost to do is logged here."}
          </Text>
        ) : null}
        {requests.map((job, index) => {
          const { label, color } = outcome[job.status]
          return (
            <View key={job.id} style={[styles.group, index > 0 && styles.divided]}>
              <View style={styles.between}>
                <Text numberOfLines={1} style={styles.prompt}>
                  “{job.prompt}”
                </Text>
                <Mono color={Ghost.dim} style={{ letterSpacing: 0 }}>
                  {clock(job.createdAt)}
                </Mono>
              </View>
              <View style={styles.steps}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <View style={styles.between}>
                  <Text style={styles.step}>{kindLabel[job.kind]}</Text>
                  <Mono color={color}>{label}</Mono>
                </View>
              </View>
              <Pressable style={styles.details} onPress={() => router.push(`/jobs/${job.id}`)}>
                <Text style={{ fontFamily: Type.regular, fontSize: 13, color: Ghost.text }}>
                  Details
                </Text>
              </Pressable>
            </View>
          )
        })}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  empty: { fontFamily: Type.light, fontSize: 14, lineHeight: 21, color: Ghost.muted },
  group: { gap: 8, paddingBottom: 20 },
  divided: { borderTopWidth: 1, borderTopColor: Ghost.line, paddingTop: 20 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  prompt: { flex: 1, fontFamily: Type.medium, fontSize: 15, color: Ghost.text },
  steps: {
    marginLeft: 5,
    paddingLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.12)",
  },
  dot: { position: "absolute", left: -3.5, top: 6, width: 6, height: 6, borderRadius: 3 },
  step: { fontFamily: Type.regular, fontSize: 13, color: Ghost.textSoft },
  details: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Ghost.lineStrong,
  },
})
