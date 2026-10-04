import { NativeTabs } from "expo-router/unstable-native-tabs"
import { colors } from "@/theme"

// NativeTabs renders UITabBarController on iOS and a Material bottom
// navigation bar on Android. The four tabs and their order come from the
// design: Ghost (chat), Guardian (home, the initial tab), Vault, Recent.
export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={colors.bg}
      iconColor={{ default: colors.muted, selected: colors.accent }}
      labelStyle={{ default: { color: colors.muted }, selected: { color: colors.accent } }}
      indicatorColor={colors.surface}
    >
      <NativeTabs.Trigger name="ghost">
        <NativeTabs.Trigger.Label>Ghost</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="diamond.fill" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Guardian</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="circle.fill" md="person" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vault">
        <NativeTabs.Trigger.Label>Vault</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.fill" md="inventory_2" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="recent">
        <NativeTabs.Trigger.Label>Recent</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.fill.on.square" md="new_releases" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
