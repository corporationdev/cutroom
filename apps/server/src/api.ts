import { healthCheck, privateData } from "@vbaas/api";
import { gen, succeed } from "effect/Effect";
import { make as makeHttpApi } from "effect/unstable/httpapi/HttpApi";
import { group as makeApiGroup } from "effect/unstable/httpapi/HttpApiBuilder";
import { make as makeHttpApiGroup } from "effect/unstable/httpapi/HttpApiGroup";

import { SessionContext } from "./auth-context";

class PublicAppGroup extends makeHttpApiGroup("app").add(healthCheck) {}

class ProtectedAppGroup extends makeHttpApiGroup("app").add(privateData) {}

export class PublicVbaasApi extends makeHttpApi("VbaasApi").add(
  PublicAppGroup
) {}

export class ProtectedVbaasApi extends makeHttpApi("VbaasApi").add(
  ProtectedAppGroup
) {}

export const PublicAppApiLayer = makeApiGroup(
  PublicVbaasApi,
  "app",
  (handlers) =>
    handlers.handle("healthCheck", () =>
      succeed({
        status: "OK" as const,
      })
    )
);

export const ProtectedAppApiLayer = makeApiGroup(
  ProtectedVbaasApi,
  "app",
  (handlers) =>
    handlers.handle("privateData", () =>
      gen(function* () {
        const session = yield* SessionContext;

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
