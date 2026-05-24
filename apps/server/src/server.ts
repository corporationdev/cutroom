import type { WorkerEnvironment } from "alchemy/Cloudflare";
import { pretty as prettyCause } from "effect/Cause";
import {
  catchCause,
  type Effect,
  flatMap,
  logError,
  map,
  orDie,
  provide as provideEffect,
} from "effect/Effect";
import { mergeAll as mergeLayers, provide as provideLayer } from "effect/Layer";
import { layer as etagLayer } from "effect/unstable/http/Etag";
import { layer as httpPlatformLayer } from "effect/unstable/http/HttpPlatform";
import { cors, toHttpEffect } from "effect/unstable/http/HttpRouter";
import {
  type HttpServerResponse,
  setHeaders,
  text,
} from "effect/unstable/http/HttpServerResponse";
import { layer as makeApiLayer } from "effect/unstable/httpapi/HttpApiBuilder";

import {
  ProtectedAppApiLayer,
  ProtectedVbaasApi,
  PublicAppApiLayer,
  PublicVbaasApi,
} from "./api";
import { AuthLayer } from "./auth";
import { SessionAuthMiddleware } from "./auth-context";
import { AuthService } from "./auth-service";
import {
  allowedCorsHeaders,
  allowedOrigins,
  getCorsResponseHeaders,
} from "./cors";

interface MakeServerFetchOptions {
  readonly getCorsOrigin: Effect<string, Error, WorkerEnvironment>;
}

export const makeServerFetch = ({ getCorsOrigin }: MakeServerFetchOptions) =>
  mergeLayers(
    AuthLayer,
    makeApiLayer(PublicVbaasApi).pipe(provideLayer(PublicAppApiLayer)),
    makeApiLayer(ProtectedVbaasApi).pipe(
      provideLayer(ProtectedAppApiLayer),
      provideLayer(SessionAuthMiddleware.layer)
    )
  ).pipe(
    provideLayer(AuthService.Live),
    provideLayer([httpPlatformLayer, etagLayer]),
    provideLayer(
      cors({
        allowedHeaders: [...allowedCorsHeaders],
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedOrigins,
        credentials: true,
      })
    ),
    toHttpEffect,
    map((fetch) =>
      fetch.pipe(
        provideEffect(AuthService.Live),
        flatMap((response) => addCorsHeaders(response, getCorsOrigin)),
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
      )
    )
  );

const addCorsHeaders = (
  response: HttpServerResponse,
  getCorsOrigin: Effect<string, Error, WorkerEnvironment>
) =>
  getCorsOrigin.pipe(
    map((origin) => setHeaders(getCorsResponseHeaders(origin))(response))
  );
