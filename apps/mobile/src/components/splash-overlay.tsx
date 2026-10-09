import { Image } from 'expo-image'
import * as SplashScreen from 'expo-splash-screen'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, Keyframe } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

const DURATION = 600

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false)
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  })

  const image = <Image style={styles.image} source={require('@/assets/images/splash-icon.png')} />

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet'
        if (finished) {
          scheduleOnRN(setVisible, false)
        }
      })}
      style={styles.splashOverlay}
    >
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true)
        })
      }}
      style={styles.splashOverlay}
    >
      {image}
    </View>
  )
}

const styles = StyleSheet.create({
  image: {
    width: 120,
    height: 120,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#070a10',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
})
