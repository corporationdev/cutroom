import { flatMap, map } from "effect/Effect";
import { add as addRoute } from "effect/unstable/http/HttpRouter";
import { toWeb } from "effect/unstable/http/HttpServerRequest";
import { fromWeb } from "effect/unstable/http/HttpServerResponse";

import { AuthService } from "./auth-service";

export const AuthLayer = addRoute("*", "/api/auth/*", (request) =>
  toWeb(request).pipe(
    flatMap((webRequest) =>
      AuthService.pipe(map((auth) => ({ auth, webRequest })))
    ),
    flatMap(({ auth, webRequest }) => auth.handler(webRequest)),
    map(fromWeb)
  )
);
