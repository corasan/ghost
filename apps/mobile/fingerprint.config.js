// APPLE_TEAM_ID only picks the signing team for local `expo run:ios` builds.
// EAS signs with its own credentials and never sets it, so leaving it in the
// fingerprint makes `bun run app:update` on a machine with it in .env.local
// compute a different runtime version than the EAS build it targets.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  fileHookTransform: (source, chunk) => {
    if (source.type !== 'contents' || source.id !== 'expoConfig') return chunk
    const config = JSON.parse(chunk)
    delete config.ios?.appleTeamId
    return JSON.stringify(config)
  },
}
