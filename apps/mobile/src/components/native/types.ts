import type { ReactNode } from "react"

// Screens are written once against these props. Each primitive has an
// .ios.tsx file built on SwiftUI (@expo/ui/swift-ui), an .android.tsx file
// built on Jetpack Compose (@expo/ui/jetpack-compose), and a plain .tsx
// React Native fallback that TypeScript resolves against.

export interface ScreenProps {
  readonly children: ReactNode
  readonly onRefresh?: () => Promise<unknown>
}

export interface SectionProps {
  readonly title?: string
  readonly footer?: string
  readonly children: ReactNode
}

export interface RowProps {
  readonly title: string
  readonly subtitle?: string
  readonly detail?: string
  readonly onPress?: () => void
}

export interface ButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly destructive?: boolean
  readonly prominent?: boolean
}

export interface TextFieldProps {
  readonly placeholder: string
  readonly initialValue?: string
  readonly onChange: (value: string) => void
  readonly keyboard?: "default" | "url" | "numeric"
  readonly multiline?: boolean
}

export interface SpinnerProps {
  readonly label?: string
}

export interface EmptyProps {
  readonly title: string
  readonly description?: string
}
