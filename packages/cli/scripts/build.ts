import { copyFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { $ } from "bun"

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    outfile: { type: "string", default: "dist/ghost" },
    install: { type: "boolean", default: false },
    "install-dir": { type: "string", default: join(homedir(), ".local/bin") },
  },
})

const outfile = resolve(import.meta.dir, "..", values.outfile)
const target = values.target === undefined ? [] : [`--target=${values.target}`]

await $`bun build ${resolve(import.meta.dir, "../src/main.ts")} --compile --minify ${target} --outfile ${outfile}`
console.log(`Built ${outfile}`)

if (values.install) {
  const dir = values["install-dir"]
  mkdirSync(dir, { recursive: true })
  const installed = join(dir, "ghost")
  copyFileSync(outfile, installed)
  console.log(`Installed ${installed}`)
  const onPath = (process.env.PATH ?? "").split(":").includes(dir)
  if (!onPath) console.log(`Add ${dir} to your PATH to run \`ghost\` from anywhere.`)
  console.log("Next: ghost setup")
}
