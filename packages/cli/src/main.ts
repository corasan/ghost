#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Console, Effect, Terminal } from "effect"
import { Command, Flag } from "effect/cli"
import pkg from "../package.json" with { type: "json" }
import { doctor, setup } from "./checkup.ts"
import { ghostHome } from "./home.ts"
import { logs, pair, restart, runForeground, start, status, stop } from "./lifecycle.ts"
import { red } from "./ui.ts"

const home = ghostHome()

const setupCommand = Command.make("setup", {}, () => setup(home)).pipe(
  Command.withDescription("Walk through everything Ghost needs on this machine"),
)

const doctorCommand = Command.make("doctor", {}, () => doctor(home)).pipe(
  Command.withDescription("Check that this machine has everything Ghost needs"),
)

const startCommand = Command.make(
  "start",
  {
    foreground: Flag.Boolean("foreground").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Run in this terminal instead of the background"),
      Flag.withDefault(false),
    ),
  },
  ({ foreground }) => (foreground ? runForeground(home) : start(home)),
).pipe(Command.withDescription("Start the server (in the background unless --foreground)"))

const stopCommand = Command.make("stop", {}, () => stop(home)).pipe(
  Command.withDescription("Stop the background server"),
)

const restartCommand = Command.make("restart", {}, () => restart(home)).pipe(
  Command.withDescription("Stop the server and start it again"),
)

const statusCommand = Command.make("status", {}, () => status(home)).pipe(
  Command.withDescription("Show whether the server is running and where to reach it"),
)

const logsCommand = Command.make(
  "logs",
  {
    follow: Flag.Boolean("follow").pipe(
      Flag.withAlias("f"),
      Flag.withDescription("Keep printing new lines"),
      Flag.withDefault(false),
    ),
    lines: Flag.Int("lines").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("How many recent lines to print"),
      Flag.withDefault(50),
    ),
  },
  ({ follow, lines }) => logs(home, lines, follow),
).pipe(Command.withDescription("Print the background server's logs"))

const pairCommand = Command.make("pair", {}, () => pair(home)).pipe(
  Command.withDescription("Show the QR code that connects the phone app"),
)

const ghost = Command.make("ghost").pipe(
  Command.withDescription("Run the Ghost server for the Destiny 2 companion app"),
  Command.withSubcommands([
    setupCommand,
    doctorCommand,
    startCommand,
    stopCommand,
    restartCommand,
    statusCommand,
    logsCommand,
    pairCommand,
  ]),
)

Command.run(ghost, { version: pkg.version }).pipe(
  Effect.catchTag("CliFailure", (failure) =>
    Effect.andThen(
      Console.error(red(failure.message)),
      Effect.sync(() => (process.exitCode = 1)),
    ),
  ),
  Effect.catchIf(Terminal.isQuitError, () =>
    Effect.andThen(
      Console.error("\nCancelled."),
      Effect.sync(() => (process.exitCode = 130)),
    ),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
)
