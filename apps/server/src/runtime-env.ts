import type { AuthConfig } from "@vbaas/auth";
import { WorkerEnvironment } from "alchemy/Cloudflare";
import { type Effect, fail, gen } from "effect/Effect";

type RuntimeEnvName =
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "CORS_ORIGIN"
  | "DATABASE_URL";

export type GetAuthConfig = Effect<AuthConfig, Error, WorkerEnvironment>;

export const getRequiredRuntimeEnv = (
  name: RuntimeEnvName
): Effect<string, Error, WorkerEnvironment> =>
  gen(function* () {
    const env = yield* WorkerEnvironment;
    const value = env[name] as unknown;

    if (typeof value !== "string" || value.length === 0) {
      return yield* fail(
        new Error(`Missing required runtime environment variable: ${name}`)
      );
    }

    if (value === "<redacted>") {
      return yield* fail(
        new Error(
          `Runtime environment variable ${name} resolved to Alchemy's redacted display placeholder.`
        )
      );
    }

    return value;
  });

export const getAuthConfig: GetAuthConfig = gen(function* () {
  const betterAuthSecret = yield* getRequiredRuntimeEnv("BETTER_AUTH_SECRET");
  const betterAuthUrl = yield* getRequiredRuntimeEnv("BETTER_AUTH_URL");
  const corsOrigin = yield* getRequiredRuntimeEnv("CORS_ORIGIN");
  const databaseUrl = yield* getRequiredRuntimeEnv("DATABASE_URL");

  return {
    betterAuthSecret,
    betterAuthUrl,
    corsOrigin,
    databaseUrl,
  };
});
