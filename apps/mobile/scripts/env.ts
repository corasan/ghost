import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** apps/mobile/.env.local: this machine's app id, Apple team and EAS project. Gitignored. */
export const envFile = join(import.meta.dir, "..", ".env.local")

export const readEnv = (): Map<string, string> => {
  const entries = new Map<string, string>()
  if (!existsSync(envFile)) return entries
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      entries.set(match[1], match[2].replace(/^(["'])(.*)\1$/, "$2"))
    }
  }
  return entries
}

/** Sets one key, keeping every other line of the file as it was. */
export const writeEnv = (key: string, value: string) => {
  const lines = existsSync(envFile) ? readFileSync(envFile, "utf8").trimEnd().split("\n") : []
  const kept = lines.filter((line) => !line.startsWith(`${key}=`) && line !== "")
  writeFileSync(envFile, `${[...kept, `${key}=${value}`].join("\n")}\n`)
}

/** The shell wins over the file, the same way Expo resolves it. */
export const mergedEnv = () => ({
  ...Object.fromEntries(readEnv()),
  ...process.env,
})

export const run = async (
  command: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
) => {
  console.log(`\n$ ${command.join(" ")}`)
  const child = Bun.spawn([...command], {
    cwd: join(import.meta.dir, ".."),
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
  return (await child.exited) === 0
}
