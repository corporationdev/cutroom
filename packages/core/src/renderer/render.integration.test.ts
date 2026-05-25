import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "bun";

import { Effect } from "effect";
import { decodeUnknownSync } from "effect/Schema";

import { type VbaasComposition, vbaasCompositionSchema } from "../schema";
import { RendererLive, renderComposition } from "./index";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const renderTestDir = join(packageRoot, "tmp", "render-tests");
const sourcePath = join(renderTestDir, "source.mp4");
const outputPath = join(renderTestDir, "media-only-output.mp4");

describe("RendererLive integration", () => {
  beforeAll(async () => {
    await rm(renderTestDir, {
      force: true,
      recursive: true,
    });
    await mkdir(renderTestDir, {
      recursive: true,
    });
    await runProcess("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      sourcePath,
    ]);
  });

  test("renders a real media-only mp4 with ffmpeg", async () => {
    const composition = decodeComposition({
      assets: [
        {
          durationFrames: 30,
          fps: 30,
          height: 180,
          id: "source-video",
          source: {
            kind: "file",
            path: "tmp/render-tests/source.mp4",
          },
          type: "video",
          width: 320,
        },
      ],
      id: "real-media-render",
      schemaVersion: "0.1",
      settings: {
        canvas: {
          height: 180,
          width: 320,
        },
        fps: 30,
      },
      tracks: [
        {
          clips: [
            {
              durationFrames: 30,
              id: "source-video-clip",
              media: {
                assetId: "source-video",
              },
              startFrame: 0,
              type: "video",
            },
          ],
          id: "visual-track",
          kind: "visual",
        },
      ],
    });

    const result = await Effect.runPromise(
      renderComposition({
        composition,
        outputPath,
        projectRoot: packageRoot,
        quality: "draft",
      }).pipe(Effect.provide(RendererLive))
    );
    const outputStats = await stat(outputPath);
    const probe = await probeVideo(outputPath);

    expect(result.outputPath).toBe(outputPath);
    expect(outputStats.size).toBeGreaterThan(0);
    expect(probe.streams[0]?.width).toBe(320);
    expect(probe.streams[0]?.height).toBe(180);
    expect(Number(probe.format.duration)).toBeCloseTo(1, 1);
  });
});

const decodeComposition = (input: unknown): VbaasComposition =>
  decodeUnknownSync(vbaasCompositionSchema)(input);

interface ProbeResult {
  readonly format: {
    readonly duration: string;
  };
  readonly streams: ReadonlyArray<{
    readonly height: number;
    readonly width: number;
  }>;
}

const probeVideo = async (path: string): Promise<ProbeResult> => {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    path,
  ]);

  return JSON.parse(result.stdout) as ProbeResult;
};

const runProcess = async (
  binary: string,
  args: readonly string[]
): Promise<{ readonly stderr: string; readonly stdout: string }> => {
  const process = spawn([binary, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`${binary} failed with ${exitCode}: ${stderr}`);
  }

  return {
    stderr,
    stdout,
  };
};
