import { VbaasApi } from "@vbaas/api";
import { env } from "@vbaas/env/web";
import { provideService } from "effect/Effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { Service as makeAtomHttpApiService } from "effect/unstable/reactivity/AtomHttpApi";

export const VbaasApiClient = makeAtomHttpApiService<"VbaasApiClient">()(
  "VbaasApiClient",
  {
    api: VbaasApi,
    baseUrl: env.VITE_SERVER_URL,
    httpClient: FetchHttpClient.layer,
    transformClient: HttpClient.transformResponse((effect) =>
      effect.pipe(
        provideService(FetchHttpClient.RequestInit, {
          credentials: "include",
        }),
        provideService(HttpClient.TracerPropagationEnabled, false)
      )
    ),
  }
);

export const healthCheckAtom = VbaasApiClient.query("app", "healthCheck", {
  timeToLive: "30 seconds",
});

export const privateDataAtom = VbaasApiClient.query("app", "privateData", {
  timeToLive: "30 seconds",
});
