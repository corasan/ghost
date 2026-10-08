import qrcode from "qrcode-terminal"

const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)

export const bold = paint(1)
export const dim = paint(2)
export const red = paint(31)
export const green = paint(32)
export const yellow = paint(33)
export const cyan = paint(36)

export const qr = (text: string) =>
  new Promise<string>((resolve) => qrcode.generate(text, { small: true }, resolve))
