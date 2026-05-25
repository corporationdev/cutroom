import { Effect, Layer } from "effect";

import { validateComposition } from "../schema";
import { CommandExecutorLive } from "./command";
import { CompositionInvalid, type RenderError } from "./errors";
import { FfmpegLive } from "./ffmpeg";
import { AssetResolverLive, TempDirectoryLive } from "./local";
import { RenderPlannerLive } from "./plan";
import {
  AssetResolver,
  Ffmpeg,
  Hyperframes,
  type RendererServices,
  RenderPlanner,
  TempDirectory,
} from "./services";
import type {
  RenderCompositionInput,
  RenderCompositionResult,
  ResolvedAsset,
} from "./types";

export const renderComposition = (
  input: RenderCompositionInput
): Effect.Effect<RenderCompositionResult, RenderError, RendererServices> =>
  Effect.gen(function* () {
    const validationIssues = validateComposition(input.composition);

    if (validationIssues.length > 0) {
      return yield* Effect.fail(
        new CompositionInvalid({
          issues: validationIssues,
        })
      );
    }

    const assetResolver = yield* AssetResolver;
    const ffmpeg = yield* Ffmpeg;
    const hyperframes = yield* Hyperframes;
    const renderPlanner = yield* RenderPlanner;
    const tempDirectory = yield* TempDirectory;
    const projectRoot = input.projectRoot ?? process.cwd();
    const resolvedAssets = yield* Effect.forEach(
      input.composition.assets,
      (asset) => assetResolver.resolveAsset({ asset, projectRoot }),
      { concurrency: "unbounded" }
    );
    const resolvedAssetsById = new Map(
      resolvedAssets.map((asset) => [asset.id, asset] as const)
    ) satisfies ReadonlyMap<string, ResolvedAsset>;
    const plan = yield* renderPlanner.buildPlan({
      ...input,
      projectRoot,
      resolvedAssets: resolvedAssetsById,
    });

    yield* tempDirectory.withTempDirectory((tempDir) =>
      Effect.gen(function* () {
        const overlayPath =
          plan.htmlLayers.length === 0
            ? undefined
            : yield* hyperframes.renderOverlay({
                outputPath: `${tempDir}/overlay.webm`,
                plan,
                tempDir,
              });

        yield* ffmpeg.render({
          overlayPath,
          plan,
          quality: input.quality,
        });
      })
    );

    return {
      durationFrames: plan.durationFrames,
      outputPath: plan.outputPath,
      plan,
    };
  });

export const RendererLive = Layer.mergeAll(
  AssetResolverLive,
  FfmpegLive.pipe(Layer.provide(CommandExecutorLive)),
  Hyperframes.Noop,
  RenderPlannerLive,
  TempDirectoryLive
);
