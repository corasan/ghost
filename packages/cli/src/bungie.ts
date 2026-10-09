import { Effect, Option, Schema } from 'effect'

const Reply = Schema.Struct({ ErrorCode: Schema.Number, Message: Schema.String })

export const BUNGIE_APPS = 'https://www.bungie.net/en/Application'

export const callbackPath = '/auth/bungie/callback'

/** Asks Bungie whether the API key is real. Returns the reason when it is not. */
export const verifyApiKey = (apiKey: string) =>
  Effect.promise(async () => {
    const response = await fetch('https://www.bungie.net/Platform/Destiny2/Manifest/', {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (response === null) return Option.some('could not reach bungie.net')
    const reply = Option.getOrNull(
      Schema.decodeUnknownOption(Schema.fromJsonString(Reply))(await response.text()),
    )
    if (reply === null) return Option.some(`bungie.net answered with HTTP ${response.status}`)
    return reply.ErrorCode === 1 ? Option.none() : Option.some(reply.Message)
  })
