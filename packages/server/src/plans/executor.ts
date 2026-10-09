import {
  HistoryGroup,
  type ItemLocation,
  type Job,
  type JobNotFound,
  LoadoutSaveTo,
  Plan,
  PlanNotApplicable,
  PlanRow,
  type RowOutcome,
  type BungieNotLinked,
  SubclassChange,
  SubclassLoadout,
} from '@ghost/contract'
import { Context, Effect, Fiber, Layer, Option, Predicate } from 'effect'
import { BungieClient, type BungieError } from '../bungie/client.ts'
import { type Inventory, type OwnedItem } from '../bungie/inventory.ts'
import { Loadouts } from '../bungie/loadouts.ts'
import { ProfileStore } from '../bungie/profile.ts'
import { type ActionKind, ActionsRepo, type NewAction } from '../db/actions.ts'
import { BuildsRepo } from '../db/builds.ts'
import { ItemsRepo } from '../db/items.ts'
import { JobsRepo } from '../db/jobs.ts'
import { hardProtections, type InUse, inUse } from '../junk/judge.ts'
import { PROTECTED } from '../junk/proposal.ts'
import { drift } from './drift.ts'
import { historyCalls } from './history.ts'

// The agent only proposes. Confirming a plan runs here: each selected row
// becomes one or more Bungie calls, made one at a time, and every call is
// journaled in `actions` so history can show it and undo can replay it
// backwards. A failing row records its error and the batch carries on.
//
// Apply and undo run on their own fiber and the request only waits for it,
// so a client that goes away (the app suspended mid-plan) cannot stop a
// batch halfway. Only one of them runs per job at a time, so a double tap or
// a retry finds the plan already claimed instead of repeating every call.

type PlanErrors = JobNotFound | PlanNotApplicable | BungieError | BungieNotLinked

export interface PlansService {
  readonly apply: (jobId: string, selected: ReadonlyArray<string>) => Effect.Effect<Job, PlanErrors>
  readonly undo: (jobId: string) => Effect.Effect<Job, PlanErrors>
  readonly history: Effect.Effect<ReadonlyArray<HistoryGroup>>
}

export class Plans extends Context.Service<Plans, PlansService>()('Plans') {}

const SPACING = '100 millis'
const PROFILE_LAG = '1500 millis'

interface Where {
  location: ItemLocation
  characterId: string | null
  equipped: boolean
}

const describe = (error: BungieError | BungieNotLinked) =>
  error._tag === 'BungieError' ? error.message : 'Bungie account is not linked'

// Bungie refuses a second exotic weapon or armor piece, so the equips that
// bring one in run after the rest, which take off the exotic worn now.
const runsLate = (row: PlanRow) => row.action === 'equip' && row.tier === 'exotic'

export const PlansLive = Layer.effect(
  Plans,
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const profile = yield* ProfileStore
    const jobs = yield* JobsRepo
    const items = yield* ItemsRepo
    const actions = yield* ActionsRepo
    const builds = yield* BuildsRepo
    const loadouts = yield* Loadouts

    // A failed journal write must not stop the batch after Bungie already
    // made the change, so it is logged and the apply carries on.
    const record = (action: NewAction) =>
      actions.record(action).pipe(
        Effect.retry({ times: 2 }),
        Effect.catch((error) =>
          Effect.logError(`could not journal ${action.kind} ${action.itemInstanceId}`, error),
        ),
      )

    const busy = new Set<string>()
    const exclusive = <A, E>(jobId: string, run: Effect.Effect<A, E>) =>
      Effect.suspend((): Effect.Effect<A, E | PlanNotApplicable> => {
        if (busy.has(jobId)) {
          return Effect.fail(
            new PlanNotApplicable({ reason: 'this plan is already being applied or undone' }),
          )
        }
        busy.add(jobId)
        return run.pipe(Effect.ensuring(Effect.sync(() => busy.delete(jobId))))
      }).pipe(
        Effect.forkDetach,
        Effect.flatMap((fiber) => Fiber.join(fiber)),
      )

    const freshInventory = profile.invalidate.pipe(Effect.andThen(profile.inventory))

    const settledDrift = (plan: Plan, characterId: string) =>
      Effect.gen(function* () {
        const first = drift(plan, yield* freshInventory, characterId)
        if (first.length === 0) return first
        yield* Effect.sleep(PROFILE_LAG)
        return drift(plan, yield* freshInventory, characterId)
      })

    const saveLoadout = (jobId: string, saveTo: LoadoutSaveTo, applied: Plan, inv: Inventory) =>
      Effect.gen(function* () {
        const drifted = yield* settledDrift(applied, saveTo.characterId)
        if (drifted.length > 0) {
          return new LoadoutSaveTo({
            ...saveTo,
            outcome: 'skipped',
            error: `not saved in game: ${drifted.join('; ')}`,
          })
        }
        const result = yield* Effect.result(
          bungie.snapshotLoadout({
            loadoutIndex: saveTo.index,
            characterId: saveTo.characterId,
            membershipType: inv.membershipType,
            nameHash: saveTo.nameHash,
            colorHash: saveTo.colorHash,
            iconHash: saveTo.iconHash,
          }),
        )
        yield* record({
          jobId,
          itemInstanceId: `${saveTo.characterId}/${saveTo.index}`,
          itemHash: saveTo.nameHash,
          name: saveTo.replaces,
          kind: 'snapshot_loadout',
          characterId: saveTo.characterId,
          fromLocation: null,
          fromCharacterId: null,
          previousItemId: null,
          status: result._tag === 'Success' ? 'ok' : 'failed',
          error: result._tag === 'Success' ? null : describe(result.failure),
        })
        if (result._tag === 'Failure') {
          return new LoadoutSaveTo({
            ...saveTo,
            outcome: 'failed',
            error: describe(result.failure),
          })
        }
        yield* builds
          .claimInGameSlot(saveTo.buildId, { characterId: saveTo.characterId, index: saveTo.index })
          .pipe(
            Effect.catchTag('BuildNotFound', () =>
              Effect.logWarning(`build ${saveTo.buildId} was deleted before its slot was saved`),
            ),
            Effect.orDie,
          )
        yield* loadouts.invalidate
        return new LoadoutSaveTo({ ...saveTo, outcome: 'ok', error: null })
      }).pipe(
        Effect.catchTags({
          BungieError: (error) =>
            Effect.succeed(
              new LoadoutSaveTo({ ...saveTo, outcome: 'failed', error: describe(error) }),
            ),
          BungieNotLinked: (error) =>
            Effect.succeed(
              new LoadoutSaveTo({ ...saveTo, outcome: 'failed', error: describe(error) }),
            ),
        }),
      )

    // What a saved build or an in-game loadout uses, read only when the plan
    // tags junk; none when the loadouts cannot be read, so nothing is tagged.
    const inUseNow = Effect.gen(function* () {
      const saved = yield* builds.list.pipe(Effect.orDie)
      return Option.some(inUse(saved, yield* loadouts.current))
    }).pipe(
      Effect.catchTags({
        BungieError: () => Effect.succeedNone,
        BungieNotLinked: () => Effect.succeedNone,
      }),
    )

    const apply = (jobId: string, selected: ReadonlyArray<string>) =>
      exclusive(jobId, applyNow(jobId, selected))

    const applyNow = (jobId: string, selected: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const job = yield* jobs.get(jobId).pipe(Effect.catchTag('SqlError', Effect.die))
        const plan = job.plan
        if (plan === null)
          return yield* new PlanNotApplicable({ reason: 'this request has no plan' })
        if (plan.status !== 'proposed') {
          return yield* new PlanNotApplicable({ reason: `the plan was already ${plan.status}` })
        }
        yield* profile.invalidate
        const inv = yield* profile.inventory
        const owned = new Map(inv.items.map((i) => [i.itemInstanceId, i]))
        // Where each item is now, updated as calls succeed, so later rows in
        // the same batch see the moves earlier rows made.
        const where = new Map<string, Where>()
        const moved = new Set<string>()
        const picked = new Set(selected)
        const tagging = plan.rows.some(
          (row) => row.action === 'tag_junk' && picked.has(row.itemInstanceId),
        )
        const guarded: Option.Option<InUse> = tagging ? yield* inUseNow : Option.none()

        const call = (
          item: Pick<OwnedItem, 'itemInstanceId' | 'itemHash' | 'name'>,
          kind: ActionKind,
          fields: Pick<NewAction, 'characterId' | 'fromLocation' | 'fromCharacterId'> &
            Partial<
              Pick<NewAction, 'previousItemId' | 'socketIndex' | 'plugHash' | 'previousPlugHash'>
            >,
          request: Effect.Effect<unknown, BungieError | BungieNotLinked>,
        ) => {
          const base = {
            jobId,
            itemInstanceId: item.itemInstanceId,
            itemHash: item.itemHash,
            name: item.name,
            kind,
            previousItemId: null,
            ...fields,
          }
          return request.pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                record({ ...base, status: 'failed', error: describe(error) }).pipe(
                  Effect.andThen(Effect.fail(describe(error))),
                ),
              onSuccess: () =>
                record({ ...base, status: 'ok', error: null }).pipe(
                  Effect.tap(() => Effect.sync(() => moved.add(item.itemInstanceId))),
                ),
            }),
          )
        }

        const state = (item: OwnedItem) => {
          const known = where.get(item.itemInstanceId)
          if (known !== undefined) return known
          const now: Where = {
            location: item.location,
            characterId: item.characterId,
            equipped: item.equipped,
          }
          where.set(item.itemInstanceId, now)
          return now
        }
        const transfer = (item: OwnedItem, characterId: string, transferToVault: boolean) =>
          bungie.transferItem({
            itemReferenceHash: item.itemHash,
            itemId: item.itemInstanceId,
            characterId,
            membershipType: inv.membershipType,
            transferToVault,
          })

        const pull = (item: OwnedItem) =>
          Effect.gen(function* () {
            const at = state(item)
            if (at.location !== 'postmaster' || at.characterId === null) return
            const owner = at.characterId
            yield* call(
              item,
              'pull_postmaster',
              { characterId: owner, fromLocation: 'postmaster', fromCharacterId: owner },
              bungie.pullFromPostmaster({
                itemReferenceHash: item.itemHash,
                itemId: item.itemInstanceId,
                characterId: owner,
                membershipType: inv.membershipType,
              }),
            )
            at.location = 'character'
          })

        const toVault = (item: OwnedItem) =>
          Effect.gen(function* () {
            yield* pull(item)
            const at = state(item)
            if (at.location === 'vault' || at.characterId === null) return
            if (at.equipped) {
              return yield* Effect.fail('it is equipped; equip something else in that slot first')
            }
            const owner = at.characterId
            yield* call(
              item,
              'to_vault',
              { characterId: null, fromLocation: 'character', fromCharacterId: owner },
              transfer(item, owner, true),
            )
            Object.assign(at, { location: 'vault', characterId: null })
          })

        const toCharacter = (item: OwnedItem, target: string) =>
          Effect.gen(function* () {
            yield* pull(item)
            const at = state(item)
            if (at.location === 'character' && at.characterId === target) return
            yield* toVault(item)
            yield* call(
              item,
              'to_character',
              { characterId: target, fromLocation: 'vault', fromCharacterId: null },
              transfer(item, target, false),
            )
            Object.assign(at, { location: 'character', characterId: target })
          })

        const equip = (item: OwnedItem, target: string) =>
          Effect.gen(function* () {
            yield* toCharacter(item, target)
            const at = state(item)
            if (at.equipped) return
            const previous = inv.items.find((other) => {
              const o = state(other)
              return o.equipped && o.characterId === target && other.slot === item.slot
            })
            yield* call(
              item,
              'equip',
              {
                characterId: target,
                fromLocation: 'character',
                fromCharacterId: target,
                previousItemId: previous?.itemInstanceId ?? null,
              },
              bungie.equipItem({
                itemId: item.itemInstanceId,
                characterId: target,
                membershipType: inv.membershipType,
              }),
            )
            if (previous !== undefined) state(previous).equipped = false
            at.equipped = true
          })

        // Only the judge decides what is junk, and only a cleanup plan carries
        // its verdicts. The plan may be stale by the time the player confirms
        // it, so the item is checked against the judge's hard protections as
        // it is now.
        const tagJunk = (item: OwnedItem) =>
          Effect.gen(function* () {
            if (plan.kind !== 'cleanup') {
              return yield* Effect.fail('only a cleanup plan tags junk')
            }
            if (Option.isNone(guarded)) {
              return yield* Effect.fail(
                'your in-game loadouts could not be read, so it was not tagged junk',
              )
            }
            const [kept] = hardProtections({ ...item, ...state(item) }, guarded.value)
            if (kept !== undefined) {
              return yield* Effect.fail(`${PROTECTED[kept]}, so it was not tagged junk`)
            }
            const tagged = yield* items.setDecision(item.itemInstanceId, 'junk').pipe(Effect.orDie)
            if (Option.isNone(tagged)) {
              return yield* Effect.fail('Ghost has no record of it yet, so it was not tagged junk')
            }
            yield* record({
              jobId,
              itemInstanceId: item.itemInstanceId,
              itemHash: item.itemHash,
              name: item.name,
              kind: 'tag_junk',
              characterId: null,
              fromLocation: null,
              fromCharacterId: null,
              previousItemId: null,
              previousDecision: item.decision,
              status: 'ok',
              error: null,
            })
          })

        const insertMods = (row: PlanRow, item: OwnedItem) =>
          Effect.gen(function* () {
            for (const mod of row.armorMods ?? []) {
              if (mod.swap !== true || mod.plugHash === undefined || mod.socketIndex === undefined)
                continue
              const at = state(item)
              if (at.location !== 'character' || at.characterId === null) {
                return yield* Effect.fail(`it must be on a character to take ${mod.name}`)
              }
              yield* call(
                item,
                'insert_mod',
                {
                  characterId: at.characterId,
                  fromLocation: 'character',
                  fromCharacterId: at.characterId,
                  socketIndex: mod.socketIndex,
                  plugHash: mod.plugHash,
                  previousPlugHash: mod.previousPlugHash ?? null,
                },
                bungie.insertPlug({
                  itemId: item.itemInstanceId,
                  characterId: at.characterId,
                  membershipType: inv.membershipType,
                  socketIndex: mod.socketIndex,
                  plugHash: mod.plugHash,
                }),
              ).pipe(Effect.mapError((reason) => `${mod.name}: ${reason}`))
              yield* Effect.sleep(SPACING)
            }
          })

        const swapsMods = (row: PlanRow) => row.armorMods?.some((mod) => mod.swap === true) ?? false

        // A row without a character goes to the job's own character, never to
        // whichever character happens to be first, and armor is only equipped
        // by its own class.
        const targetOf = (row: PlanRow, item: OwnedItem) => {
          const id = row.characterId ?? job.characterId
          const character = inv.characters.find((c) => c.characterId === id)
          if (character === undefined) return Effect.fail('no target character')
          if (
            row.action === 'equip' &&
            item.classType !== null &&
            item.classType !== character.classType
          ) {
            return Effect.fail(`it is ${item.classType} armor`)
          }
          return Effect.succeed(character.characterId)
        }

        const runRow = (row: PlanRow, item: OwnedItem): Effect.Effect<void, string> => {
          switch (row.action) {
            case 'to_vault':
              return toVault(item)
            case 'pull_postmaster':
              return state(item).location === 'postmaster'
                ? pull(item)
                : Effect.fail('it is no longer in the postmaster')
            case 'to_character':
              return Effect.flatMap(targetOf(row, item), (target) => toCharacter(item, target))
            case 'equip':
              return Effect.flatMap(targetOf(row, item), (target) => equip(item, target))
            case 'tag_junk':
              return tagJunk(item)
            case 'none':
              return Effect.void
          }
        }

        const changeSubclass = (change: SubclassChange) =>
          Effect.gen(function* () {
            const owner = inv.characters.find((c) => c.characterId === change.characterId)
            const subclass = owner?.subclasses.find(
              (each) => each.itemInstanceId === change.itemInstanceId,
            )
            if (owner === undefined || subclass === undefined) {
              return yield* Effect.fail('that subclass is no longer on the character')
            }
            const fields = {
              characterId: owner.characterId,
              fromLocation: 'character',
              fromCharacterId: owner.characterId,
            }
            if (!subclass.equipped) {
              yield* call(
                subclass,
                'equip',
                {
                  ...fields,
                  previousItemId:
                    owner.subclasses.find((each) => each.equipped)?.itemInstanceId ?? null,
                },
                bungie.equipItem({
                  itemId: subclass.itemInstanceId,
                  characterId: owner.characterId,
                  membershipType: inv.membershipType,
                }),
              )
              yield* Effect.sleep(SPACING)
            }
            for (const swap of change.swaps) {
              yield* call(
                subclass,
                'insert_subclass_plug',
                {
                  ...fields,
                  socketIndex: swap.socketIndex,
                  plugHash: swap.plugHash,
                  previousPlugHash: swap.previousPlugHash,
                },
                bungie.insertPlug({
                  itemId: subclass.itemInstanceId,
                  characterId: owner.characterId,
                  membershipType: inv.membershipType,
                  socketIndex: swap.socketIndex,
                  plugHash: swap.plugHash,
                }),
              ).pipe(Effect.mapError((reason) => `${swap.name}: ${reason}`))
              yield* Effect.sleep(SPACING)
            }
          })

        const change = plan.loadout?.change
        const changed =
          change === undefined
            ? undefined
            : picked.has(change.itemInstanceId)
              ? yield* Effect.result(changeSubclass(change)).pipe(
                  Effect.map(
                    (result) =>
                      new SubclassChange({
                        ...change,
                        outcome: result._tag === 'Success' ? 'ok' : 'failed',
                        error: result._tag === 'Success' ? null : result.failure,
                      }),
                  ),
                )
              : yield* record({
                  jobId,
                  itemInstanceId: change.itemInstanceId,
                  itemHash: change.itemHash,
                  name: plan.loadout?.subclass ?? null,
                  kind: 'held',
                  characterId: change.characterId,
                  fromLocation: 'character',
                  fromCharacterId: change.characterId,
                  previousItemId: null,
                  status: 'held',
                  error: null,
                }).pipe(Effect.as(new SubclassChange({ ...change, outcome: 'skipped' })))

        const finished = new Map<PlanRow, PlanRow>()
        const runOrder = [
          ...plan.rows.filter((row) => !runsLate(row)),
          ...plan.rows.filter(runsLate),
        ]
        for (const row of runOrder) {
          const finish = (outcome: RowOutcome | null, error: string | null) =>
            finished.set(row, new PlanRow({ ...row, outcome, error }))
          const item = owned.get(row.itemInstanceId)
          if (row.action === 'none') {
            if (!swapsMods(row)) {
              finish(null, null)
              continue
            }
            if (!picked.has(row.itemInstanceId)) {
              yield* record({
                jobId,
                itemInstanceId: row.itemInstanceId,
                itemHash: row.itemHash,
                name: row.name,
                kind: 'held',
                characterId: row.characterId,
                fromLocation: item?.location ?? null,
                fromCharacterId: item?.characterId ?? null,
                previousItemId: null,
                status: 'held',
                error: null,
              })
              finish('skipped', null)
              continue
            }
            if (item === undefined) {
              finish('failed', 'it is no longer in your inventory')
              continue
            }
            const modded = yield* Effect.result(insertMods(row, item))
            if (modded._tag === 'Success') finish('ok', null)
            else finish('failed', modded.failure)
            continue
          }
          if (!picked.has(row.itemInstanceId)) {
            yield* record({
              jobId,
              itemInstanceId: row.itemInstanceId,
              itemHash: row.itemHash,
              name: row.name,
              kind: 'held',
              characterId: row.characterId,
              fromLocation: item?.location ?? null,
              fromCharacterId: item?.characterId ?? null,
              previousItemId: null,
              status: 'held',
              error: null,
            })
            finish('skipped', null)
            continue
          }
          if (item === undefined) {
            finish('failed', 'it is no longer in your inventory')
            continue
          }
          const result = yield* Effect.result(
            runRow(row, item).pipe(Effect.andThen(insertMods(row, item))),
          )
          if (result._tag === 'Success') finish('ok', null)
          else finish('failed', result.failure)
          yield* Effect.sleep(SPACING)
        }

        const rows = plan.rows.map((row) => finished.get(row) ?? row)
        const loadout =
          plan.loadout === undefined || changed === undefined
            ? plan.loadout
            : new SubclassLoadout({ ...plan.loadout, change: changed })
        const applied = new Plan({ ...plan, rows, loadout, status: 'applied' })
        const saveTo =
          plan.saveTo === undefined
            ? undefined
            : yield* saveLoadout(jobId, plan.saveTo, applied, inv)
        yield* jobs.setPlan(jobId, new Plan({ ...applied, saveTo })).pipe(Effect.orDie)
        yield* items.tagJob([...moved], jobId).pipe(Effect.orDie)
        yield* profile.invalidate
        return yield* jobs.get(jobId).pipe(Effect.catchTag('SqlError', Effect.die))
      })

    const undo = (jobId: string) => exclusive(jobId, undoNow(jobId))

    const undoNow = (jobId: string) =>
      Effect.gen(function* () {
        const job = yield* jobs.get(jobId).pipe(Effect.catchTag('SqlError', Effect.die))
        if (job.plan?.status === 'undone') {
          return yield* new PlanNotApplicable({ reason: 'the plan was already undone' })
        }
        const done = (yield* actions.forJobs([jobId]).pipe(Effect.orDie))
          .filter((a) => a.status === 'ok' && a.kind !== 'snapshot_loadout')
          .reverse()
        if (done.length === 0) {
          return yield* new PlanNotApplicable({ reason: 'nothing to undo' })
        }
        const inv = yield* profile.inventory
        const membershipType = inv.membershipType
        const back = (itemId: string, hash: number, characterId: string, toVault: boolean) =>
          bungie.transferItem({
            itemReferenceHash: hash,
            itemId,
            characterId,
            membershipType,
            transferToVault: toVault,
          })

        // Some calls have nothing to go back to: a postmaster pull, an equip
        // into an empty slot, a mod into an empty socket. They stay ok rather
        // than claim to be undone, and an item still equipped because of one
        // keeps the moves that brought it, since Bungie cannot move it while
        // it is equipped. The rest of the plan still undoes.
        const stays = new Set<string>()
        let failures = 0
        for (const action of done) {
          const hash = action.itemHash ?? 0
          const reverse: Effect.Effect<unknown, BungieError | BungieNotLinked> | null = stays.has(
            action.itemInstanceId,
          )
            ? null
            : action.kind === 'to_vault' && action.fromCharacterId !== null
              ? back(action.itemInstanceId, hash, action.fromCharacterId, false)
              : action.kind === 'to_character' && action.characterId !== null
                ? back(action.itemInstanceId, hash, action.characterId, true)
                : action.kind === 'equip' &&
                    action.previousItemId !== null &&
                    action.characterId !== null
                  ? bungie.equipItem({
                      itemId: action.previousItemId,
                      characterId: action.characterId,
                      membershipType,
                    })
                  : (action.kind === 'insert_mod' || action.kind === 'insert_subclass_plug') &&
                      action.characterId !== null &&
                      Predicate.isNotNullish(action.socketIndex) &&
                      Predicate.isNotNullish(action.previousPlugHash)
                    ? bungie.insertPlug({
                        itemId: action.itemInstanceId,
                        characterId: action.characterId,
                        membershipType,
                        socketIndex: action.socketIndex,
                        plugHash: action.previousPlugHash,
                      })
                    : action.kind === 'tag_junk'
                      ? items
                          .setDecision(action.itemInstanceId, action.previousDecision ?? null)
                          .pipe(Effect.orDie)
                      : null
          if (reverse === null) {
            if (action.kind === 'equip') stays.add(action.itemInstanceId)
            yield* Effect.logInfo(
              `undo ${action.kind} ${action.itemInstanceId}: not reversible, left as it is`,
            )
            continue
          }
          const result = yield* Effect.result(reverse)
          if (result._tag === 'Success') {
            yield* actions.setStatus(action.id, 'undone').pipe(Effect.orDie)
          } else {
            failures += 1
            yield* Effect.logWarning(
              `undo ${action.kind} ${action.itemInstanceId} failed: ${describe(result.failure)}`,
            )
          }
          if (action.kind !== 'pull_postmaster' && action.kind !== 'tag_junk') {
            yield* Effect.sleep(SPACING)
          }
        }

        if (job.plan !== null && failures === 0) {
          const saveTo =
            job.plan.saveTo?.outcome === 'ok'
              ? new LoadoutSaveTo({ ...job.plan.saveTo, error: 'The in-game slot was kept.' })
              : job.plan.saveTo
          yield* jobs
            .setPlan(jobId, new Plan({ ...job.plan, saveTo, status: 'undone' }))
            .pipe(Effect.orDie)
        }
        yield* profile.invalidate
        return yield* jobs.get(jobId).pipe(Effect.catchTag('SqlError', Effect.die))
      })

    const history = Effect.gen(function* () {
      const list = yield* jobs.list
      const all = yield* actions.forJobs(list.map((j) => j.id))
      const byJob = new Map<string, Array<(typeof all)[number]>>()
      for (const action of all) {
        const group = byJob.get(action.jobId)
        if (group === undefined) byJob.set(action.jobId, [action])
        else group.push(action)
      }
      return list.map((job) => {
        const jobActions = byJob.get(job.id) ?? []
        return new HistoryGroup({
          jobId: job.id,
          prompt: job.prompt,
          at: job.createdAt,
          calls: historyCalls(jobActions),
          undoable: job.plan?.status !== 'undone' && jobActions.some((a) => a.status === 'ok'),
          undone: job.plan?.status === 'undone',
        })
      })
    }).pipe(Effect.orDie)

    return { apply, undo, history }
  }),
)
