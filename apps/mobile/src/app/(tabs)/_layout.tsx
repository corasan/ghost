import { NativeTabs } from "expo-router/unstable-native-tabs"

import { Ghost } from "@/constants/theme"
import { useRecentItems } from "@/lib/api"

export default function TabLayout() {
  const recent = useRecentItems()
  const fresh = recent.data?.length ?? 0

  return (
    <NativeTabs tintColor={Ghost.accent} backgroundColor={Ghost.bg}>
      <NativeTabs.Trigger name="ghost">
        <NativeTabs.Trigger.Label>Ghost</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="diamond.fill" md="chat" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(guardian)">
        <NativeTabs.Trigger.Label>Guardian</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vault">
        <NativeTabs.Trigger.Label>Vault</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="archivebox.fill" md="inventory_2" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="recent">
        <NativeTabs.Trigger.Label>Recent</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.fill" md="schedule" />
        {fresh > 0 ? <NativeTabs.Trigger.Badge>{String(fresh)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
