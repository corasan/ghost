import {
  Cause,
  Config,
  Effect,
  Exit,
  Formatter,
  Layer,
  Logger,
  LogLevel,
  Option,
  Predicate,
  References,
} from "effect"
import { HttpServerError, HttpServerRequest, type HttpServerResponse } from "effect/http"

const ansi = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`
const plain = (text: string) => text
const tty = process.stdout.isTTY === true
const paint = (code: number) => (tty ? ansi(code) : plain)

const dim = paint(2)
const bold = paint(1)
const red = paint(31)
const green = paint(32)
const yellow = paint(33)
const blue = paint(34)
const magenta = paint(35)
const cyan = paint(36)

const levelLabels: Record<LogLevel.LogLevel, string> = {
  All: dim("ALL  "),
  Trace: dim("TRACE"),
  Debug: dim("DEBUG"),
  Info: blue("INFO "),
  Warn: yellow("WARN "),
  Error: red("ERROR"),
  Fatal: bold(red("FATAL")),
  None: "     ",
}

const clock = (date: Date) =>
  dim(
    [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((part) => String(part).padStart(2, "0"))
      .join(":"),
  )

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")

const line = Logger.make(({ message, logLevel, cause, fiber, date }) => {
  const now = date.getTime()
  const annotations = Object.entries(fiber.getRef(References.CurrentLogAnnotations)).map(
    ([key, value]) => `${key}=${Formatter.format(value)}`,
  )
  const spans = fiber
    .getRef(References.CurrentLogSpans)
    .map(([label, start]) => `${label}=${now - start}ms`)
  const context = [...annotations, ...spans]
  const head = [
    clock(date),
    levelLabels[logLevel],
    [message]
      .flat()
      .map((part) => (Predicate.isString(part) ? part : Formatter.format(part)))
      .join(" "),
  ]
  if (context.length > 0) head.push(dim(context.join(" ")))
  const output =
    cause.reasons.length === 0
      ? head.join(" ")
      : `${head.join(" ")}\n${dim(indent(Cause.pretty(cause)))}`
  if (LogLevel.isGreaterThanOrEqualTo(logLevel, "Warn")) console.error(output)
  else console.log(output)
})

export const LoggerLive = Layer.mergeAll(
  Logger.layer([line]),
  Layer.effect(
    References.MinimumLogLevel,
    Config.LogLevel("GHOST_LOG_LEVEL").pipe(Config.withDefault("Info")),
  ),
)

const methodColor = (method: string) => {
  switch (method) {
    case "GET":
      return cyan
    case "POST":
      return green
    case "PUT":
    case "PATCH":
      return yellow
    case "DELETE":
      return red
    default:
      return magenta
  }
}

const statusColor = (status: number) =>
  status >= 500 ? red : status >= 400 ? yellow : status >= 300 ? cyan : green

const levelFor = (method: string, status: number): LogLevel.Severity =>
  status >= 500 ? "Error" : status >= 400 ? "Warn" : method === "GET" ? "Debug" : "Info"

const pathOf = (url: string) => url.split(/[?#]/)[0] ?? url

export const requestLogger = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const start = Date.now()
    const exit = yield* Effect.exit(app)
    const [status, cause] = Exit.isSuccess(exit)
      ? [exit.value.status, Cause.empty]
      : responseOf(exit.cause)
    const summary = [
      methodColor(request.method)(request.method.padEnd(6)),
      pathOf(request.url),
      statusColor(status)(String(status)),
      dim(`${Date.now() - start}ms`),
    ].join(" ")
    yield* Effect.logWithLevel(levelFor(request.method, status))(summary, cause)
    return yield* exit
  })

const responseOf = <E>(cause: Cause.Cause<E>) => {
  const [response, rest] = HttpServerError.causeResponseStripped(cause)
  return [response.status, Option.getOrElse(rest, () => Cause.empty)] as const
}
