import { $ } from "bun"
import { Schema } from "effect"
import qrcode from "qrcode-terminal"

const port = process.env.GHOST_PORT ?? "4848"

await $`tailscale serve --bg --https=${port} http://127.0.0.1:${port}`.quiet()

const TailscaleStatus = Schema.Struct({ Self: Schema.Struct({ DNSName: Schema.String }) })

const status = Schema.decodeUnknownSync(TailscaleStatus)(await $`tailscale status --json`.json())
const url = `https://${status.Self.DNSName.replace(/\.$/, "")}:${port}`
const link = `ghost://connect?url=${encodeURIComponent(url)}`

console.log(`\nGhost server on the tailnet: ${url}\n`)
qrcode.generate(link, { small: true })
console.log(`Scan with the phone's camera, or open: ${link}\n`)
