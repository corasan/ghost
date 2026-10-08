import type { ExpoConfig } from "expo/config"

// Nothing that ties a build to one person's Apple or Expo account lives here.
// Each value below comes from apps/mobile/.env.local (gitignored, written by
// `bun run app:ios|android`) or from EAS environment variables on the build server.
//   GHOST_APP_ID    iOS bundle id and Android package; must be unique per Apple team
//   APPLE_TEAM_ID   optional; without it `expo run:ios` asks which signing team to use
//   EAS_PROJECT_ID  only for `eas build`; links the app to your EAS project
const appId = process.env.GHOST_APP_ID ?? "com.example.ghost"
const appleTeamId = process.env.APPLE_TEAM_ID
const easProjectId = process.env.EAS_PROJECT_ID

const config: ExpoConfig = {
  name: "Ghost",
  slug: "ghost",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "ghost",
  userInterfaceStyle: "dark",
  ios: {
    icon: "./assets/expo.icon",
    bundleIdentifier: appId,
    supportsTablet: false,
    appleTeamId,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: appId,
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#208AEF",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    "expo-secure-store",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: easProjectId === undefined ? undefined : { eas: { projectId: easProjectId } },
}

export default config
