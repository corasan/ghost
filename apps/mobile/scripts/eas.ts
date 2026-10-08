import { mergedEnv, run } from "./env.ts"

// EAS CLI does not read .env.local, but app.config.ts needs EAS_PROJECT_ID from
// it to know which EAS project this is. Forward every argument to eas-cli with
// that file loaded: `bun run eas build --profile adhoc --platform all`.
process.exit((await run(["bunx", "eas-cli@latest", ...process.argv.slice(2)], mergedEnv())) ? 0 : 1)
