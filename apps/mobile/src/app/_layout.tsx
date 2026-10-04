import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular"
import { Outfit_300Light } from "@expo-google-fonts/outfit/300Light"
import { Outfit_400Regular } from "@expo-google-fonts/outfit/400Regular"
import { Outfit_500Medium } from "@expo-google-fonts/outfit/500Medium"
import { Outfit_600SemiBold } from "@expo-google-fonts/outfit/600SemiBold"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useFonts } from "expo-font"
import { DarkTheme, Stack, ThemeProvider } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useState } from "react"

import { AnimatedSplashOverlay } from "@/components/animated-icon"
import { Ghost } from "@/constants/theme"
import { useHealth } from "@/lib/api"

SplashScreen.preventAutoHideAsync()

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Ghost.bg, card: Ghost.bg, primary: Ghost.accent },
}

// Nothing in the app is reachable until the server reports a linked Bungie
// account. Settings stays open so the server address can be fixed first.
function RootStack() {
  const health = useHealth()
  if (health.isPending) return null
  const linked = health.data?.bungieLinked === true

  return (
    <Stack>
      <Stack.Protected guard={linked}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="jobs/[id]" options={{ title: "Task" }} />
      </Stack.Protected>
      <Stack.Protected guard={!linked}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen
        name="settings"
        options={{
          title: "Settings",
          presentation: "formSheet",
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
        }}
      />
    </Stack>
  )
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient())
  const [fontsLoaded, fontError] = useFonts({
    Outfit_300Light,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    JetBrainsMono_400Regular,
  })
  if (!fontsLoaded && !fontError) return null
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        <AnimatedSplashOverlay />
        <RootStack />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
