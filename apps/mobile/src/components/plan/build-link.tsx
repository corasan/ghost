import type { InGameState, SavedBuild } from '@ghost/contract'
import { router } from 'expo-router'
import { Alert, StyleSheet, View } from 'react-native'

import { Body, Button } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { errorMessage, useLinkBuild, useUnlinkBuild } from '@/lib/api'

/** `unchecked`: linked, but Bungie couldn't be reached to compare. */
type LinkStatus = 'unlinked' | 'unchecked' | InGameState

type LinkMove = 'link' | 'update' | 'save' | 'unlink'

interface LinkAction {
  readonly move: LinkMove
  readonly confirm?: { readonly title: string; readonly message: string }
}

const LABEL: Record<LinkMove, string> = {
  link: 'LINK SLOT',
  update: 'UPDATE BUILD',
  save: 'SAVE TO SLOT',
  unlink: 'UNLINK',
}

const overwriteGame: LinkAction = {
  move: 'save',
  confirm: {
    title: 'Save over the slot?',
    message: 'What changed in the slot in game is overwritten with this build.',
  },
}

const LINK: Record<
  LinkStatus,
  { message: (slot: number) => string; color: string; actions: readonly LinkAction[] }
> = {
  unlinked: {
    message: () => 'Not linked to an in-game loadout slot.',
    color: Ghost.dim,
    actions: [{ move: 'link' }],
  },
  unchecked: {
    message: (slot) => `Linked to slot ${slot}.`,
    color: Ghost.dim,
    actions: [{ move: 'unlink' }],
  },
  synced: {
    message: (slot) => `Linked to slot ${slot}.`,
    color: Ghost.muted,
    actions: [{ move: 'unlink' }],
  },
  game_changed: {
    message: (slot) => `Slot ${slot} changed in game.`,
    color: Ghost.gold,
    actions: [{ move: 'update' }, overwriteGame, { move: 'unlink' }],
  },
  build_changed: {
    message: (slot) => `You edited this build since slot ${slot} was saved.`,
    color: Ghost.gold,
    actions: [{ move: 'save' }, { move: 'unlink' }],
  },
  diverged: {
    message: (slot) => `Slot ${slot} and this build both changed.`,
    color: Ghost.gold,
    actions: [
      {
        move: 'update',
        confirm: {
          title: 'Take the slot’s gear?',
          message: 'Your edits to this build in Ghost are replaced with the slot’s gear.',
        },
      },
      overwriteGame,
      { move: 'unlink' },
    ],
  },
  cleared: {
    message: (slot) => `Slot ${slot} was cleared in game.`,
    color: Ghost.gold,
    actions: [{ move: 'save' }, { move: 'unlink' }],
  },
}

const linkStatus = (build: SavedBuild): LinkStatus =>
  build.inGame === null ? 'unlinked' : (build.readiness?.inGame ?? 'unchecked')

export function BuildLink({ build }: { build: SavedBuild }) {
  const link = useLinkBuild()
  const unlink = useUnlinkBuild()
  const view = LINK[linkStatus(build)]
  const slot = build.inGame
  const busy = link.isPending || unlink.isPending
  const error = link.error ?? unlink.error

  const perform = (move: LinkMove) => {
    switch (move) {
      case 'link':
      case 'save':
        return router.push({ pathname: '/save-build', params: { buildId: build.id } })
      case 'update':
        return slot
          ? link.mutate({ id: build.id, characterId: slot.characterId, index: slot.index })
          : undefined
      case 'unlink':
        return unlink.mutate(build.id)
    }
  }

  const press = ({ move, confirm }: LinkAction) =>
    confirm
      ? Alert.alert(confirm.title, confirm.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: LABEL[move], style: 'destructive', onPress: () => perform(move) },
        ])
      : perform(move)

  return (
    <View style={{ gap: 8 }}>
      <Body size={13} color={view.color} style={{ lineHeight: 18 }}>
        {view.message((slot?.index ?? 0) + 1)}
      </Body>
      {error ? (
        <Body size={13} color={Ghost.danger}>
          {errorMessage(error)}
        </Body>
      ) : null}
      <View style={styles.buttons}>
        {view.actions.map((action) => (
          <Button
            key={action.move}
            label={LABEL[action.move]}
            compact
            under={Ghost.panel}
            tone={action.move === 'unlink' ? 'outline' : 'accent'}
            disabled={busy}
            onPress={() => press(action)}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 8 },
})
