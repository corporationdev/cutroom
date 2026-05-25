import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { Effect, Layer } from "effect";

import { AssetResolveFailed, TempDirectoryFailed } from "./errors";
import { AssetResolver, TempDirectory } from "./services";

export const AssetResolverLive = Layer.succeed(AssetResolver, {
  resolveAsset: ({ asset, projectRoot }) => {
    if (asset.source.kind === "url") {
      return Effect.succeed({
        ...asset,
        resolvedSource: asset.source.path,
      });
    }

    const resolvedSource = isAbsolute(asset.source.path)
      ? asset.source.path
      : resolve(projectRoot, asset.source.path);

    return Effect.tryPromise({
      catch: (error) =>
        new AssetResolveFailed({
          assetId: asset.id,
          message:
            error instanceof Error
              ? error.message
              : `Unable to resolve asset "${asset.id}".`,
        }),
      try: async () => {
        await access(resolvedSource);

        return {
          ...asset,
          resolvedSource,
        };
      },
    });
  },
});

export const TempDirectoryLive = Layer.succeed(TempDirectory, {
  withTempDirectory: (use) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        catch: (error) =>
          new TempDirectoryFailed({
            message:
              error instanceof Error
                ? error.message
                : "Unable to create temp directory.",
          }),
        try: () => mkdtemp(join(tmpdir(), "vbaas-render-")),
      }),
      use,
      (path) =>
        Effect.promise(() =>
          rm(path, {
            force: true,
            recursive: true,
          })
        ).pipe(Effect.ignore)
    ),
});
