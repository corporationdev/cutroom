import { Literal, NullOr, String as StringSchema, Struct } from "effect/Schema";
import { make as makeHttpApi } from "effect/unstable/httpapi/HttpApi";
import { get as makeGetEndpoint } from "effect/unstable/httpapi/HttpApiEndpoint";
import { make as makeHttpApiGroup } from "effect/unstable/httpapi/HttpApiGroup";
import { status } from "effect/unstable/httpapi/HttpApiSchema";

export const HealthResponse = Struct({
  status: Literal("OK"),
});

export type HealthResponse = typeof HealthResponse.Type;

export const UserSummary = Struct({
  email: NullOr(StringSchema),
  id: StringSchema,
  name: NullOr(StringSchema),
});

export type UserSummary = typeof UserSummary.Type;

export const PrivateDataResponse = Struct({
  message: StringSchema,
  user: UserSummary,
});

export type PrivateDataResponse = typeof PrivateDataResponse.Type;

export const UnauthorizedError = Struct({
  _tag: Literal("UnauthorizedError"),
  message: StringSchema,
}).pipe(status(401));

export type UnauthorizedError = typeof UnauthorizedError.Type;

export const healthCheck = makeGetEndpoint("healthCheck", "/health", {
  success: HealthResponse,
});

export const privateData = makeGetEndpoint("privateData", "/private-data", {
  error: UnauthorizedError,
  success: PrivateDataResponse,
});

export class AppGroup extends makeHttpApiGroup("app")
  .add(healthCheck)
  .add(privateData) {}

export class VbaasApi extends makeHttpApi("VbaasApi").add(AppGroup) {}
