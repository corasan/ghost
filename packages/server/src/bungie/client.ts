import { BungieNotLinked } from "@ghost/contract"
import { Context, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AppConfig } from "../config.ts"
import { Settings } from "../db/settings.ts"

const PLATFORM = "https://www.bungie.net/Platform"
const OAUTH = "https://www.bungie.net/platform/app/oauth"

// Every Bungie response is an envelope. ErrorCode 1 means success; anything
// else is a Bungie-side failure with a human message, which we surface as a
// typed error instead of a thrown exception.
const Envelope = Schema.Struct({
  Response: Schema.Unknown,
  ErrorCode: Schema.Number,
  ErrorStatus: Schema.String,
  Message: Schema.String,
})

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
  membership_id: Schema.String,
})

export class BungieError extends Schema.TaggedError<BungieError>()("BungieError", {
  status: Schema.String,
  message: Schema.String,
}) {}

export interface BungieTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: string
  readonly membershipId: string
}

export interface TransferItemInput {
  readonly itemReferenceHash: number
  readonly itemId: string
  readonly characterId: string
  readonly membershipType: number
  readonly stackSize?: number | undefined
  readonly transferToVault: boolean
}

export interface BungieClientShape {
  readonly isLinked: Effect.Effect<boolean>
  readonly authorizeUrl: Effect.Effect<string>
  readonly exchangeCode: (code: string) => Effect.Effect<BungieTokens, BungieError>
  /** GET an authenticated Platform endpoint. Returns the raw `Response` field. */
  readonly get: (path: string) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  readonly post: (
    path: string,
    body: unknown,
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  readonly transferItem: (
    input: TransferItemInput,
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  readonly pullFromPostmaster: (
    input: Omit<TransferItemInput, "transferToVault">,
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  /** The item must already be on that character. */
  readonly equipItem: (input: {
    readonly itemId: string
    readonly characterId: string
    readonly membershipType: number
  }) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  /** Puts a free plug such as an armor mod into a socket. The item must be on that character. */
  readonly insertPlug: (input: {
    readonly itemId: string
    readonly characterId: string
    readonly membershipType: number
    readonly socketIndex: number
    readonly plugHash: number
  }) => Effect.Effect<unknown, BungieError | BungieNotLinked>
}

export class BungieClient extends Context.Service<BungieClient, BungieClientShape>()(
  "BungieClient",
) {}

const TOKENS_KEY = "bungie.tokens"

export const BungieClientLive = Layer.effect(
  BungieClient,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const settings = yield* Settings
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("X-API-Key", Redacted.value(config.bungie.apiKey)),
      ),
    )

    const toBungieError = (error: unknown) =>
      new BungieError({ status: "Transport", message: String(error) })

    const unwrap = (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(Envelope)(response).pipe(
        Effect.mapError(toBungieError),
        Effect.flatMap((env) =>
          env.ErrorCode === 1
            ? Effect.succeed(env.Response)
            : Effect.fail(new BungieError({ status: env.ErrorStatus, message: env.Message })),
        ),
      )

    const loadTokens = settings
      .get(TOKENS_KEY)
      .pipe(Effect.orDie, Effect.map(Option.map((raw) => JSON.parse(raw) as BungieTokens)))

    const saveTokens = (tokens: BungieTokens) =>
      settings.set(TOKENS_KEY, JSON.stringify(tokens)).pipe(Effect.orDie)

    const tokenRequest = (form: Record<string, string>) =>
      Effect.gen(function* () {
        const basic = Buffer.from(
          `${config.bungie.clientId}:${Redacted.value(config.bungie.clientSecret)}`,
        ).toString("base64")
        const request = HttpClientRequest.post(`${OAUTH}/token/`).pipe(
          HttpClientRequest.setHeader("Authorization", `Basic ${basic}`),
          HttpClientRequest.bodyUrlParams(form),
        )
        const response = yield* http.execute(request).pipe(Effect.mapError(toBungieError))
        const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response).pipe(
          Effect.mapError(toBungieError),
        )
        const now = yield* DateTime.now
        const tokens: BungieTokens = {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: DateTime.formatIso(DateTime.addDuration(now, `${body.expires_in} seconds`)),
          membershipId: body.membership_id,
        }
        yield* saveTokens(tokens)
        return tokens
      })

    // Tokens are refreshed lazily: right before a request, if the stored
    // access token is within a minute of expiring, swap it using the refresh
    // token. Bungie access tokens last an hour, refresh tokens 90 days.
    const freshTokens = Effect.gen(function* () {
      const stored = yield* loadTokens
      if (Option.isNone(stored)) return yield* new BungieNotLinked({})
      const tokens = stored.value
      const now = yield* DateTime.now
      const expiresAt = DateTime.makeUnsafe(tokens.expiresAt)
      if (DateTime.toEpochMillis(expiresAt) - DateTime.toEpochMillis(now) > 60_000) return tokens
      return yield* tokenRequest({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      })
    })

    const authed = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const tokens = yield* freshTokens
        const response = yield* http
          .execute(HttpClientRequest.bearerToken(request, tokens.accessToken))
          .pipe(Effect.mapError(toBungieError))
        return yield* unwrap(response)
      })

    const get = (path: string) => authed(HttpClientRequest.get(`${PLATFORM}${path}`))

    const post = (path: string, body: unknown) =>
      HttpClientRequest.bodyJson(HttpClientRequest.post(`${PLATFORM}${path}`), body).pipe(
        Effect.mapError(toBungieError),
        Effect.flatMap(authed),
      )

    return {
      isLinked: Effect.map(loadTokens, Option.isSome),
      authorizeUrl: Effect.succeed(
        `https://www.bungie.net/en/OAuth/Authorize?client_id=${config.bungie.clientId}&response_type=code`,
      ),
      exchangeCode: (code) => tokenRequest({ grant_type: "authorization_code", code }),
      get,
      post,
      transferItem: (input) =>
        post("/Destiny2/Actions/Items/TransferItem/", { stackSize: 1, ...input }),
      pullFromPostmaster: (input) =>
        post("/Destiny2/Actions/Items/PullFromPostmaster/", { stackSize: 1, ...input }),
      equipItem: (input) => post("/Destiny2/Actions/Items/EquipItem/", input),
      insertPlug: ({ socketIndex, plugHash, ...item }) =>
        post("/Destiny2/Actions/Items/InsertSocketPlugFree/", {
          ...item,
          plug: { socketIndex, socketArrayType: 0, plugItemHash: plugHash },
        }),
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
