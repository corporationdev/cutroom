export const allowedOrigins = process.env.CORS_ORIGIN
  ? [process.env.CORS_ORIGIN]
  : [];

export const allowedCorsHeaders = ["Content-Type", "Authorization"] as const;

export const getCorsResponseHeaders = (origin: string) =>
  ({
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": allowedCorsHeaders.join(","),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": origin,
    vary: "Origin",
  }) as const;
