import { randomBytes } from "node:crypto"
import { BungieNotLinked } from "@ghost/contract"
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
  Schema,
  Semaphore,
} from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AppConfig } from "../config.ts"
import { Settings } from "../db/settings.ts"

const PLATFORM = "https://www.bungie.net/Platform"
const OAUTH = "https://www.bungie.net/platform/app/oauth"

/** How long one Platform call may take, reading the reply included. */
export const PLATFORM_TIMEOUT = "30 seconds"

// Every Bungie response is an envelope. ErrorCode 1 means success; anything
// else is a Bungie-side failure with a human message, which we surface as a
// typed error instead of a thrown exception. An error reply often has no
// Response at all.
const Envelope = Schema.Struct({
  Response: Schema.optionalKey(Schema.Unknown),
  ErrorCode: Schema.Number,
  ErrorStatus: Schema.String,
  Message: Schema.String,
  ThrottleSeconds: Schema.optionalKey(Schema.Number),
})

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
  refresh_expires_in: Schema.optionalKey(Schema.Number),
  membership_id: Schema.String,
})

/** What the OAuth token endpoint sends with a 400 or 401. */
const TokenFailure = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optionalKey(Schema.String),
})

export class BungieError extends Schema.TaggedError<BungieError>()("BungieError", {
  status: Schema.String,
  message: Schema.String,
  /** Bungie's PlatformErrorCode; absent when no envelope came back. */
  errorCode: Schema.optionalKey(Schema.Number),
  /** How long Bungie asked us to wait before the next call. */
  throttleSeconds: Schema.optional(Schema.Number),
}) {}

// PlatformErrorCodes, from Bungie's API spec.

/** Rate limits: Bungie refused the call before doing anything, so even an action can be sent again. */
const THROTTLED: ReadonlySet<number> = new Set([
  31, // ThrottleLimitExceeded
  35, // ThrottleLimitExceededMinutes
  36, // ThrottleLimitExceededMomentarily
  37, // ThrottleLimitExceededSeconds
  51, // PerEndpointRequestThrottleExceeded
  54, // PerApplicationThrottleExceeded
  55, // PerApplicationAnonymousThrottleExceeded
  56, // PerApplicationAuthenticatedThrottleExceeded
  57, // PerUserThrottleExceeded
  1672, // DestinyThrottledByGameServer
])

/** Hiccups behind the API. An action may have gone through anyway, so only reads are sent again. */
const TRANSIENT: ReadonlySet<number> = new Set([
  27, // ExternalServiceTimeout
  1618, // DestinyUnexpectedError
  1643, // DestinyServiceFailure
  1651, // DestinyShardRelayClientTimeout
  1652, // DestinyShardRelayProxyTimeout
  1688, // DestinyDirectBabelClientTimeout
])

/** The access token was refused for its age; a refresh fixes it. */
const EXPIRED_ACCESS: ReadonlySet<number> = new Set([
  2111, // AccessTokenHasExpired
  2115, // OAuthAccessTokenExpired
])

/** The grant itself is gone: the player has to sign in again. */
const SIGNED_OUT: ReadonlySet<number> = new Set([
  99, // WebAuthRequired
  2117, // ProvidedTokenNotValidRefreshToken
  2118, // RefreshTokenExpired
  2119, // AuthorizationRecordInvalid
  2120, // TokenPreviouslyRevoked
  2121, // TokenInvalidMembership
  2123, // AuthorizationRecordExpired
  2124, // AuthorizationRecordRevoked
])

/** Problems with Ghost's own API key, which signing in again would not fix. */
const API_KEY_CODES: ReadonlySet<number> = new Set([2101, 2102, 2103, 2107])

const hasCode = (codes: ReadonlySet<number>, error: BungieError) =>
  error.errorCode !== undefined && codes.has(error.errorCode)

/** No reply, or one that was not an envelope (a proxy error page, a cut-off body). */
const isTransport = (error: BungieError) =>
  error.status === "Transport" || error.status === "Timeout"

/**
 * Whether a failed call can be sent again. Reads can always be repeated;
 * an action only when Bungie said it did no work, which a throttle reply
 * says and a dropped connection does not.
 */
export const isRetryable = (error: BungieError, idempotent: boolean) =>
  hasCode(THROTTLED, error) || (idempotent && (isTransport(error) || hasCode(TRANSIENT, error)))

const MAX_RETRIES = 3
/** A throttle longer than this is not waited out inside a request; the caller sees the error. */
const MAX_WAIT_MS = 30_000

/**
 * Up to three retries for errors {@link isRetryable} allows, backing off
 * exponentially from a second, and never sooner than Bungie's ThrottleSeconds.
 */
export const retryPolicy = (idempotent: boolean) =>
  Schedule.exponential("1 second").pipe(
    Schedule.setInputType<BungieError | BungieNotLinked>(),
    Schedule.while(
      ({ input, attempt }) =>
        attempt <= MAX_RETRIES &&
        input._tag === "BungieError" &&
        isRetryable(input, idempotent) &&
        (input.throttleSeconds ?? 0) * 1000 <= MAX_WAIT_MS,
    ),
    Schedule.modifyDelay(({ input, duration }) =>
      Effect.succeed(
        Math.max(
          Duration.toMillis(duration),
          input._tag === "BungieError" ? (input.throttleSeconds ?? 0) * 1000 : 0,
        ),
      ),
    ),
  )

/** Fails with a "Timeout" BungieError when `self` takes longer than `duration`. */
export const timeoutAfter =
  (duration: Duration.Input) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.timeoutOrElse(self, {
      duration,
      orElse: () =>
        Effect.fail(
          new BungieError({
            status: "Timeout",
            message: `no reply from Bungie within ${Duration.format(Duration.fromInputUnsafe(duration))}`,
          }),
        ),
    })

const toBungieError = (cause: unknown) =>
  new BungieError({ status: "Transport", message: String(cause) })

export const envelopeError = (envelope: typeof Envelope.Type) =>
  new BungieError({
    status: envelope.ErrorStatus,
    message: envelope.Message,
    errorCode: envelope.ErrorCode,
    throttleSeconds: envelope.ThrottleSeconds || undefined,
  })

/**
 * The `Response` of a Platform reply, or a BungieError carrying Bungie's
 * code when ErrorCode is not 1. `undefined` when a successful reply has no
 * Response, which is how Bungie answers for something that does not exist.
 */
export const readEnvelope = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(Envelope)(response).pipe(
    Effect.mapError(toBungieError),
    Effect.flatMap((envelope) =>
      envelope.ErrorCode === 1
        ? Effect.succeed(envelope.Response)
        : Effect.fail(envelopeError(envelope)),
    ),
  )

const BungieTokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.String,
  /** Absent on tokens stored before Ghost kept it. */
  refreshExpiresAt: Schema.optional(Schema.String),
  membershipId: Schema.String,
})

export type BungieTokens = typeof BungieTokens.Type

const decodeTokens = Schema.decodeEffect(Schema.fromJsonString(BungieTokens))

export interface CharacterAction {
  readonly characterId: string
  readonly membershipType: number
}

export interface ItemAction extends CharacterAction {
  readonly itemId: string
}

export interface LoadoutSnapshot extends CharacterAction {
  readonly loadoutIndex: number
  readonly nameHash: number
  readonly colorHash: number
  readonly iconHash: number
}

export interface TransferItemInput extends ItemAction {
  readonly itemReferenceHash: number
  readonly stackSize?: number | undefined
  readonly transferToVault: boolean
}

export interface BungieClientService {
  readonly isLinked: Effect.Effect<boolean>
  /** Bungie's sign-in page, with a one-time `state` the callback has to bring back. */
  readonly authorizeUrl: Effect.Effect<string>
  /** Fails unless `state` came from {@link authorizeUrl} in the last ten minutes, and uses it up. */
  readonly exchangeCode: (code: string, state: string) => Effect.Effect<BungieTokens, BungieError>
  /** GET an authenticated Platform endpoint. Returns the raw `Response` field. */
  readonly get: (path: string) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  readonly transferItem: (
    input: TransferItemInput,
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  readonly pullFromPostmaster: (
    input: Omit<TransferItemInput, "transferToVault">,
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  /** The item must already be on that character. */
  readonly equipItem: (input: ItemAction) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  /** Puts a free plug such as an armor mod into a socket. The item must be on that character. */
  readonly insertPlug: (
    input: ItemAction & { readonly socketIndex: number; readonly plugHash: number },
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
  readonly snapshotLoadout: (
    input: LoadoutSnapshot,
  ) => Effect.Effect<unknown, BungieError | BungieNotLinked>
}

export class BungieClient extends Context.Service<BungieClient, BungieClientService>()(
  "BungieClient",
) {}

const TOKENS_KEY = "bungie.tokens"
/** The Destiny membership the stored tokens act on (see profile.ts); forgotten whenever the tokens change. */
export const MEMBERSHIP_KEY = "bungie.membership"
const STATE_TTL_MS = 10 * 60 * 1000

const millisOf = (iso: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(iso))

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
    // Sign-ins started with authorizeUrl and not finished yet: state to when it lapses.
    const pendingStates = new Map<string, number>()
    const refreshLock = yield* Semaphore.make(1)

    const loadTokens = settings.get(TOKENS_KEY).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (raw) => Effect.asSome(decodeTokens(raw)),
        }),
      ),
      Effect.orDie,
    )

    const storedTokens = Effect.flatMap(
      loadTokens,
      Option.match({
        onNone: () => Effect.fail(new BungieNotLinked({})),
        onSome: Effect.succeed,
      }),
    )

    const saveTokens = (tokens: BungieTokens) =>
      settings.set(TOKENS_KEY, JSON.stringify(tokens)).pipe(Effect.orDie)

    // Forgetting the tokens is what turns isLinked false, so the app asks
    // the player to sign in again.
    const signOut = (reason: string) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(`bungie: signed out (${reason})`)
        yield* settings.remove(TOKENS_KEY).pipe(Effect.orDie)
        yield* settings.remove(MEMBERSHIP_KEY).pipe(Effect.orDie)
        return yield* new BungieNotLinked({})
      })

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
        if (response.status !== 200) {
          // The OAuth error name ("invalid_grant") becomes the status, so a
          // dead grant can be told apart from a bad request.
          const failure = yield* HttpClientResponse.schemaBodyJson(TokenFailure)(response).pipe(
            Effect.option,
          )
          return yield* Option.match(failure, {
            onNone: () =>
              new BungieError({ status: "Transport", message: `token: HTTP ${response.status}` }),
            onSome: (body) =>
              new BungieError({
                status: body.error,
                message: body.error_description ?? body.error,
              }),
          })
        }
        const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response).pipe(
          Effect.mapError(toBungieError),
        )
        const now = yield* DateTime.now
        const after = (seconds: number) =>
          DateTime.formatIso(DateTime.addDuration(now, `${seconds} seconds`))
        const tokens: BungieTokens = {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: after(body.expires_in),
          refreshExpiresAt:
            body.refresh_expires_in === undefined ? undefined : after(body.refresh_expires_in),
          membershipId: body.membership_id,
        }
        yield* saveTokens(tokens)
        return tokens
      }).pipe(timeoutAfter(PLATFORM_TIMEOUT))

    const usable = (tokens: BungieTokens, now: number) => millisOf(tokens.expiresAt) - now > 60_000

    // Tokens are refreshed lazily: right before a request, if the stored
    // access token is within a minute of expiring, swap it using the refresh
    // token. Bungie access tokens last an hour, refresh tokens 90 days.
    //
    // One refresh runs at a time, and it re-reads the tokens once it holds the
    // lock: the profile loop, loadouts and the artifact can all notice expiry
    // together, and only the first should spend the refresh token. `rejected`
    // is an access token Bungie just refused, refreshed even if it looks current.
    const refresh = (rejected: string | null) =>
      Effect.gen(function* () {
        const tokens = yield* storedTokens
        const now = yield* Clock.currentTimeMillis
        if (tokens.accessToken !== rejected && usable(tokens, now)) return tokens
        if (tokens.refreshExpiresAt !== undefined && millisOf(tokens.refreshExpiresAt) <= now) {
          return yield* signOut("refresh token expired")
        }
        return yield* tokenRequest({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }).pipe(
          Effect.catchIf(
            (error) => error.status === "invalid_grant" || hasCode(SIGNED_OUT, error),
            (error) => signOut(`refresh refused: ${error.message}`),
          ),
        )
      }).pipe(refreshLock.withPermits(1))

    const freshTokens = Effect.gen(function* () {
      const tokens = yield* storedTokens
      if (usable(tokens, yield* Clock.currentTimeMillis)) return tokens
      return yield* refresh(null)
    })

    const send = (request: HttpClientRequest.HttpClientRequest, accessToken: string) =>
      Effect.gen(function* () {
        const response = yield* http
          .execute(HttpClientRequest.bearerToken(request, accessToken))
          .pipe(Effect.mapError(toBungieError))
        return yield* readEnvelope(response).pipe(
          Effect.catchIf(
            (error) =>
              hasCode(SIGNED_OUT, error) ||
              (response.status === 401 &&
                !hasCode(EXPIRED_ACCESS, error) &&
                !hasCode(API_KEY_CODES, error)),
            (error) => signOut(`${error.status}: ${error.message}`),
          ),
        )
      }).pipe(timeoutAfter(PLATFORM_TIMEOUT))

    const authed = (request: HttpClientRequest.HttpClientRequest, idempotent: boolean) =>
      Effect.gen(function* () {
        const tokens = yield* freshTokens
        return yield* send(request, tokens.accessToken).pipe(
          Effect.catchIf(
            (error) => error._tag === "BungieError" && hasCode(EXPIRED_ACCESS, error),
            () =>
              Effect.flatMap(refresh(tokens.accessToken), (next) =>
                send(request, next.accessToken),
              ),
          ),
        )
      }).pipe(Effect.retry(retryPolicy(idempotent)))

    const get = (path: string) => authed(HttpClientRequest.get(`${PLATFORM}${path}`), true)

    const post = <Body extends CharacterAction>(path: string, body: Body) =>
      HttpClientRequest.bodyJson(HttpClientRequest.post(`${PLATFORM}${path}`), body).pipe(
        Effect.mapError(toBungieError),
        Effect.flatMap((request) => authed(request, false)),
      )

    const authorizeUrl = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      for (const [state, lapses] of pendingStates) if (lapses <= now) pendingStates.delete(state)
      const state = randomBytes(16).toString("hex")
      pendingStates.set(state, now + STATE_TTL_MS)
      const query = new URLSearchParams({
        client_id: config.bungie.clientId,
        response_type: "code",
        state,
      })
      return `https://www.bungie.net/en/OAuth/Authorize?${query}`
    })

    const exchangeCode = (code: string, state: string) =>
      Effect.gen(function* () {
        const lapses = pendingStates.get(state)
        pendingStates.delete(state)
        if (lapses === undefined || lapses <= (yield* Clock.currentTimeMillis)) {
          return yield* new BungieError({
            status: "State",
            message: "this sign-in was not started by Ghost, or took too long; start it again",
          })
        }
        const tokens = yield* tokenRequest({ grant_type: "authorization_code", code })
        // The new tokens may belong to another account.
        yield* settings.remove(MEMBERSHIP_KEY).pipe(Effect.orDie)
        return tokens
      })

    return {
      isLinked: Effect.map(loadTokens, Option.isSome),
      authorizeUrl,
      exchangeCode,
      get,
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
      snapshotLoadout: (input) => post("/Destiny2/Actions/Loadouts/SnapshotLoadout/", input),
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
