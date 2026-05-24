import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const runtimeEnv = import.meta.env as unknown as Record<
  string,
  string | undefined
>;

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
  },
  runtimeEnv,
  emptyStringAsUndefined: true,
});
