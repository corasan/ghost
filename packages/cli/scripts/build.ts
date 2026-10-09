import { copyFileSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { $ } from 'bun'
import pkg from '../package.json' with { type: 'json' }

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    outfile: { type: 'string', default: 'dist/ghost' },
    install: { type: 'boolean', default: false },
    'install-dir': { type: 'string', default: join(homedir(), '.local/bin') },
    // The release workflow passes the tag's version; without it this is a build from a clone.
    release: { type: 'string' },
  },
})

const outfile = resolve(import.meta.dir, '..', values.outfile)
const target = values.target === undefined ? [] : [`--target=${values.target}`]
const source = resolve(import.meta.dir, '../../..')

if (values.release !== undefined && !/^\d+\.\d+\.\d+$/.test(values.release))
  throw new Error(`--release takes a version like 1.2.3, not ${values.release}`)

// `ghost update` reads this to know where a newer version comes from: GitHub, or this clone.
const build =
  values.release === undefined
    ? {
        kind: 'clone',
        version: pkg.version,
        source,
        commit: (await $`git -C ${source} rev-parse HEAD`.text()).trim(),
      }
    : { kind: 'release', version: values.release }

await $`bun build ${resolve(import.meta.dir, '../src/main.ts')} --compile --minify --no-compile-autoload-dotenv ${target} --define ${`GHOST_BUILD=${JSON.stringify(build)}`} --outfile ${outfile}`
console.log(`Built ${outfile}`)

if (values.install) {
  const dir = values['install-dir']
  mkdirSync(dir, { recursive: true })
  const installed = join(dir, 'ghost')
  // Copy beside it and rename over it: writing into a binary that is running fails, or corrupts it.
  copyFileSync(outfile, `${installed}.update`)
  renameSync(`${installed}.update`, installed)
  console.log(`Installed ${installed}`)
  const onPath = (process.env.PATH ?? '').split(':').includes(dir)
  if (!onPath) console.log(`Add ${dir} to your PATH to run \`ghost\` from anywhere.`)
  console.log('Next: ghost setup')
}
