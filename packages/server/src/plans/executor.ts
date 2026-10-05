import {
  HistoryGroup,
  type ItemLocation,
  type Job,
  type JobNotFound,
  Plan,
  PlanNotApplicable,
  PlanRow,
  type RowOutcome,
  type BungieNotLinked,
  SubclassChange,
  SubclassLoadout,
} from "@ghost/contract"
import { Context, Effect, Layer } from "effect"
import { BungieClient, type BungieError } from "../bungie/client.ts"
import { type OwnedItem, pickCharacter } from "../bungie/inventory.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { type ActionKind, ActionsRepo, type NewAction } from "../db/actions.ts"
import { ItemsRepo } from "../db/items.ts"
import { JobsRepo } from "../db/jobs.ts"
import { historyCalls } from "./history.ts"

// The agent only proposes. Confirming a plan runs here: each selected row
// becomes one or more Bungie calls, made one at a time, and every call is
// journaled in `actions` so history can show it and undo can replay it
// backwards. A failing row records its error and the batch carries on.

type PlanErrors = JobNotFound | PlanNotApplicable | BungieError | BungieNotLinked

export interface PlansService {
  readonly apply: (jobId: string, selected: ReadonlyArray<string>) => Effect.Effect<Job, PlanErrors>
  readonly undo: (jobId: string) => Effect.Effect<Job, PlanErrors>
  readonly history: Effect.Effect<ReadonlyArray<HistoryGroup>>
}

export class Plans extends Context.Service<Plans, PlansService>()("Plans") {}

const SPACING = "100 millis"

interface Where {
  location: ItemLocation
  characterId: string | null
  equipped: boolean
}

const describe = (error: BungieError | BungieNotLinked) =>
  error._tag === "BungieError" ? error.message : "Bungie account is not linked"

export const PlansLive = Layer.effect(
  Plans,
  Effect.gen(function* () {
    const bungie = yield* BungieClient
    const profile = yield* ProfileStore
    const jobs = yield* JobsRepo
    const items = yield* ItemsRepo
    const actions = yield* ActionsRepo

    const record = (action: NewAction) => actions.record(action).pipe(Effect.orDie)

    const apply = (jobId: string, selected: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const job = yield* jobs.get(jobId).pipe(Effect.catchTag("SqlError", Effect.die))
        const plan = job.plan
        if (plan === null)
          return yield* new PlanNotApplicable({ reason: "this request has no plan" })
        if (plan.status !== "proposed") {
          return yield* new PlanNotApplicable({ reason: `the plan was already ${plan.status}` })
        }
        yield* profile.invalidate
        const inv = yield* profile.inventory
        const owned = new Map(inv.items.map((i) => [i.itemInstanceId, i]))
        // Where each item is now, updated as calls succeed, so later rows in
        // the same batch see the moves earlier rows made.
        const where = new Map<string, Where>(
          inv.items.map((i) => [
            i.itemInstanceId,
            { location: i.location, characterId: i.characterId, equipped: i.equipped },
          ]),
        )
        const fallbackCharacter = pickCharacter(inv, job.characterId)?.characterId ?? null
        const moved = new Set<string>()
        const picked = new Set(selected)

        const call = (
          item: Pick<OwnedItem, "itemInstanceId" | "itemHash" | "name">,
          kind: ActionKind,
          fields: Pick<NewAction, "characterId" | "fromLocation" | "fromCharacterId"> &
            Partial<
              Pick<NewAction, "previousItemId" | "socketIndex" | "plugHash" | "previousPlugHash">
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
                record({ ...base, status: "failed", error: describe(error) }).pipe(
                  Effect.andThen(Effect.fail(describe(error))),
                ),
              onSuccess: () =>
                record({ ...base, status: "ok", error: null }).pipe(
                  Effect.tap(() => Effect.sync(() => moved.add(item.itemInstanceId))),
                ),
            }),
          )
        }

        const state = (item: OwnedItem) => where.get(item.itemInstanceId) as Where
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
            if (at.location !== "postmaster" || at.characterId === null) return
            const owner = at.characterId
            yield* call(
              item,
              "pull_postmaster",
              { characterId: owner, fromLocation: "postmaster", fromCharacterId: owner },
              bungie.pullFromPostmaster({
                itemReferenceHash: item.itemHash,
                itemId: item.itemInstanceId,
                characterId: owner,
                membershipType: inv.membershipType,
              }),
            )
            at.location = "character"
          })

        const toVault = (item: OwnedItem) =>
          Effect.gen(function* () {
            yield* pull(item)
            const at = state(item)
            if (at.location === "vault" || at.characterId === null) return
            if (at.equipped) {
              return yield* Effect.fail("it is equipped; equip something else in that slot first")
            }
            const owner = at.characterId
            yield* call(
              item,
              "to_vault",
              { characterId: null, fromLocation: "character", fromCharacterId: owner },
              transfer(item, owner, true),
            )
            Object.assign(at, { location: "vault", characterId: null })
          })

        const toCharacter = (item: OwnedItem, target: string) =>
          Effect.gen(function* () {
            yield* pull(item)
            const at = state(item)
            if (at.location === "character" && at.characterId === target) return
            yield* toVault(item)
            yield* call(
              item,
              "to_character",
              { characterId: target, fromLocation: "vault", fromCharacterId: null },
              transfer(item, target, false),
            )
            Object.assign(at, { location: "character", characterId: target })
          })

        const equip = (item: OwnedItem, target: string) =>
          Effect.gen(function* () {
            yield* toCharacter(item, target)
            const at = state(item)
            if (at.equipped) return
            const previous = inv.items.find((other) => {
              const o = where.get(other.itemInstanceId)
              return o?.equipped === true && o.characterId === target && other.slot === item.slot
            })
            yield* call(
              item,
              "equip",
              {
                characterId: target,
                fromLocation: "character",
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

        const tagJunk = (item: OwnedItem) =>
          items.setDecision(item.itemInstanceId, "junk").pipe(
            Effect.orDie,
            Effect.andThen(
              record({
                jobId,
                itemInstanceId: item.itemInstanceId,
                itemHash: item.itemHash,
                name: item.name,
                kind: "tag_junk",
                characterId: null,
                fromLocation: null,
                fromCharacterId: null,
                previousItemId: null,
                status: "ok",
                error: null,
              }),
            ),
          )

        const insertMods = (row: PlanRow, item: OwnedItem) =>
          Effect.gen(function* () {
            for (const mod of row.armorMods ?? []) {
              if (mod.swap !== true || mod.plugHash === undefined || mod.socketIndex === undefined)
                continue
              const at = state(item)
              if (at.location !== "character" || at.characterId === null) {
                return yield* Effect.fail(`it must be on a character to take ${mod.name}`)
              }
              yield* call(
                item,
                "insert_mod",
                {
                  characterId: at.characterId,
                  fromLocation: "character",
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

        const runRow = (row: PlanRow, item: OwnedItem): Effect.Effect<void, string> => {
          const target = row.characterId ?? fallbackCharacter
          switch (row.action) {
            case "to_vault":
              return toVault(item)
            case "pull_postmaster":
              return state(item).location === "postmaster"
                ? pull(item)
                : Effect.fail("it is no longer in the postmaster")
            case "to_character":
              return target === null
                ? Effect.fail("no target character")
                : toCharacter(item, target)
            case "equip":
              return target === null ? Effect.fail("no target character") : equip(item, target)
            case "tag_junk":
              return tagJunk(item)
            case "none":
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
              return yield* Effect.fail("that subclass is no longer on the character")
            }
            const fields = {
              characterId: owner.characterId,
              fromLocation: "character",
              fromCharacterId: owner.characterId,
            }
            if (!subclass.equipped) {
              yield* call(
                subclass,
                "equip",
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
                "insert_subclass_plug",
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
                        outcome: result._tag === "Success" ? "ok" : "failed",
                        error: result._tag === "Success" ? null : result.failure,
                      }),
                  ),
                )
              : yield* record({
                  jobId,
                  itemInstanceId: change.itemInstanceId,
                  itemHash: change.itemHash,
                  name: plan.loadout?.subclass ?? null,
                  kind: "held",
                  characterId: change.characterId,
                  fromLocation: "character",
                  fromCharacterId: change.characterId,
                  previousItemId: null,
                  status: "held",
                  error: null,
                }).pipe(Effect.as(new SubclassChange({ ...change, outcome: "skipped" })))

        const rows: Array<PlanRow> = []
        for (const row of plan.rows) {
          const finish = (outcome: RowOutcome | null, error: string | null) =>
            rows.push(new PlanRow({ ...row, outcome, error }))
          const item = owned.get(row.itemInstanceId)
          if (row.action === "none") {
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
                kind: "held",
                characterId: row.characterId,
                fromLocation: item?.location ?? null,
                fromCharacterId: item?.characterId ?? null,
                previousItemId: null,
                status: "held",
                error: null,
              })
              finish("skipped", null)
              continue
            }
            if (item === undefined) {
              finish("failed", "it is no longer in your inventory")
              continue
            }
            const modded = yield* Effect.result(insertMods(row, item))
            if (modded._tag === "Success") finish("ok", null)
            else finish("failed", modded.failure)
            continue
          }
          if (!picked.has(row.itemInstanceId)) {
            yield* record({
              jobId,
              itemInstanceId: row.itemInstanceId,
              itemHash: row.itemHash,
              name: row.name,
              kind: "held",
              characterId: row.characterId,
              fromLocation: item?.location ?? null,
              fromCharacterId: item?.characterId ?? null,
              previousItemId: null,
              status: "held",
              error: null,
            })
            finish("skipped", null)
            continue
          }
          if (item === undefined) {
            finish("failed", "it is no longer in your inventory")
            continue
          }
          const result = yield* Effect.result(
            runRow(row, item).pipe(Effect.andThen(insertMods(row, item))),
          )
          if (result._tag === "Success") finish("ok", null)
          else finish("failed", result.failure)
          yield* Effect.sleep(SPACING)
        }

        const loadout =
          plan.loadout === undefined || changed === undefined
            ? plan.loadout
            : new SubclassLoadout({ ...plan.loadout, change: changed })
        yield* jobs
          .setPlan(
            jobId,
            new Plan({
              ...plan,
              rows,
              ...(loadout === undefined ? {} : { loadout }),
              status: "applied",
            }),
          )
          .pipe(Effect.orDie)
        yield* items.tagJob([...moved], jobId).pipe(Effect.orDie)
        yield* profile.invalidate
        return yield* jobs.get(jobId).pipe(Effect.catchTag("SqlError", Effect.die))
      })

    const undo = (jobId: string) =>
      Effect.gen(function* () {
        const job = yield* jobs.get(jobId).pipe(Effect.catchTag("SqlError", Effect.die))
        const done = (yield* actions.forJobs([jobId]).pipe(Effect.orDie))
          .filter((a) => a.status === "ok")
          .reverse()
        if (done.length === 0) {
          return yield* new PlanNotApplicable({ reason: "nothing to undo" })
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

        let failures = 0
        for (const action of done) {
          const hash = action.itemHash ?? 0
          const reverse: Effect.Effect<unknown, BungieError | BungieNotLinked> =
            action.kind === "to_vault" && action.fromCharacterId !== null
              ? back(action.itemInstanceId, hash, action.fromCharacterId, false)
              : action.kind === "to_character" && action.characterId !== null
                ? back(action.itemInstanceId, hash, action.characterId, true)
                : action.kind === "equip" &&
                    action.previousItemId !== null &&
                    action.characterId !== null
                  ? bungie.equipItem({
                      itemId: action.previousItemId,
                      characterId: action.characterId,
                      membershipType,
                    })
                  : (action.kind === "insert_mod" || action.kind === "insert_subclass_plug") &&
                      action.characterId !== null &&
                      typeof action.socketIndex === "number" &&
                      typeof action.previousPlugHash === "number"
                    ? bungie.insertPlug({
                        itemId: action.itemInstanceId,
                        characterId: action.characterId,
                        membershipType,
                        socketIndex: action.socketIndex,
                        plugHash: action.previousPlugHash,
                      })
                    : action.kind === "tag_junk"
                      ? items.setDecision(action.itemInstanceId, null).pipe(Effect.orDie)
                      : // A postmaster pull cannot be reversed; the item stays on the character.
                        Effect.void
          const result = yield* Effect.result(reverse)
          if (result._tag === "Success") {
            yield* actions.setStatus(action.id, "undone").pipe(Effect.orDie)
          } else {
            failures += 1
            yield* Effect.logWarning(
              `undo ${action.kind} ${action.itemInstanceId} failed: ${describe(result.failure)}`,
            )
          }
          if (action.kind !== "pull_postmaster" && action.kind !== "tag_junk") {
            yield* Effect.sleep(SPACING)
          }
        }

        if (job.plan !== null && failures === 0) {
          yield* jobs.setPlan(jobId, new Plan({ ...job.plan, status: "undone" })).pipe(Effect.orDie)
        }
        yield* profile.invalidate
        return yield* jobs.get(jobId).pipe(Effect.catchTag("SqlError", Effect.die))
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
          undoable: jobActions.some((a) => a.status === "ok"),
          undone: job.plan?.status === "undone",
        })
      })
    }).pipe(Effect.orDie)

    return { apply, undo, history }
  }),
)
