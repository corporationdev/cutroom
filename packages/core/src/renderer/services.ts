import { Context, Effect, Layer } from "effect";

import type { Asset } from "../schema";
import type {
  AssetResolveFailed,
  CommandExecutionFailed,
  FfmpegFailed,
  HyperframesFailed,
  TempDirectoryFailed,
} from "./errors";
import type {
  BuildRenderPlanInput,
  CommandInput,
  CommandResult,
  FfmpegRenderInput,
  RenderCompositionInput,
  RenderOverlayInput,
  RenderPlan,
  ResolvedAsset,
} from "./types";

export interface AssetResolverShape {
  readonly resolveAsset: (input: {
    readonly asset: Asset;
    readonly projectRoot: string;
  }) => Effect.Effect<ResolvedAsset, AssetResolveFailed>;
}

export class AssetResolver extends Context.Service<
  AssetResolver,
  AssetResolverShape
>()("@vbaas/core/renderer/AssetResolver") {
  static Passthrough = Layer.succeed(this, {
    resolveAsset: ({ asset, projectRoot }) =>
      Effect.succeed({
        ...asset,
        resolvedSource:
          asset.source.kind === "url"
            ? asset.source.path
            : new URL(asset.source.path, `file://${projectRoot}/`).pathname,
      }),
  });
}

export interface RenderPlannerShape {
  readonly buildPlan: (
    input: BuildRenderPlanInput
  ) => Effect.Effect<RenderPlan, never>;
}

export class RenderPlanner extends Context.Service<
  RenderPlanner,
  RenderPlannerShape
>()("@vbaas/core/renderer/RenderPlanner") {}

export interface HyperframesShape {
  readonly renderOverlay: (
    input: RenderOverlayInput
  ) => Effect.Effect<string, HyperframesFailed>;
}

export class Hyperframes extends Context.Service<
  Hyperframes,
  HyperframesShape
>()("@vbaas/core/renderer/Hyperframes") {
  static Noop = Layer.succeed(this, {
    renderOverlay: ({ outputPath }) => Effect.succeed(outputPath),
  });
}

export interface FfmpegShape {
  readonly render: (
    input: FfmpegRenderInput
  ) => Effect.Effect<void, FfmpegFailed>;
}

export class Ffmpeg extends Context.Service<Ffmpeg, FfmpegShape>()(
  "@vbaas/core/renderer/Ffmpeg"
) {
  static Noop = Layer.succeed(this, {
    render: () => Effect.void,
  });
}

export interface CommandExecutorShape {
  readonly run: (
    input: CommandInput
  ) => Effect.Effect<CommandResult, CommandExecutionFailed>;
}

export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorShape
>()("@vbaas/core/renderer/CommandExecutor") {}

export interface TempDirectoryShape {
  readonly withTempDirectory: <A, E, R>(
    use: (path: string) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | TempDirectoryFailed, R>;
}

export class TempDirectory extends Context.Service<
  TempDirectory,
  TempDirectoryShape
>()("@vbaas/core/renderer/TempDirectory") {
  static Test = Layer.succeed(this, {
    withTempDirectory: (use) => use("/tmp/vbaas-render-test"),
  });
}

export type RendererServices =
  | AssetResolver
  | Ffmpeg
  | Hyperframes
  | RenderPlanner
  | TempDirectory;

export interface RenderCompositionServiceShape {
  readonly renderComposition: (
    input: RenderCompositionInput
  ) => Effect.Effect<unknown, unknown, RendererServices>;
}
