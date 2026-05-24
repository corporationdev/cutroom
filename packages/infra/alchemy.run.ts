import { Stack, type StackServices, Variable } from "alchemy";
import {
  type AssetsProps,
  type ProviderRequirements,
  providers,
  state,
  Vite,
} from "alchemy/Cloudflare";
import { config } from "dotenv";
import { gen } from "effect/Effect";
import type { Layer } from "effect/Layer";

import Server from "../../apps/server/src/index";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

const webAssets = {
  config: {
    notFoundHandling: "single-page-application",
  },
  directory: "../../apps/web/dist",
} satisfies AssetsProps;

export const Web = Vite("web", {
  assets: webAssets,
  env: {
    VITE_SERVER_URL: Variable("VITE_SERVER_URL"),
  },
  rootDir: "../../apps/web",
});

const cloudflareProviders = providers() as Layer<
  ProviderRequirements,
  never,
  StackServices
>;

export default Stack(
  "vbaas",
  {
    providers: cloudflareProviders,
    state: state(),
  },
  gen(function* () {
    const web = yield* Web;
    const server = yield* Server;

    return {
      serverUrl: server.url,
      webUrl: web.url,
    };
  })
);
