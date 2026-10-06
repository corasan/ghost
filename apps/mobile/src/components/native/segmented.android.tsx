import { SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from "@expo/ui/jetpack-compose"
import type { SegmentedProps } from "./types"

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <SingleChoiceSegmentedButtonRow>
      {options.map((option) => (
        <SegmentedButton
          key={option.value}
          selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <SegmentedButton.Label>
            <Text>{option.label}</Text>
          </SegmentedButton.Label>
        </SegmentedButton>
      ))}
    </SingleChoiceSegmentedButtonRow>
  )
}
