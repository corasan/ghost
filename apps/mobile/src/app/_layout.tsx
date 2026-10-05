import { Barlow_400Regular } from "@expo-google-fonts/barlow/400Regular"
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium"
import { Barlow_600SemiBold } from "@expo-google-fonts/barlow/600SemiBold"
import { BarlowCondensed_500Medium } from "@expo-google-fonts/barlow-condensed/500Medium"
import { BarlowCondensed_600SemiBold } from "@expo-google-fonts/barlow-condensed/600SemiBold"
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular"
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { useFonts } from "expo-font"
import { DarkTheme, Stack, ThemeProvider } from "expo-router"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import * as SecureStore from "expo-secure-store"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { Platform } from "react-native"

import { AnimatedSplashOverlay } from "@/components/animated-icon"
import { Ghost } from "@/constants/theme"
import { useHealth } from "@/lib/api"
import { persistOptions, queryClient } from "@/lib/query"

SplashScreen.preventAutoHideAsync()

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Ghost.bg, card: Ghost.bg, primary: Ghost.accent },
}

const LINKED_KEY = "ghost.linked"

const presentation = Platform.OS === "ios" ? "formSheet" : "modal"

function RootStack() {
  const { top } = useSafeAreaInsets()
  const sheet = {
    presentation,
    sheetGrabberVisible: true,
    contentStyle: {
      backgroundColor: Ghost.panel,
      paddingTop: Platform.OS === "android" ? top : 0,
    },
  } as const
  const health = useHealth()
  const known = health.data?.bungieLinked
  useEffect(() => {
    if (known !== undefined) SecureStore.setItem(LINKED_KEY, String(known))
  }, [known])
  // Until the server answers, trust what it said last time, so a slow or
  // unreachable server never leaves the app on a blank screen.
  const linked = known ?? SecureStore.getItem(LINKED_KEY) === "true"

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Ghost.bg } }}>
      <Stack.Protected guard={linked}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="item/[id]" options={{ ...sheet, sheetAllowedDetents: [1] }} />
        <Stack.Screen
          name="item-actions/[id]"
          options={{ ...sheet, sheetAllowedDetents: [0.5, 1] }}
        />
        <Stack.Screen name="plan/[id]" options={{ ...sheet, sheetAllowedDetents: [1] }} />
        <Stack.Screen name="subclass" options={{ ...sheet, sheetAllowedDetents: [1] }} />
        <Stack.Screen name="vault-filter" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
      </Stack.Protected>
      <Stack.Protected guard={!linked}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Screen name="connect" />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: true,
          title: "Settings",
          presentation,
          sheetAllowedDetents: [0.6, 1],
          sheetGrabberVisible: true,
        }}
      />
    </Stack>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  })
  if (!fontsLoaded && !fontError) return null
  return (
    <KeyboardProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <AnimatedSplashOverlay />
          <RootStack />
        </ThemeProvider>
      </PersistQueryClientProvider>
    </KeyboardProvider>
  )
}
