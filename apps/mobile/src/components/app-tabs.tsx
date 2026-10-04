import { NativeTabs } from "expo-router/unstable-native-tabs"
import { useColorScheme } from "react-native"

import { Colors } from "@/constants/theme"

// NativeTabs renders UITabBarController on iOS and a Material bottom
// navigation bar on Android. Icons are SF Symbols on iOS and Material
// drawables on Android, so each platform shows its own icon set.
export default function AppTabs() {
  const scheme = useColorScheme()
  const colors = Colors[scheme === "unspecified" ? "light" : scheme]

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="builds">
        <NativeTabs.Trigger.Label>Builds</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="figure.run" md="fitness_center" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="weapons">
        <NativeTabs.Trigger.Label>Weapons</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="scope" md="my_location" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vault">
        <NativeTabs.Trigger.Label>Vault</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="archivebox.fill" md="inventory_2" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" md="history" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
