import * as WebBrowser from "expo-web-browser"
import { View } from "react-native"
import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown"

import { Ghost, Type } from "@/constants/theme"

const text = { fontFamily: Type.body, color: Ghost.soft }

const heading = (fontSize: number) => ({
  fontFamily: Type.cond,
  fontSize,
  lineHeight: fontSize * 1.15,
  color: Ghost.ink,
  marginTop: 14,
  marginBottom: 6,
})

const style: MarkdownStyle = {
  paragraph: { ...text, fontSize: 16, lineHeight: 23, marginTop: 0, marginBottom: 10 },
  h1: heading(24),
  h2: heading(21),
  h3: heading(18),
  h4: heading(16),
  strong: { fontFamily: Type.bodySemi, color: Ghost.ink },
  em: { color: Ghost.soft },
  link: { color: Ghost.accent, underline: false },
  code: {
    fontFamily: Type.mono,
    fontSize: 13,
    color: Ghost.ink,
    backgroundColor: Ghost.swatch,
    borderColor: Ghost.line,
  },
  codeBlock: {
    fontFamily: Type.mono,
    fontSize: 12,
    lineHeight: 18,
    color: Ghost.soft,
    backgroundColor: Ghost.panel,
    borderColor: Ghost.line,
    borderWidth: 1,
    borderRadius: 0,
    padding: 12,
    marginBottom: 10,
  },
  list: {
    ...text,
    fontSize: 16,
    lineHeight: 23,
    bulletColor: Ghost.accent,
    bulletSize: 5,
    markerColor: Ghost.dim,
    gapWidth: 10,
    marginLeft: 2,
    itemSpacing: 4,
    marginBottom: 10,
  },
  blockquote: {
    ...text,
    fontSize: 15,
    lineHeight: 21,
    color: Ghost.muted,
    borderColor: Ghost.ruleStrong,
    borderWidth: 2,
    gapWidth: 12,
    marginBottom: 10,
  },
  table: {
    ...text,
    fontSize: 13,
    lineHeight: 18,
    headerFontFamily: Type.cond,
    headerBackgroundColor: Ghost.swatch,
    headerTextColor: Ghost.ink,
    rowEvenBackgroundColor: Ghost.panel,
    rowOddBackgroundColor: Ghost.bg,
    borderColor: Ghost.line,
    borderWidth: 1,
    borderRadius: 0,
    cellPaddingHorizontal: 10,
    cellPaddingVertical: 7,
    marginBottom: 10,
  },
  thematicBreak: { color: Ghost.rule, height: 1, marginTop: 8, marginBottom: 12 },
}

/** Ghost's voice for a full answer: the blue rule beside formatted Markdown. */
export function SaidMarkdown({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 2, backgroundColor: Ghost.accent }} />
      <EnrichedMarkdownText
        flavor="github"
        markdown={children}
        markdownStyle={style}
        containerStyle={{ flex: 1 }}
        selectionColor={Ghost.accent}
        onLinkPress={({ url }) => void WebBrowser.openBrowserAsync(url)}
      />
    </View>
  )
}
