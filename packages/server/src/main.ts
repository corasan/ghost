import { BunRuntime } from '@effect/platform-bun'
import { Layer } from 'effect'
import { ServerLive } from './server.ts'

BunRuntime.runMain(Layer.launch(ServerLive))
