import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { useState } from "react"
import { useColorScheme } from "react-native"

import { AnimatedSplashOverlay } from "@/components/animated-icon"

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
          <Stack.Screen name="jobs/[id]" options={{ title: "Task" }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
