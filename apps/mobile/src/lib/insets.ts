import { Platform } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

export const useBottomInset = () => {
  const { bottom } = useSafeAreaInsets()
  return Platform.OS === "android" ? bottom + 12 : bottom
}
