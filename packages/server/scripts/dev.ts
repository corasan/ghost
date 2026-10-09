import { type FSWatcher, watch } from 'node:fs'
import { type Subprocess, spawn } from 'bun'

const WATCHED = ['src', '../contract/src']
const SETTLE_MS = 150

let child: Subprocess | null = null
let timer: ReturnType<typeof setTimeout> | undefined

const start = () => {
  child = spawn(['bun', 'src/main.ts'], { stdio: ['inherit', 'inherit', 'inherit'] })
}

const restart = async () => {
  const running = child
  child = null
  if (running !== null) {
    running.kill('SIGTERM')
    await running.exited
  }
  console.log('\n[dev] restarting\n')
  start()
}

const watchers: FSWatcher[] = WATCHED.map((dir) =>
  watch(dir, { recursive: true }, (_event, file) => {
    if (file === null || !/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) return
    clearTimeout(timer)
    timer = setTimeout(() => void restart(), SETTLE_MS)
  }),
)

const stop = async () => {
  for (const watcher of watchers) watcher.close()
  child?.kill('SIGTERM')
  await child?.exited
  process.exit(0)
}

process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())

start()
