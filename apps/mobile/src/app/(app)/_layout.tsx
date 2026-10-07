import { Drawer } from "expo-router/drawer"
import { GestureHandlerRootView } from "react-native-gesture-handler"

import { GhostDrawer } from "@/components/drawer"
import { Ghost } from "@/constants/theme"

export default function AppLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Ghost.bg }}>
      <Drawer
        drawerContent={(props) => <GhostDrawer {...props} />}
        screenOptions={{
          headerShown: false,
          drawerType: "front",
          drawerStyle: { width: 304, backgroundColor: Ghost.panel },
          overlayColor: Ghost.scrim,
          sceneStyle: { backgroundColor: Ghost.bg },
          swipeEdgeWidth: 40,
        }}
      >
        <Drawer.Screen name="index" />
        <Drawer.Screen name="guardian" />
        <Drawer.Screen name="builds" />
        <Drawer.Screen name="vault" />
        <Drawer.Screen name="recent" />
        <Drawer.Screen name="history" />
        <Drawer.Screen name="cleanup" />
      </Drawer>
    </GestureHandlerRootView>
  )
}
