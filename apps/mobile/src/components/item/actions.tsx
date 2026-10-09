import type { GuardianCharacter, ItemSummary } from '@ghost/contract'
import { router } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Body, Button, Cond, Meta } from '@/components/ghost/ui'
import { Ghost } from '@/constants/theme'
import { errorMessage, useItemAction, useSetDecision } from '@/lib/api'
import { useCharacter } from '@/lib/character'
import { upper } from '@/lib/format'
import { togglePicked } from '@/lib/vault-store'

const canEquip = (item: ItemSummary, character: GuardianCharacter) =>
  item.slot !== 'other' &&
  (item.classType === null || item.classType === character.classType) &&
  !(item.equipped && item.characterId === character.characterId)

const isOn = (item: ItemSummary, character: GuardianCharacter) =>
  item.location === 'character' && item.characterId === character.characterId

function Action({
  label,
  hint,
  tone = Ghost.ink,
  disabled,
  onPress,
}: {
  label: string
  hint?: string
  tone?: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && { backgroundColor: Ghost.swatch },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Cond size={17} color={tone}>
        {label}
      </Cond>
      {hint ? <Meta>{hint}</Meta> : null}
    </Pressable>
  )
}

/**
 * Everything the player can do to one item. Moves run at once on the server
 * and land in History, where they can be undone.
 */
export function ItemActions({
  item,
  selectable = false,
}: {
  item: ItemSummary
  selectable?: boolean
}) {
  const { characters } = useCharacter()
  const act = useItemAction()
  const decide = useSetDecision()
  const id = item.itemInstanceId
  if (id === null) return null

  const done = { onSuccess: () => router.back() }
  const busy = act.isPending

  return (
    <View>
      {characters.map((character) => (
        <View key={character.characterId} style={styles.character}>
          <View style={{ flex: 1 }}>
            <Cond size={17}>{upper(character.classType)}</Cond>
            <Meta style={{ marginTop: 2 }}>
              {isOn(item, character) ? (item.equipped ? 'Equipped' : 'Carrying') : character.light}
            </Meta>
          </View>
          <View style={{ width: 84, flexDirection: 'row' }}>
            <Button
              label="SEND"
              compact
              under={Ghost.panel}
              disabled={busy || isOn(item, character)}
              onPress={() =>
                act.mutate({ id, action: 'to_character', characterId: character.characterId }, done)
              }
            />
          </View>
          <View style={{ width: 84, flexDirection: 'row' }}>
            <Button
              label="EQUIP"
              tone="accent"
              compact
              under={Ghost.panel}
              disabled={busy || !canEquip(item, character)}
              onPress={() =>
                act.mutate({ id, action: 'equip', characterId: character.characterId }, done)
              }
            />
          </View>
        </View>
      ))}
      {item.location !== 'vault' ? (
        <Action
          label="SEND TO VAULT"
          hint={item.equipped ? 'Unequip first' : undefined}
          disabled={busy || item.equipped}
          onPress={() => act.mutate({ id, action: 'to_vault' }, done)}
        />
      ) : null}
      <Action
        label={item.decision === 'junk' ? 'REMOVE JUNK TAG' : 'TAG AS JUNK'}
        tone={item.decision === 'junk' ? Ghost.ink : Ghost.danger}
        onPress={() => {
          decide.mutate({ id, decision: item.decision === 'junk' ? null : 'junk' })
          router.back()
        }}
      />
      <Action
        label={item.decision === 'keep' ? 'REMOVE KEEP TAG' : 'TAG AS KEEP'}
        onPress={() => {
          decide.mutate({ id, decision: item.decision === 'keep' ? null : 'keep' })
          router.back()
        }}
      />
      <Action
        label="ASK GHOST"
        hint="Is it worth keeping?"
        tone={Ghost.accent}
        onPress={() => {
          router.back()
          router.navigate({
            pathname: '/',
            params: { draft: `Is my ${item.name} worth keeping?` },
          })
        }}
      />
      {selectable ? (
        <Action
          label="SELECT MORE"
          hint="Then ask or junk together"
          onPress={() => {
            togglePicked(id)
            router.back()
          }}
        />
      ) : null}
      {act.isError ? (
        <Body size={13} color={Ghost.danger} style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          {errorMessage(act.error)}
        </Body>
      ) : null}
      {busy ? (
        <Body size={13} color={Ghost.dim} style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          Moving it…
        </Body>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
  character: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: Ghost.rule,
  },
})
