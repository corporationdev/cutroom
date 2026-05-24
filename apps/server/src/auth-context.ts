import type { UnauthorizedError as UnauthorizedErrorType } from "@vbaas/api";
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";

import { AuthService, type AuthSession } from "./auth-service";

export type Session = AuthSession;

export class SessionContext extends Context.Service<SessionContext, Session>()(
  "@vbaas/server/SessionContext"
) {}

const unauthorized = {
  _tag: "UnauthorizedError" as const,
  message: "Authentication required",
} satisfies UnauthorizedErrorType;

export const SessionAuthMiddleware = HttpRouter.middleware<{
  provides: SessionContext;
}>()(
  Effect.gen(function* () {
    const auth = yield* AuthService;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* auth
          .getSession(request)
          .pipe(Effect.orElseSucceed(() => null));

        if (!session?.user) {
          return yield* Effect.fail(unauthorized);
        }

        return yield* Effect.provideService(
          httpEffect,
          SessionContext,
          session
        );
      });
  })
);
