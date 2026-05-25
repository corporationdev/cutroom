import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { decodeUnknownSync } from "effect/Schema";

import { type VbaasComposition, vbaasCompositionSchema } from "../schema";
import { RenderPlannerLive } from "./plan";
import { renderComposition } from "./render";
import { AssetResolver, Ffmpeg, Hyperframes, TempDirectory } from "./services";
import type { FfmpegRenderInput, RenderOverlayInput } from "./types";

describe("renderComposition shell", () => {
  test("fails invalid compositions before render services run", async () => {
    const calls = createRenderCalls();
    const result = await Effect.runPromiseExit(
      renderComposition({
        composition: decodeComposition({
          assets: [],
          id: "missing-asset",
          schemaVersion: "0.1",
          settings: defaultSettings,
          tracks: [
            {
              clips: [
                {
                  durationFrames: 30,
                  id: "video-clip",
                  media: {
                    assetId: "missing-video",
                  },
                  startFrame: 0,
                  type: "video",
                },
              ],
              id: "visual-track",
              kind: "visual",
            },
          ],
        }),
        outputPath: "renders/missing-asset.mp4",
        projectRoot: "/tmp/vbaas-test-project",
      }).pipe(Effect.provide(createTestRendererLayer(calls)))
    );

    expect(result._tag).toBe("Failure");
    expect(calls.overlays).toHaveLength(0);
    expect(calls.ffmpeg).toHaveLength(0);
  });

  test("renders Hyperframes overlays before ffmpeg for text layers", async () => {
    const calls = createRenderCalls();
    const result = await Effect.runPromise(
      renderComposition({
        composition: decodeComposition({
          id: "text-overlay",
          schemaVersion: "0.1",
          settings: defaultSettings,
          tracks: [
            {
              clips: [
                {
                  durationFrames: 60,
                  id: "hello-text",
                  startFrame: 0,
                  text: "Hello world",
                  type: "text",
                },
              ],
              id: "text-track",
              kind: "text",
            },
          ],
        }),
        outputPath: "renders/text-overlay.mp4",
        projectRoot: "/tmp/vbaas-test-project",
      }).pipe(Effect.provide(createTestRendererLayer(calls)))
    );

    expect(result.durationFrames).toBe(60);
    expect(calls.overlays).toHaveLength(1);
    expect(calls.overlays[0]?.plan.htmlLayers).toHaveLength(1);
    expect(calls.ffmpeg).toHaveLength(1);
    expect(calls.ffmpeg[0]?.overlayPath).toBe("/tmp/vbaas-test/overlay.webm");
  });

  test("renders Hyperframes overlays before ffmpeg for caption cues", async () => {
    const calls = createRenderCalls();
    const result = await Effect.runPromise(
      renderComposition({
        composition: decodeComposition({
          id: "caption-overlay",
          schemaVersion: "0.1",
          settings: defaultSettings,
          tracks: [
            {
              cues: [
                {
                  durationFrames: 45,
                  startFrame: 15,
                  text: "Caption cue",
                },
              ],
              id: "caption-track",
              kind: "caption",
            },
          ],
        }),
        outputPath: "renders/caption-overlay.mp4",
        projectRoot: "/tmp/vbaas-test-project",
      }).pipe(Effect.provide(createTestRendererLayer(calls)))
    );

    expect(result.durationFrames).toBe(60);
    expect(calls.overlays).toHaveLength(1);
    expect(calls.overlays[0]?.plan.htmlLayers[0]).toEqual(
      expect.objectContaining({
        id: "caption-track:cue:0",
        kind: "caption",
        text: "Caption cue",
      })
    );
    expect(calls.ffmpeg[0]?.overlayPath).toBe("/tmp/vbaas-test/overlay.webm");
  });

  test("skips Hyperframes overlays for media-only compositions", async () => {
    const calls = createRenderCalls();
    const result = await Effect.runPromise(
      renderComposition({
        composition: decodeComposition({
          assets: [
            {
              id: "intro-video",
              source: {
                kind: "file",
                path: "assets/intro.mp4",
              },
              type: "video",
            },
          ],
          id: "media-only",
          schemaVersion: "0.1",
          settings: defaultSettings,
          tracks: [
            {
              clips: [
                {
                  durationFrames: 90,
                  id: "intro-clip",
                  media: {
                    assetId: "intro-video",
                  },
                  startFrame: 0,
                  type: "video",
                },
              ],
              id: "visual-track",
              kind: "visual",
            },
          ],
        }),
        outputPath: "renders/media-only.mp4",
        projectRoot: "/tmp/vbaas-test-project",
      }).pipe(Effect.provide(createTestRendererLayer(calls)))
    );

    expect(result.durationFrames).toBe(90);
    expect(calls.overlays).toHaveLength(0);
    expect(calls.ffmpeg).toHaveLength(1);
    expect(calls.ffmpeg[0]?.overlayPath).toBeUndefined();
  });
});

const defaultSettings = {
  canvas: {
    height: 1920,
    width: 1080,
  },
  fps: 30,
} as const;

const decodeComposition = (input: unknown): VbaasComposition =>
  decodeUnknownSync(vbaasCompositionSchema)(input);

interface RenderCalls {
  readonly ffmpeg: FfmpegRenderInput[];
  readonly overlays: RenderOverlayInput[];
}

const createRenderCalls = (): RenderCalls => ({
  ffmpeg: [],
  overlays: [],
});

const createTestRendererLayer = (calls: RenderCalls) =>
  Layer.mergeAll(
    AssetResolver.Passthrough,
    Layer.succeed(Ffmpeg, {
      render: (input) =>
        Effect.sync(() => {
          calls.ffmpeg.push(input);
        }),
    }),
    Layer.succeed(Hyperframes, {
      renderOverlay: (input) =>
        Effect.sync(() => {
          calls.overlays.push(input);
          return input.outputPath;
        }),
    }),
    RenderPlannerLive,
    Layer.succeed(TempDirectory, {
      withTempDirectory: (use) => use("/tmp/vbaas-test"),
    })
  );
