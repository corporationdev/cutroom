export interface CloudflareEnv {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
}

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  // biome-ignore lint/style/noNamespace: Cloudflare exposes Env through namespace augmentation.
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {}
  }
}
