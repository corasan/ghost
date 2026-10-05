/**
 * Links in Ghost's answers come from the model, which reads web pages, so
 * they are untrusted. Only plain web addresses are opened; anything else
 * (app schemes, javascript:, file:, malformed text) is ignored.
 */
export const webUrl = (link: string): string | null => {
  try {
    const url = new URL(link.trim())
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}
