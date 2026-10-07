import {
  type BungieNotLinked,
  type CleanupNotFound,
  type CleanupPreview,
  CleanupRefused,
  CleanupSession,
  type ItemLocation,
} from "@ghost/contract"
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
  Semaphore,
} from "effect"
import { BungieClient, type BungieError } from "../bungie/client.ts"
import type { Inventory } from "../bungie/inventory.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { ItemsRepo } from "../db/items.ts"
import {
  begin,
  type CleanupCommand,
  command,
  destination,
  keep,
  type Move,
  nextMoves,
  type Outcome,
  plan,
  reconcile,
  settle,
  skip,
  start,
} from "./engine.ts"
import { CleanupRepo } from "./repo.ts"

type CommandErrors = CleanupNotFound | CleanupRefused
type BungieErrors = BungieError | BungieNotLinked

export interface CleanupService {
  readonly preview: (
    characterId: string,
  ) => Effect.Effect<CleanupPreview, CleanupRefused | BungieErrors>
  readonly current: Effect.Effect<CleanupSession | null>
  readonly start: (
    characterId: string,
  ) => Effect.Effect<CleanupSession, CleanupRefused | BungieErrors>
  readonly command: (
    id: string,
    name: CleanupCommand,
  ) => Effect.Effect<CleanupSession, CommandErrors>
  readonly skip: (id: string) => Effect.Effect<CleanupSession, CommandErrors>
  readonly keep: (
    id: string,
    itemInstanceIds: ReadonlyArray<string>,
  ) => Effect.Effect<CleanupSession, CommandErrors>
  readonly tick: Effect.Effect<void, BungieErrors>
}

export class Cleanup extends Context.Service<Cleanup, CleanupService>()("Cleanup") {}

class MoveFailed extends Schema.TaggedError<MoveFailed>()("MoveFailed", {
  message: Schema.String,
}) {}

class ItemGone extends Schema.TaggedError<ItemGone>()("ItemGone", {}) {}

interface Where {
  readonly location: ItemLocation
  readonly characterId: string | null
  readonly equipped: boolean
}

const INTERVAL = "3 seconds"

const POLLING = new Set<CleanupSession["stage"]>(["stashing", "delivering", "returning"])

// Not about the item: the same move can work later, so it stays pending.
const isOutage = (error: BungieErrors) =>
  error._tag === "BungieNotLinked" ||
  error.status === "Transport" ||
  error.status === "SystemDisabled" ||
  error.status.startsWith("Throttle")

const describe = (error: BungieErrors | MoveFailed) =>
  error._tag === "BungieNotLinked" ? "Bungie account is not linked" : error.message

/** `spacing` is the pause between transfers, which Bungie throttles. */
export const cleanupLayer = (spacing: Duration.Input) =>
  Layer.effect(
    Cleanup,
    Effect.gen(function* () {
      const bungie = yield* BungieClient
      const profile = yield* ProfileStore
      const manifest = yield* Manifest
      const items = yield* ItemsRepo
      const repo = yield* CleanupRepo
      const lock = yield* Semaphore.make(1)

      const now = Effect.map(DateTime.now, DateTime.formatIso)
      const freshInventory = profile.invalidate.pipe(Effect.andThen(profile.inventory))

      const update = (
        id: string,
        change: (session: CleanupSession, at: string) => Result.Result<CleanupSession, string>,
      ) =>
        Effect.gen(function* () {
          const next = change(yield* repo.get(id), yield* now)
          if (Result.isFailure(next)) return yield* new CleanupRefused({ reason: next.failure })
          yield* repo.save(next.success)
          return next.success
        }).pipe(lock.withPermits(1), Effect.catchTag("SqlError", Effect.die))

      const planFor = (inv: Inventory, characterId: string) =>
        Effect.gen(function* () {
          if (!inv.characters.some((c) => c.characterId === characterId)) {
            return yield* new CleanupRefused({ reason: "That character is not on this account." })
          }
          const capacities = yield* manifest.capacities
          return plan(inv, characterId, capacities.vault)
        })

      const preview = (characterId: string) =>
        Effect.map(
          Effect.flatMap(profile.inventory, (inv) => planFor(inv, characterId)),
          (planned) => planned.preview,
        )

      const current = repo.active.pipe(Effect.map(Option.getOrNull), Effect.orDie)

      const begun = (characterId: string) =>
        Effect.gen(function* () {
          if (Option.isSome(yield* repo.active.pipe(Effect.orDie))) {
            return yield* new CleanupRefused({ reason: "A cleanup is already running." })
          }
          const planned = yield* planFor(yield* freshInventory, characterId)
          const { junk, fits, stash, vault } = planned.preview
          if (junk === 0) return yield* new CleanupRefused({ reason: "Nothing is tagged junk." })
          if (!fits) {
            return yield* new CleanupRefused({
              reason: `The vault has room for ${vault.capacity - vault.count} and the stash needs ${stash}.`,
            })
          }
          const session = start(planned, crypto.randomUUID(), yield* now)
          yield* repo.save(session).pipe(Effect.orDie)
          return session
        }).pipe(lock.withPermits(1))

      const runCommand = (id: string, name: CleanupCommand) =>
        update(id, (session, at) => command(session, name, at))

      const skipRest = (id: string) => update(id, skip).pipe(Effect.tap(() => profile.invalidate))

      const keepItems = (id: string, itemInstanceIds: ReadonlyArray<string>) =>
        update(id, (session) => keep(session, itemInstanceIds)).pipe(
          Effect.tap(() =>
            Effect.forEach(itemInstanceIds, (itemId) => items.setDecision(itemId, "keep"), {
              discard: true,
            }).pipe(Effect.orDie),
          ),
          Effect.tap(() => profile.invalidate),
        )

      const execute = (
        move: Move,
        session: CleanupSession,
        membershipType: number,
        located: Map<string, Where>,
      ) =>
        Effect.gen(function* () {
          const id = move.itemInstanceId
          const transfer = (characterId: string, transferToVault: boolean) =>
            bungie
              .transferItem({
                itemReferenceHash: move.itemHash,
                itemId: id,
                characterId,
                membershipType,
                transferToVault,
              })
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    located.set(id, {
                      location: transferToVault ? "vault" : "character",
                      characterId: transferToVault ? null : characterId,
                      equipped: false,
                    }),
                  ),
                ),
              )
          const at = located.get(id)
          if (at === undefined) return yield* new ItemGone()
          if (
            at.location === "postmaster" ||
            (at.location === "character" && at.characterId === null)
          ) {
            return yield* new MoveFailed({ message: "It is in the postmaster." })
          }
          const target = destination(move.kind)
          if (target === "character" && at.characterId === session.characterId) return
          if (at.location === "vault") {
            if (target === "character") yield* transfer(session.characterId, false)
            return
          }
          if (at.equipped) return yield* new MoveFailed({ message: "It is equipped." })
          yield* transfer(at.characterId ?? session.characterId, true).pipe(
            Effect.catchIf(
              (error) =>
                move.kind === "stow" &&
                error._tag === "BungieError" &&
                error.status === "DestinyItemNotFound",
              () => new ItemGone(),
            ),
          )
          if (target === "character") yield* transfer(session.characterId, false)
        })

      const claim = (id: string) =>
        Effect.gen(function* () {
          const session = yield* repo.get(id)
          const [move] = nextMoves(session)
          if (move === undefined) return Option.none<readonly [Move, CleanupSession]>()
          const claimed = begin(session, move)
          yield* repo.save(claimed)
          return Option.some([move, claimed] as const)
        }).pipe(lock.withPermits(1), Effect.orDie)

      const record = (
        id: string,
        change: (session: CleanupSession, at: string) => CleanupSession,
      ) => update(id, (session, at) => Result.succeed(change(session, at))).pipe(Effect.orDie)

      const tick = Effect.gen(function* () {
        const active = yield* repo.active.pipe(Effect.orDie)
        if (Option.isNone(active)) return
        const session = active.value
        const polling = POLLING.has(session.stage)
        if (!polling && nextMoves(session).length === 0) return
        const inv = yield* freshInventory
        if (polling) yield* record(session.id, (s, at) => reconcile(s, inv, at))
        const located = new Map(
          inv.items.map((item): [string, Where] => [
            item.itemInstanceId,
            { location: item.location, characterId: item.characterId, equipped: item.equipped },
          ]),
        )
        const attempted = new Set<string>()
        while (true) {
          const claimed = yield* claim(session.id)
          if (Option.isNone(claimed)) break
          const [move, claimedSession] = claimed.value
          const key = `${move.kind}:${move.itemInstanceId}`
          if (attempted.has(key)) break
          attempted.add(key)
          const outcome = yield* Effect.result(
            execute(move, claimedSession, inv.membershipType, located),
          )
          if (Result.isFailure(outcome)) {
            const failure = outcome.failure
            if (failure._tag !== "MoveFailed" && failure._tag !== "ItemGone" && isOutage(failure)) {
              const reason = describe(failure)
              yield* record(session.id, (s) => new CleanupSession({ ...s, error: reason }))
              break
            }
          }
          const settled: Outcome = Result.isSuccess(outcome)
            ? "landed"
            : outcome.failure._tag === "ItemGone"
              ? "gone"
              : { failed: describe(outcome.failure) }
          yield* record(session.id, (s, at) => settle(s, move, settled, at))
          yield* Effect.sleep(spacing)
        }
        if (attempted.size > 0) yield* profile.invalidate
      })

      return {
        preview,
        current,
        start: begun,
        command: runCommand,
        skip: skipRest,
        keep: keepItems,
        tick,
      }
    }),
  )

export const CleanupLive = cleanupLayer("150 millis")

const watch = Effect.flatMap(Cleanup, (cleanup) => cleanup.tick).pipe(
  Effect.catchCause((cause) => Effect.logWarning("cleanup watcher tick failed", cause)),
  Effect.delay(INTERVAL),
  Effect.forever,
)

export const CleanupWatcherLive = Layer.effectDiscard(Effect.forkScoped(watch))
