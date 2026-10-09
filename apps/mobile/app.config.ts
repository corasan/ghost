import type { ExpoConfig } from 'expo/config'

// Nothing that ties a build to one person's Apple or Expo account lives here.
// Each value below comes from apps/mobile/.env.local (gitignored, written by
// `bun run app:ios|android`) or from EAS environment variables on the build server.
//   GHOST_APP_ID    iOS bundle id and Android package; must be unique per Apple team
//   APPLE_TEAM_ID   optional; without it `expo run:ios` asks which signing team to use
//   EAS_PROJECT_ID  only for `eas build`; links the app to your EAS project
//   UPDATES_URL     only for `eas build`/`eas update`: https://u.expo.dev/<EAS_PROJECT_ID>.
//                   Without it updates are off and the app only runs the JS it shipped with.
const appId = process.env.GHOST_APP_ID ?? 'com.example.ghost'
const appleTeamId = process.env.APPLE_TEAM_ID
const easProjectId = process.env.EAS_PROJECT_ID
const updatesUrl = process.env.UPDATES_URL

const config: ExpoConfig = {
  name: 'Ghost',
  slug: 'ghost',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'ghost',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: appId,
    supportsTablet: false,
    appleTeamId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#070a10',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    package: appId,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#070a10',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
    'expo-secure-store',
  ],
  // An update only reaches builds whose native code hashes the same, so changing
  // a native dependency or plugin needs a new build instead of `bun run app:update`.
  runtimeVersion: {
    policy: 'fingerprint',
  },
  updates: updatesUrl === undefined ? { enabled: false } : { url: updatesUrl },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: easProjectId === undefined ? undefined : { eas: { projectId: easProjectId } },
}

export default config
