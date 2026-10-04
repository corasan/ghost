import { Host, Picker, Text } from "@expo/ui/swift-ui"
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers"
import type { SegmentedProps } from "./types"

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <Host matchContents={{ vertical: true }} colorScheme="dark">
      <Picker selection={value} onSelectionChange={onChange} modifiers={[pickerStyle("segmented")]}>
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  )
}
