import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { envFile, mergedEnv, readEnv, run, writeEnv } from './env.ts'

// Builds the app in Release and installs it on a phone plugged into this
// computer, with no EAS account: `bun run app:ios` / `bun run app:android`.
// Add --clean to regenerate ios/ or android/ from scratch first.

type Platform = 'ios' | 'android'
type Check =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly detail: string; readonly fix: string }

const color = process.stdout.isTTY && process.env.NO_COLOR === undefined
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const [bold, dim, red, green] = [paint(1), paint(2), paint(31), paint(32)]

const capture = (command: ReadonlyArray<string>) => {
  try {
    const result = Bun.spawnSync([...command], { stdout: 'pipe', stderr: 'pipe' })
    return {
      ok: result.exitCode === 0,
      out: `${result.stdout.toString()}${result.stderr.toString()}`,
    }
  } catch {
    return { ok: false, out: '' }
  }
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

const xcode = (): Check => {
  const version = capture(['xcodebuild', '-version'])
  return version.ok
    ? { ok: true, detail: firstLine(version.out) }
    : {
        ok: false,
        detail: 'xcodebuild does not run',
        fix: 'Install Xcode from the App Store, open it once, then run: sudo xcode-select -s /Applications/Xcode.app',
      }
}

const cocoapods = (): Check => {
  const version = capture(['pod', '--version'])
  return version.ok
    ? { ok: true, detail: firstLine(version.out) }
    : { ok: false, detail: 'not installed', fix: 'Run: brew install cocoapods' }
}

// A free Apple ID is enough: Xcode creates an "Apple Development" certificate
// for it, and that certificate's team is the one the app is signed with.
const signingIdentity = (): Check => {
  const identities = capture(['security', 'find-identity', '-v', '-p', 'codesigning'])
  const development = identities.out
    .split('\n')
    .filter((line) => line.includes('Apple Development'))
  return development.length > 0
    ? { ok: true, detail: `${development.length} Apple Development certificate(s)` }
    : {
        ok: false,
        detail: 'no Apple Development certificate in your keychain',
        fix: 'Open Xcode > Settings > Accounts, add your Apple ID (free is fine), select its team, Manage Certificates > + > Apple Development',
      }
}

interface DeviceList {
  readonly result?: {
    readonly devices?: ReadonlyArray<{
      readonly hardwareProperties?: { readonly platform?: string }
      readonly deviceProperties?: { readonly name?: string }
      readonly connectionProperties?: { readonly tunnelState?: string }
    }>
  }
}

const iphone = (): Check => {
  const dir = mkdtempSync(join(tmpdir(), 'ghost-devices-'))
  const output = join(dir, 'devices.json')
  try {
    if (!capture(['xcrun', 'devicectl', 'list', 'devices', '--json-output', output]).ok) {
      return { ok: true, detail: 'could not list devices; Expo will ask which one to use' }
    }
    // SAFETY: devicectl's documented --json-output shape; every field read below is optional.
    const list = JSON.parse(readFileSync(output, 'utf8')) as DeviceList
    const phones = (list.result?.devices ?? []).filter(
      (device) =>
        device.hardwareProperties?.platform === 'iOS' &&
        device.connectionProperties?.tunnelState !== 'unavailable',
    )
    return phones.length > 0
      ? {
          ok: true,
          detail: phones.map((phone) => phone.deviceProperties?.name ?? 'iPhone').join(', '),
        }
      : {
          ok: false,
          detail: 'no iPhone connected',
          fix: 'Plug the iPhone in, unlock it and tap Trust. Turn on Settings > Privacy & Security > Developer Mode (it restarts the phone).',
        }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const androidHome = () =>
  [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'),
    join(homedir(), 'Android/Sdk'),
  ].find((path) => path !== undefined && path !== '' && existsSync(path))

const androidSdk = (): Check => {
  const home = androidHome()
  return home === undefined
    ? {
        ok: false,
        detail: 'Android SDK not found',
        fix: 'Install Android Studio, open it once so it downloads the SDK, or set ANDROID_HOME',
      }
    : { ok: true, detail: home }
}

const adbPath = () => {
  const home = androidHome()
  const bundled = home === undefined ? undefined : join(home, 'platform-tools', 'adb')
  return Bun.which('adb') ?? (bundled !== undefined && existsSync(bundled) ? bundled : null)
}

const jdk = (): Check => {
  const version = capture(['java', '-version'])
  return version.ok
    ? { ok: true, detail: version.out.split('\n').find((line) => line.includes('version')) ?? '' }
    : {
        ok: false,
        detail: 'no Java runtime',
        fix: "Install JDK 17: brew install --cask zulu@17 (or point JAVA_HOME at Android Studio's bundled JDK)",
      }
}

const androidPhone = (): Check => {
  const adb = adbPath()
  if (adb === null) {
    return {
      ok: false,
      detail: 'adb not found',
      fix: "Install Android SDK Platform-Tools from Android Studio's SDK Manager",
    }
  }
  const rows = capture([adb, 'devices'])
    .out.split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row.length >= 2)
  const ready = rows.filter((row) => row[1] === 'device')
  if (ready.length > 0) return { ok: true, detail: ready.map((row) => row[0]).join(', ') }
  return rows.some((row) => row[1] === 'unauthorized')
    ? {
        ok: false,
        detail: 'phone connected but not authorized',
        fix: 'Unlock the phone and accept the "Allow USB debugging?" prompt',
      }
    : {
        ok: false,
        detail: 'no Android phone connected',
        fix: 'Turn on Developer options (tap Build number 7 times), enable USB debugging, then plug the phone in',
      }
}

const checks: Record<Platform, ReadonlyArray<readonly [string, () => Check]>> = {
  ios: [
    ['Xcode', xcode],
    ['CocoaPods', cocoapods],
    ['Signing certificate', signingIdentity],
    ['iPhone', iphone],
  ],
  android: [
    ['JDK', jdk],
    ['Android SDK', androidSdk],
    ['Android phone', androidPhone],
  ],
}

// iOS bundle ids allow letters, digits, dots and hyphens; Android packages
// allow letters, digits, dots and underscores. This is what both accept.
const validAppId = (id: string) => /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(id)

// A bundle id belongs to the first Apple team that registers it, so someone
// else's clone cannot reuse Ghost's. Ask once and remember it in .env.local.
const ensureAppId = () => {
  const current = process.env.GHOST_APP_ID ?? readEnv().get('GHOST_APP_ID')
  if (current !== undefined && current !== '') return current
  const user = userInfo()
    .username.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const suggested = `com.${/^[a-z]/.test(user) ? user : 'my'}.ghost`
  console.log(
    `\nPick an app id. It must be unique to your Apple team (a reverse domain such as ${suggested}).`,
  )
  for (;;) {
    const answer = (prompt(`App id [${suggested}]:`) ?? '').trim() || suggested
    if (validAppId(answer)) {
      writeEnv('GHOST_APP_ID', answer)
      console.log(dim(`Saved to ${envFile}`))
      return answer
    }
    console.log(red('Use letters and digits separated by dots, for example com.alex.ghost'))
  }
}

const platform = process.argv[2]
if (platform !== 'ios' && platform !== 'android') {
  console.error('Usage: bun scripts/install.ts ios|android [--clean]')
  process.exit(2)
}
if (platform === 'ios' && process.platform !== 'darwin') {
  console.error(red('Building for iOS needs a Mac with Xcode.'))
  process.exit(1)
}

console.log(bold(`Checking what a release ${platform === 'ios' ? 'iOS' : 'Android'} build needs\n`))
let missing = 0
for (const [name, check] of checks[platform]) {
  const result = check()
  console.log(`${result.ok ? green('✓') : red('✗')} ${name.padEnd(20)} ${dim(result.detail)}`)
  if (!result.ok) {
    missing += 1
    console.log(`  ${result.fix}`)
  }
}
if (missing > 0) {
  console.log(red(`\n${missing} thing(s) to fix first.`))
  process.exit(1)
}

const appId = ensureAppId()
console.log(`\nApp id: ${bold(appId)}`)

// Gradle finds the SDK through ANDROID_HOME, which may only exist at a default path.
const env = {
  ...mergedEnv(),
  GHOST_APP_ID: appId,
  ANDROID_HOME: platform === 'android' ? androidHome() : process.env.ANDROID_HOME,
}

const prebuild = ['bunx', 'expo', 'prebuild', '--platform', platform]
if (process.argv.includes('--clean')) prebuild.push('--clean')

// Release embeds the JS bundle in the app, so no Metro server is needed and the
// app runs untethered. --device with no name lists connected phones to pick from.
const install =
  platform === 'ios'
    ? ['bunx', 'expo', 'run:ios', '--configuration', 'Release', '--device', '--no-bundler']
    : ['bunx', 'expo', 'run:android', '--variant', 'release', '--device', '--no-bundler']

if (!(await run(prebuild, env)) || !(await run(install, env))) process.exit(1)

console.log(green('\nInstalled.'))
if (platform === 'ios') {
  console.log(
    'First launch on iOS: Settings > General > VPN & Device Management, tap your Apple ID and Trust it.',
    '\nWith a free Apple ID the app stops opening after 7 days; run this command again to refresh it.',
  )
}
