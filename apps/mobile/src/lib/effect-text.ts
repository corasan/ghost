/** Bungie's effect text carries glyph tokens like "[Stasis]" that have no icon here. */
export const plain = (text: string) =>
  text
    .replace(/\[[^\]]*\]\s*:?\s*/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()

export const firstParagraph = (text: string) => plain(text.split(/\n\s*\n/)[0] ?? "")

export const firstSentence = (text: string) =>
  firstParagraph(text)
    .replace(/\s+/g, " ")
    .replace(/(?<=[.!?]) .*$/, "")
