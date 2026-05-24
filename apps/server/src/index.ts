import { Worker } from "alchemy/Cloudflare";
import {
  redacted as redactedConfig,
  string as stringConfig,
} from "effect/Config";
import { gen, orDie } from "effect/Effect";

import { getRequiredRuntimeEnv } from "./runtime-env";
import { makeServerFetch } from "./server";

const Server: ReturnType<typeof Worker> = Worker(
  "server",
  gen(function* () {
    const betterAuthSecret =
      yield* redactedConfig("BETTER_AUTH_SECRET").pipe(orDie);
    const betterAuthUrl = yield* stringConfig("BETTER_AUTH_URL").pipe(orDie);
    const corsOrigin = yield* stringConfig("CORS_ORIGIN").pipe(orDie);
    const databaseUrl = yield* redactedConfig("DATABASE_URL").pipe(orDie);

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
    const fetch = yield* makeServerFetch({
      getCorsOrigin: getRequiredRuntimeEnv("CORS_ORIGIN"),
    });

    return { fetch };
  })
);

export default Server;
