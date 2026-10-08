import { Console, Effect } from "effect"
import { Prompt } from "effect/cli"
import { CliFailure, serverState } from "./daemon.ts"
import type { GhostHome } from "./home.ts"
import { start } from "./lifecycle.ts"
import { machineOf, type Requirement, type Verdict, requirements } from "./requirements.ts"
import { bold, cyan, dim, green, red, yellow } from "./ui.ts"

const NAME_WIDTH = Math.max(...requirements.map((r) => r.name.length)) + 2

const describe = (requirement: Requirement, verdict: Verdict) => {
  const name = requirement.name.padEnd(NAME_WIDTH)
  switch (verdict._tag) {
    case "Ready":
      return `  ${green("✓")} ${name}${dim(verdict.detail)}`
    case "Blocked":
      return `  ${dim("–")} ${dim(name)}${dim(`waiting on ${verdict.by}`)}`
    case "Missing": {
      const mark = requirement.optional ? yellow("!") : red("✗")
      const fix = `${" ".repeat(NAME_WIDTH + 4)}${cyan(verdict.fix)}`
      return `  ${mark} ${name}${verdict.detail}\n${fix}`
    }
  }
}

const unmet = (verdicts: ReadonlyMap<string, Verdict>) =>
  requirements.filter((r) => !r.optional && verdicts.get(r.id)?._tag !== "Ready")

/**
 * Checks each requirement in order and prints its line. A requirement whose
 * prerequisite is not ready is skipped. With `fix`, a missing one gets its
 * guided fix and a second check, so running setup again resumes where it
 * stopped: only what is still missing asks anything.
 */
const walk = (home: GhostHome, fix: boolean) =>
  Effect.gen(function* () {
    const verdicts = new Map<string, Verdict>()
    for (const requirement of requirements) {
      const prior = requirement.needs === null ? undefined : verdicts.get(requirement.needs)
      let verdict: Verdict =
        prior === undefined || prior._tag === "Ready"
          ? yield* requirement.check(machineOf(home))
          : {
              _tag: "Blocked",
              by: requirements.find((r) => r.id === requirement.needs)?.name ?? "",
            }
      if (fix && verdict._tag === "Missing") {
        const label = requirement.optional ? dim(" (optional)") : ""
        yield* Console.log(`\n${bold(requirement.name)}${label}: ${verdict.detail}`)
        yield* requirement.resolve(machineOf(home))
        verdict = yield* requirement.check(machineOf(home))
        yield* Console.log("")
      }
      verdicts.set(requirement.id, verdict)
      yield* Console.log(describe(requirement, verdict))
    }
    return unmet(verdicts)
  })

export const doctor = (home: GhostHome) =>
  Effect.gen(function* () {
    yield* Console.log(`${bold("Ghost doctor")}\n`)
    const left = yield* walk(home, false)
    const state = serverState(home)
    yield* Console.log(
      `\n  Server ${state._tag === "Running" ? green(`running (pid ${state.pid})`) : dim("stopped")}`,
    )
    if (left.length > 0) {
      return yield* new CliFailure({
        message: `\n${left.length} required ${left.length === 1 ? "item needs" : "items need"} attention. \`ghost setup\` walks you through ${left.length === 1 ? "it" : "them"}.`,
      })
    }
    yield* Console.log(`\n${green("Everything Ghost needs is here.")}`)
  })

export const setup = (home: GhostHome) =>
  Effect.gen(function* () {
    yield* Console.log(bold("Ghost setup"))
    yield* Console.log(
      dim(
        "Checks what Ghost needs on this machine and helps with anything missing. Safe to run again.\n",
      ),
    )
    const left = yield* walk(home, true)
    if (left.length > 0) {
      return yield* new CliFailure({
        message: `\nStill needed: ${left.map((r) => r.name).join(", ")}. Run \`ghost setup\` again once that's done; it picks up from there.`,
      })
    }
    yield* Console.log(
      `\n${green("Everything Ghost needs is here.")} Settings are in ${home.config}.\n`,
    )
    if (serverState(home)._tag === "Running") {
      return yield* Console.log("Ghost is already running. `ghost restart` picks up new settings.")
    }
    if (yield* Prompt.Confirm({ message: "Start Ghost now?", initial: true })) yield* start(home)
  })
