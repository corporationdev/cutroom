import { createAuth } from "@vbaas/auth";
import { WorkerEnvironment } from "alchemy/Cloudflare";
import { Context, Effect, Layer } from "effect";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import { toWeb } from "effect/unstable/http/HttpServerRequest";

import { getAuthConfig } from "./runtime-env";

type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>;

interface AuthServiceShape {
  readonly getSession: (
    request: HttpServerRequest
  ) => Effect.Effect<Awaited<ReturnType<Auth["api"]["getSession"]>>, unknown>;
  readonly handler: (request: Request) => Effect.Effect<Response, unknown>;
}

const getProcessAuthConfig = getAuthConfig.pipe(
  Effect.provideService(WorkerEnvironment, process.env)
);

export class AuthService extends Context.Service<
  AuthService,
  AuthServiceShape
>()("@vbaas/server/AuthService") {
  static Live = Layer.succeed(this, {
    getSession: (request) =>
      Effect.gen(function* () {
        const authConfig = yield* getProcessAuthConfig;
        const auth = createAuth(authConfig);
        const webRequest = yield* toWeb(request);

        return yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({
              headers: webRequest.headers,
            }),
          catch: (error) => error,
        });
      }),
    handler: (request) =>
      Effect.gen(function* () {
        const authConfig = yield* getProcessAuthConfig;
        const auth = createAuth(authConfig);

        return yield* Effect.tryPromise({
          try: () => auth.handler(request),
          catch: (error) => error,
        });
      }),
  });
}
