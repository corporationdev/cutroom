import { type UnauthorizedError, VbaasApi } from "@vbaas/api";
import type { AuthConfig } from "@vbaas/auth";
import { Worker, WorkerEnvironment } from "alchemy/Cloudflare";
import { pretty as prettyCause } from "effect/Cause";
import {
  redacted as redactedConfig,
  string as stringConfig,
} from "effect/Config";
import {
  catchCause,
  type Effect,
  fail,
  flatMap,
  gen,
  logError,
  map,
  orDie,
  promise,
  succeed,
  tryPromise,
} from "effect/Effect";
import { mergeAll as mergeLayers, provide as provideLayer } from "effect/Layer";
import { isRedacted, value as redactedValue } from "effect/Redacted";
import { layer as etagLayer } from "effect/unstable/http/Etag";
import { layer as httpPlatformLayer } from "effect/unstable/http/HttpPlatform";
import {
  add as addRoute,
  cors,
  toHttpEffect,
} from "effect/unstable/http/HttpRouter";
import {
  type HttpServerRequest,
  toWeb,
} from "effect/unstable/http/HttpServerRequest";
import {
  fromWeb,
  setHeaders,
  text,
} from "effect/unstable/http/HttpServerResponse";
import {
  group as makeApiGroup,
  layer as makeApiLayer,
} from "effect/unstable/httpapi/HttpApiBuilder";

type GetAuthConfig = Effect<AuthConfig>;

const getSession = (request: HttpServerRequest, getAuthConfig: GetAuthConfig) =>
  gen(function* () {
    const authConfig = yield* getAuthConfig;
    const webRequest = yield* toWeb(request);

    return yield* tryPromise({
      try: async () => {
        const { createAuth } = await import("@vbaas/auth");
        return createAuth(authConfig).api.getSession({
          headers: webRequest.headers,
        });
      },
      catch: (error) => error,
    });
  }).pipe(orDie);

const makeAppApiLayer = (getAuthConfig: GetAuthConfig) =>
  makeApiGroup(VbaasApi, "app", (handlers) =>
    handlers
      .handle("healthCheck", () =>
        succeed({
          status: "OK" as const,
        })
      )
      .handle("privateData", ({ request }) =>
        gen(function* () {
          const session = yield* getSession(request, getAuthConfig);

          if (!session?.user) {
            return yield* fail({
              _tag: "UnauthorizedError" as const,
              message: "Authentication required",
            } satisfies UnauthorizedError);
          }

          return {
            message: "This is private",
            user: {
              email: session.user.email ?? null,
              id: session.user.id,
              name: session.user.name ?? null,
            },
          };
        })
      )
  );

const makeAuthLayer = (getAuthConfig: GetAuthConfig) =>
  addRoute("*", "/api/auth/*", (request) =>
    toWeb(request).pipe(
      flatMap((webRequest) =>
        getAuthConfig.pipe(map((authConfig) => ({ authConfig, webRequest })))
      ),
      flatMap(({ authConfig, webRequest }) =>
        promise(async () => {
          const { createAuth } = await import("@vbaas/auth");
          return await createAuth(authConfig).handler(webRequest);
        })
      ),
      map(fromWeb)
    )
  );

const allowedOrigins = process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : [];
const allowedCorsHeaders = ["Content-Type", "Authorization"] as const;

const getCorsResponseHeaders = (origin: string) =>
  ({
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": allowedCorsHeaders.join(","),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": origin,
    vary: "Origin",
  }) as const;

const Server: ReturnType<typeof Worker> = Worker(
  "server",
  gen(function* () {
    const betterAuthSecret = yield* redactedConfig("BETTER_AUTH_SECRET");
    const betterAuthUrl = yield* stringConfig("BETTER_AUTH_URL");
    const corsOrigin = yield* stringConfig("CORS_ORIGIN");
    const databaseUrl = yield* redactedConfig("DATABASE_URL");

    return {
      compatibility: {
        flags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
      },
      env: {
        BETTER_AUTH_SECRET: betterAuthSecret,
        BETTER_AUTH_URL: betterAuthUrl,
        CORS_ORIGIN: corsOrigin,
        DATABASE_URL: databaseUrl,
      },
      main: import.meta.filename,
    };
  }),
  gen(function* () {
    const getRequiredRuntimeEnv = (name: keyof Env) =>
      gen(function* () {
        const env = yield* WorkerEnvironment;
        const value = env[name] as unknown;

        if (!value) {
          return yield* fail(
            new Error(`Missing required runtime environment variable: ${name}`)
          );
        }

        if (typeof value === "string") {
          if (value === "<redacted>") {
            return yield* fail(
              new Error(
                `Runtime environment variable ${name} resolved to Alchemy's redacted display placeholder.`
              )
            );
          }

          return value;
        }

        if (isRedacted(value)) {
          return redactedValue(value);
        }

        return yield* fail(
          new Error(`Runtime environment variable ${name} is not a string.`)
        );
      });

    const getCorsOrigin = getRequiredRuntimeEnv("CORS_ORIGIN");

    const getAuthConfig = gen(function* () {
      const betterAuthSecret =
        yield* getRequiredRuntimeEnv("BETTER_AUTH_SECRET");
      const betterAuthUrl = yield* getRequiredRuntimeEnv("BETTER_AUTH_URL");
      const corsOrigin = yield* getRequiredRuntimeEnv("CORS_ORIGIN");
      const databaseUrl = yield* getRequiredRuntimeEnv("DATABASE_URL");

      return {
        betterAuthSecret,
        betterAuthUrl,
        corsOrigin,
        databaseUrl,
      } satisfies AuthConfig;
    });

    const fetch = yield* mergeLayers(
      makeAuthLayer(getAuthConfig),
      makeApiLayer(VbaasApi).pipe(provideLayer(makeAppApiLayer(getAuthConfig)))
    ).pipe(
      provideLayer([httpPlatformLayer, etagLayer]),
      provideLayer(
        cors({
          allowedHeaders: [...allowedCorsHeaders],
          allowedMethods: ["GET", "POST", "OPTIONS"],
          allowedOrigins,
          credentials: true,
        })
      ),
      toHttpEffect
    );

    return {
      fetch: fetch.pipe(
        flatMap((response) =>
          getCorsOrigin.pipe(
            map((origin) =>
              setHeaders(getCorsResponseHeaders(origin))(response)
            )
          )
        ),
        catchCause((cause) =>
          getCorsOrigin.pipe(
            flatMap((origin) =>
              logError(prettyCause(cause)).pipe(
                map(() =>
                  setHeaders(getCorsResponseHeaders(origin))(
                    text("Internal Server Error", { status: 500 })
                  )
                )
              )
            )
          )
        ),
        orDie
      ),
    };
  })
);

export default Server;
