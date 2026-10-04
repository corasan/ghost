import { Stack } from "expo-router"

import { Ghost, Type } from "@/constants/theme"

// Every tab owns a native stack so it gets the system large-title header,
// toolbar buttons and back navigation.
export function TabStack() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: true,
        headerTintColor: Ghost.accent,
        headerTitleStyle: { fontFamily: Type.semibold, color: Ghost.text },
        headerLargeTitleStyle: { fontFamily: Type.semibold, color: Ghost.text },
        contentStyle: { backgroundColor: Ghost.bg },
      }}
    />
  )
}
