import type { SavedBuild } from '@ghost/contract'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BuildBadges } from '@/components/plan/build-badges'
import { BuildSections } from '@/components/plan/build-sections'
import { Body, Button, Cut, Meta } from '@/components/ghost/ui'
import { Ghost, Gutter, Type } from '@/constants/theme'
import {
  errorMessage,
  useDeleteBuild,
  useEquipBuild,
  useRenameBuild,
  useSavedBuilds,
} from '@/lib/api'
import { useWearer } from '@/lib/character'
import { sentence } from '@/lib/format'
import { useFooterHeight } from '@/lib/footer'
import { useBottomInset } from '@/lib/insets'

function Readiness({ build }: { build: SavedBuild }) {
  const readiness = build.readiness
  const lines = [
    readiness && readiness.missing.length > 0
      ? { text: `No longer owned: ${readiness.missing.join(', ')}.`, color: Ghost.danger }
      : null,
    readiness?.pastArtifact
      ? {
          text: "Its artifact picks are from a past season's artifact, so they won't carry over.",
          color: Ghost.gold,
        }
      : null,
    readiness?.inGame === 'changed'
      ? { text: 'Its in-game slot has been changed since Ghost saved it.', color: Ghost.gold }
      : null,
    readiness?.inGame === 'cleared'
      ? { text: 'Its in-game slot has been cleared.', color: Ghost.gold }
      : null,
    readiness === null
      ? { text: "Couldn't check it against your items right now.", color: Ghost.dim }
      : null,
  ].filter((line) => line !== null)
  return (
    <View style={{ gap: 6, marginTop: 12 }}>
      {build.plan.purpose ? <Meta>For {build.plan.purpose}</Meta> : null}
      <BuildBadges build={build} />
      {lines.map((line) => (
        <Body key={line.text} size={13} color={line.color} style={{ lineHeight: 18 }}>
          {line.text}
        </Body>
      ))}
    </View>
  )
}

function Rename({ build, onDone }: { build: SavedBuild; onDone: () => void }) {
  const rename = useRenameBuild()
  const [name, setName] = useState(build.name)
  const trimmed = name.trim()
  return (
    <>
      {rename.isError ? (
        <Body size={13} color={Ghost.danger}>
          {errorMessage(rename.error)}
        </Body>
      ) : null}
      <Cut fill={Ghost.bg} border={Ghost.line} under={Ghost.panel}>
        <TextInput
          value={name}
          onChangeText={setName}
          autoFocus
          keyboardAppearance="dark"
          autoCorrect={false}
          returnKeyType="done"
          style={styles.input}
        />
      </Cut>
      <View style={styles.buttons}>
        <Button label="CANCEL" flex={0.6} under={Ghost.panel} onPress={onDone} />
        <Button
          label={rename.isPending ? 'RENAMING…' : 'RENAME'}
          tone="solid"
          under={Ghost.panel}
          disabled={trimmed.length === 0 || trimmed === build.name || rename.isPending}
          onPress={() => rename.mutate({ id: build.id, name: trimmed }, { onSuccess: onDone })}
        />
      </View>
    </>
  )
}

function Actions({ build }: { build: SavedBuild }) {
  const wearer = useWearer(build.facets.classType)
  const equip = useEquipBuild()
  const remove = useDeleteBuild()
  const [renaming, setRenaming] = useState(false)
  if (renaming) return <Rename build={build} onDone={() => setRenaming(false)} />

  const confirmDelete = () =>
    Alert.alert(
      `Delete ${build.name}?`,
      build.inGame
        ? `Ghost forgets it. Its in-game slot ${build.inGame.index + 1} is kept as it is.`
        : 'Ghost forgets it. Nothing changes in game.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => remove.mutate(build.id, { onSuccess: () => router.back() }),
        },
      ],
    )

  const error = equip.error ?? remove.error
  return (
    <>
      {error ? (
        <Body size={13} color={Ghost.danger}>
          {errorMessage(error)}
        </Body>
      ) : wearer ? null : (
        <Meta>No {sentence(build.facets.classType)} on this account to equip it on.</Meta>
      )}
      <View style={styles.buttons}>
        <Button
          label={equip.isPending ? 'WORKING…' : 'EQUIP'}
          tone="solid"
          under={Ghost.panel}
          disabled={wearer === undefined || equip.isPending}
          onPress={() => {
            if (!wearer) return
            equip.mutate(
              { id: build.id, characterId: wearer.characterId },
              {
                onSuccess: ({ job, substituted }) =>
                  router.push({
                    pathname: '/plan/[id]',
                    params:
                      substituted.length > 0
                        ? { id: job.id, substituted: substituted.join('\n') }
                        : { id: job.id },
                  }),
              },
            )
          }}
        />
      </View>
      <View style={styles.buttons}>
        <Button
          label="SAVE IN GAME"
          compact
          under={Ghost.panel}
          disabled={wearer === undefined}
          onPress={() => router.push({ pathname: '/save-build', params: { buildId: build.id } })}
        />
        <Button
          label="RENAME"
          compact
          flex={0.7}
          under={Ghost.panel}
          onPress={() => setRenaming(true)}
        />
        <Button
          label={remove.isPending ? 'DELETING…' : 'DELETE'}
          compact
          flex={0.7}
          tone="danger"
          under={Ghost.panel}
          disabled={remove.isPending}
          onPress={confirmDelete}
        />
      </View>
    </>
  )
}

export default function SavedBuildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const bottomInset = useBottomInset()
  const footer = useFooterHeight()
  const builds = useSavedBuilds()
  const build = builds.data?.find((each) => each.id === id)

  if (!build) {
    return (
      <Body
        color={builds.isError ? Ghost.danger : Ghost.dim}
        style={{ padding: 20, paddingTop: 32 }}
      >
        {builds.isError
          ? `Couldn't load this build: ${errorMessage(builds.error)}`
          : builds.isPending
            ? 'Loading…'
            : 'This build is no longer saved.'}
      </Body>
    )
  }

  return (
    <View collapsable={false} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: footer.height + 28 }]}>
        <BuildSections plan={build.plan} name={build.name} lead={<Readiness build={build} />} />
      </ScrollView>
      <View
        collapsable={false}
        onLayout={footer.onLayout}
        style={[styles.footer, { paddingBottom: bottomInset + 12 }]}
      >
        <Actions build={build} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Gutter, paddingTop: 28 },
  input: {
    height: 44,
    paddingHorizontal: 12,
    fontFamily: Type.body,
    fontSize: 15,
    color: Ghost.ink,
  },
  buttons: { flexDirection: 'row', gap: 8 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Gutter,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
    backgroundColor: Ghost.panel,
  },
})
