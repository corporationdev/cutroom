import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Effect, Layer } from "effect";
import puppeteer, { type Browser } from "puppeteer-core";

import { FrameSequenceFailed } from "./errors";
import { FrameSequenceRenderer } from "./services";
import type {
  HtmlLayer,
  RenderEncodedVideoResult,
  RenderFrameSequenceInput,
  RenderFrameSequenceResult,
  RenderFrameStreamResult,
  RenderPlan,
  VisualLayer,
} from "./types";

const defaultTextColor = "#ffffff";
const rendererHtml =
  '<!doctype html><html><body style="margin:0;background:transparent"><canvas id="frame"></canvas></body></html>';
const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
] as const;

interface BrowserRenderScene {
  readonly canvas: {
    readonly fps: number;
    readonly height: number;
    readonly width: number;
  };
  readonly durationFrames: number;
  readonly layers: BrowserRenderLayer[];
}

type BrowserRenderLayer =
  | BrowserCaptionLayer
  | BrowserMediaLayer
  | BrowserTextLayer;

interface BrowserMediaLayer {
  readonly assetUrl: string;
  readonly durationFrames: number;
  readonly fit: "contain" | "cover" | "fill" | "none";
  readonly height: number;
  readonly id: string;
  readonly opacity: number;
  readonly playbackRate: number;
  readonly rotation: number;
  readonly sourceStartFrame: number;
  readonly startFrame: number;
  readonly type: "image" | "video";
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

interface BrowserTextLayer {
  readonly align: "center" | "left" | "right";
  readonly color: string;
  readonly durationFrames: number;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: string;
  readonly height: number;
  readonly id: string;
  readonly lineHeight: number;
  readonly opacity: number;
  readonly rotation: number;
  readonly startFrame: number;
  readonly text: string;
  readonly type: "text";
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

interface BrowserCaptionLayer {
  readonly align: "center" | "left" | "right";
  readonly backgroundColor: string;
  readonly color: string;
  readonly durationFrames: number;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: string;
  readonly id: string;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly position: "bottom" | "center" | "top";
  readonly startFrame: number;
  readonly text: string;
  readonly type: "caption";
}

export const FrameSequenceRendererLive = Layer.succeed(FrameSequenceRenderer, {
  renderEncodedVideo: (input) =>
    Effect.tryPromise({
      catch: (error) =>
        new FrameSequenceFailed({
          message:
            error instanceof Error
              ? error.message
              : "Unable to encode video in browser.",
        }),
      try: () => renderEncodedVideo(input),
    }),
  renderFrameSequence: (input) =>
    Effect.tryPromise({
      catch: (error) =>
        new FrameSequenceFailed({
          message:
            error instanceof Error
              ? error.message
              : "Unable to render frame sequence.",
        }),
      try: () => renderFrameSequence(input),
    }),
  renderFrameStream: (input) => Effect.succeed(renderFrameStream(input)),
});

export const renderEncodedVideo = async ({
  outputDirectory,
  plan,
}: RenderFrameSequenceInput): Promise<RenderEncodedVideoResult> => {
  await mkdir(outputDirectory, { recursive: true });

  const browser = await launchBrowser();
  const moduleServer = await createStaticFileServer(getMediabunnyModuleRoot());

  try {
    const page = await browser.newPage();
    await page.setViewport({
      height: plan.canvas.height,
      width: plan.canvas.width,
      deviceScaleFactor: 1,
    });
    await page.goto(`${moduleServer.origin}/renderer.html`);

    const scene = withBrowserServedAssets(
      buildBrowserRenderScene(plan),
      moduleServer.origin
    );
    await page.evaluate(initializeBrowserRenderer, scene);

    const encodedVideoBytes = await page.evaluate(encodeBrowserVideo, {
      durationFrames: plan.durationFrames,
      fps: plan.canvas.fps,
      mediabunnyUrl: `${moduleServer.origin}/mediabunny.mjs`,
    });
    const outputPath = join(outputDirectory, "webcodecs-video.mp4");
    await writeFile(outputPath, Buffer.from(encodedVideoBytes));

    return {
      path: outputPath,
    };
  } finally {
    await moduleServer.close();
    await browser.close();
  }
};

export const renderFrameStream = ({
  outputDirectory,
  plan,
}: RenderFrameSequenceInput): RenderFrameStreamResult => ({
  frameRate: plan.canvas.fps,
  frames: createPngFrameStream({ outputDirectory, plan }),
});

export const renderFrameSequence = async ({
  outputDirectory,
  plan,
}: RenderFrameSequenceInput): Promise<RenderFrameSequenceResult> => {
  await mkdir(outputDirectory, { recursive: true });

  const rendererHtmlPath = join(outputDirectory, "renderer.html");
  await writeFile(rendererHtmlPath, rendererHtml);

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({
      height: plan.canvas.height,
      width: plan.canvas.width,
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(rendererHtmlPath).href);

    const scene = buildBrowserRenderScene(plan);
    await page.evaluate(initializeBrowserRenderer, scene);

    for (let frame = 0; frame < plan.durationFrames; frame++) {
      const dataUrl = await page.evaluate(renderBrowserFrame, frame);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const frameName = `frame-${frame.toString().padStart(6, "0")}.png`;
      await writeFile(join(outputDirectory, frameName), base64, "base64");
    }
  } finally {
    await browser.close();
  }

  return {
    framePattern: join(outputDirectory, "frame-%06d.png"),
    frameRate: plan.canvas.fps,
  };
};

async function* createPngFrameStream({
  outputDirectory,
  plan,
}: RenderFrameSequenceInput): AsyncIterable<Uint8Array> {
  await mkdir(outputDirectory, { recursive: true });

  const rendererHtmlPath = join(outputDirectory, "renderer.html");
  await writeFile(rendererHtmlPath, rendererHtml);

  const browser = await launchBrowser();
  const frameReceiver = await createFrameReceiver();

  try {
    const page = await browser.newPage();
    await page.setViewport({
      height: plan.canvas.height,
      width: plan.canvas.width,
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(rendererHtmlPath).href);

    const scene = buildBrowserRenderScene(plan);
    await page.evaluate(initializeBrowserRenderer, scene);

    for (let frame = 0; frame < plan.durationFrames; frame++) {
      const nextFrame = frameReceiver.nextFrame();
      await page.evaluate(renderBrowserFrameToEndpoint, {
        endpoint: frameReceiver.endpoint,
        frame,
      });
      yield await nextFrame;
    }
  } finally {
    await frameReceiver.close();
    await browser.close();
  }
}

interface FrameReceiver {
  readonly close: () => Promise<void>;
  readonly endpoint: string;
  readonly nextFrame: () => Promise<Uint8Array>;
}

interface StaticFileServer {
  readonly close: () => Promise<void>;
  readonly origin: string;
}

const createStaticFileServer = async (
  rootDirectory: string
): Promise<StaticFileServer> => {
  const root = normalize(rootDirectory);
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");

    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname === "/renderer.html") {
        response.setHeader("Content-Type", "text/html");
        response.writeHead(200);
        response.end(rendererHtml);
        return;
      }

      if (pathname === "/asset") {
        const assetPath = requestUrl.searchParams.get("path");
        if (!assetPath) {
          response.writeHead(400);
          response.end();
          return;
        }

        const content = await readFile(assetPath);
        response.setHeader("Content-Type", getContentType(assetPath));
        response.writeHead(200);
        response.end(content);
        return;
      }

      const normalizedPath = normalize(join(root, pathname));

      if (!(normalizedPath === root || normalizedPath.startsWith(root + sep))) {
        response.writeHead(403);
        response.end();
        return;
      }

      const content = await readFile(normalizedPath);
      response.setHeader("Content-Type", getContentType(normalizedPath));
      response.writeHead(200);
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise<void>((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveServer();
    });
  });

  return {
    close: () => closeServer(server),
    origin: `http://127.0.0.1:${getServerPort(server)}`,
  };
};

const getContentType = (path: string): string => {
  if (extname(path) === ".js" || extname(path) === ".mjs") {
    return "text/javascript";
  }

  if (extname(path) === ".json") {
    return "application/json";
  }

  return "application/octet-stream";
};

const createFrameReceiver = async (): Promise<FrameReceiver> => {
  let pendingResolve: ((frame: Uint8Array) => void) | undefined;
  let pendingReject: ((error: Error) => void) | undefined;
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("error", (error) => {
      pendingReject?.(error);
    });
    request.on("end", () => {
      pendingResolve?.(Buffer.concat(chunks));
      pendingResolve = undefined;
      pendingReject = undefined;
      response.writeHead(204);
      response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    close: () => closeServer(server),
    endpoint: `http://127.0.0.1:${getServerPort(server)}/frame`,
    nextFrame: () =>
      new Promise<Uint8Array>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      }),
  };
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const getServerPort = (server: Server): number => {
  const address = server.address();

  if (!(address && typeof address === "object")) {
    throw new Error("Frame receiver did not bind to a port.");
  }

  return address.port;
};

const launchBrowser = (): Promise<Browser> => {
  const executablePath = getBrowserExecutablePath();

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--no-sandbox",
    ],
  });
};

const getBrowserExecutablePath = (): string => {
  if (process.env.VBAAS_CHROMIUM_PATH) {
    return process.env.VBAAS_CHROMIUM_PATH;
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const localCandidate = chromeCandidates.find((candidate) =>
    existsSync(candidate)
  );

  if (localCandidate) {
    return localCandidate;
  }

  throw new Error(
    "Unable to find Chromium. Set VBAAS_CHROMIUM_PATH or PUPPETEER_EXECUTABLE_PATH."
  );
};

const getMediabunnyModuleRoot = (): string =>
  resolve(import.meta.dirname, "../../node_modules/mediabunny/dist/bundles");

const buildBrowserRenderScene = (plan: RenderPlan): BrowserRenderScene => ({
  canvas: plan.canvas,
  durationFrames: plan.durationFrames,
  layers: [
    ...plan.visualLayers
      .map((visualLayer) => visualLayerToBrowserLayer(visualLayer, plan))
      .filter((layer) => layer !== undefined),
    ...plan.htmlLayers.map((htmlLayer) =>
      htmlLayerToBrowserLayer(htmlLayer, plan)
    ),
  ].toSorted((a, b) => getLayerOrder(a) - getLayerOrder(b)),
});

const visualLayerToBrowserLayer = (
  visualLayer: VisualLayer,
  plan: RenderPlan
): BrowserRenderLayer | undefined => {
  const mediaInput = plan.inputs.find(
    (input) => input.inputIndex === visualLayer.inputIndex
  );

  if (!mediaInput) {
    return;
  }

  const layout = resolveLayout({
    height: plan.canvas.height,
    layout: visualLayer.layout,
    width: plan.canvas.width,
  });

  return {
    ...layout,
    assetUrl: sourceToBrowserUrl(mediaInput.asset.resolvedSource),
    durationFrames: visualLayer.durationFrames,
    id: visualLayer.clipId,
    playbackRate: mediaInput.playbackRate,
    sourceStartFrame: mediaInput.sourceStartFrame,
    startFrame: visualLayer.startFrame,
    type: visualLayer.type,
  };
};

const htmlLayerToBrowserLayer = (
  htmlLayer: HtmlLayer,
  plan: RenderPlan
): BrowserRenderLayer => {
  const track = htmlLayer.track;

  if (htmlLayer.kind === "caption" && track) {
    return captionLayerToBrowserLayer(htmlLayer, track, plan);
  }

  return textLayerToBrowserLayer(htmlLayer, plan);
};

const captionLayerToBrowserLayer = (
  htmlLayer: HtmlLayer,
  track: NonNullable<HtmlLayer["track"]>,
  plan: RenderPlan
): BrowserRenderLayer => ({
  align: track.layout.align ?? "center",
  backgroundColor: track.style.backgroundColor ?? "rgba(0, 0, 0, 0.65)",
  color: track.style.color ?? defaultTextColor,
  durationFrames: htmlLayer.durationFrames,
  fontFamily: track.style.fontFamily ?? "Inter",
  fontSize: track.style.fontSize ?? 42,
  fontWeight: track.style.fontWeight ?? "700",
  id: htmlLayer.id,
  lineHeight:
    track.style.lineHeight ?? Math.round((track.style.fontSize ?? 42) * 1.2),
  maxWidth: track.layout.maxWidth ?? plan.canvas.width * 0.86,
  position: track.layout.position ?? "bottom",
  startFrame: htmlLayer.startFrame,
  text: htmlLayer.text,
  type: "caption",
});

const textLayerToBrowserLayer = (
  htmlLayer: HtmlLayer,
  plan: RenderPlan
): BrowserRenderLayer => {
  const layout = resolveLayout({
    height: plan.canvas.height,
    layout: htmlLayer.clip?.layout,
    width: plan.canvas.width,
  });

  return {
    align: htmlLayer.clip?.style.align ?? "center",
    color: htmlLayer.clip?.style.color ?? defaultTextColor,
    durationFrames: htmlLayer.durationFrames,
    fontFamily: htmlLayer.clip?.style.fontFamily ?? "Inter",
    fontSize: htmlLayer.clip?.style.fontSize ?? 64,
    fontWeight: htmlLayer.clip?.style.fontWeight ?? "700",
    height: layout.height,
    id: htmlLayer.id,
    lineHeight:
      htmlLayer.clip?.style.lineHeight ??
      (htmlLayer.clip?.style.fontSize ?? 64) * 1.18,
    opacity: layout.opacity,
    rotation: layout.rotation,
    startFrame: htmlLayer.startFrame,
    text: htmlLayer.text,
    type: "text",
    width: layout.width,
    x: layout.x,
    y: layout.y,
  };
};

const sourceToBrowserUrl = (source: string): string => {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }

  return pathToFileURL(source).href;
};

const resolveLayout = ({
  height,
  layout,
  width,
}: {
  readonly height: number;
  readonly layout: RenderPlan["visualLayers"][number]["layout"];
  readonly width: number;
}) => ({
  fit: layout?.fit ?? "cover",
  height: layout?.height ?? height,
  opacity: layout?.opacity ?? 1,
  rotation: layout?.rotation ?? 0,
  width: layout?.width ?? width,
  x: layout?.x ?? 0,
  y: layout?.y ?? 0,
});

const getLayerOrder = (layer: BrowserRenderLayer): number => {
  if (layer.type === "image" || layer.type === "video") {
    return 0;
  }

  if (layer.type === "text") {
    return 1;
  }

  return 2;
};

const withBrowserServedAssets = (
  scene: BrowserRenderScene,
  origin: string
): BrowserRenderScene => ({
  ...scene,
  layers: scene.layers.map((layer) => {
    if (layer.type !== "image" && layer.type !== "video") {
      return layer;
    }

    if (!layer.assetUrl.startsWith("file://")) {
      return layer;
    }

    return {
      ...layer,
      assetUrl: `${origin}/asset?path=${encodeURIComponent(
        fileURLToPath(layer.assetUrl)
      )}`,
    };
  }),
});

function initializeBrowserRenderer(scene: BrowserRenderScene) {
  const browserDefaultBackground = "#050507";
  const browserDefaultTextShadowColor = "rgba(0, 0, 0, 0.72)";
  const textLinesByKey = new Map<string, string[]>();
  const sourceById = new Map<string, HTMLImageElement | HTMLVideoElement>();
  const canvas = document.getElementById("frame") as HTMLCanvasElement | null;

  if (!canvas) {
    throw new Error("Frame canvas not found.");
  }

  canvas.width = scene.canvas.width;
  canvas.height = scene.canvas.height;

  const loadImage = (layer: BrowserMediaLayer) =>
    new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        sourceById.set(layer.id, image);
        resolve();
      };
      image.onerror = () => reject(new Error(`Unable to load ${layer.id}.`));
      image.src = layer.assetUrl;
    });

  const loadVideo = (layer: BrowserMediaLayer) =>
    new Promise<void>((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.onloadedmetadata = () => {
        sourceById.set(layer.id, video);
        resolve();
      };
      video.onerror = () => reject(new Error(`Unable to load ${layer.id}.`));
      video.src = layer.assetUrl;
      video.load();
    });

  const seekVideo = (video: HTMLVideoElement, timeSeconds: number) =>
    new Promise<void>((resolve) => {
      const duration = Number.isFinite(video.duration)
        ? video.duration
        : undefined;
      const targetTime =
        duration === undefined
          ? timeSeconds
          : Math.min(Math.max(timeSeconds, 0), Math.max(0, duration - 0.001));

      if (Math.abs(video.currentTime - targetTime) < 0.001) {
        resolve();
        return;
      }

      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      if (typeof video.fastSeek === "function") {
        video.fastSeek(targetTime);
      } else {
        video.currentTime = targetTime;
      }
    });

  const getSourceSize = (source: CanvasImageSource) => {
    if ("videoWidth" in source) {
      return { height: source.videoHeight, width: source.videoWidth };
    }

    if ("naturalWidth" in source) {
      return { height: source.naturalHeight, width: source.naturalWidth };
    }

    if ("height" in source && "width" in source) {
      return {
        height: Number(source.height),
        width: Number(source.width),
      };
    }

    return { height: 0, width: 0 };
  };

  const getFittedRect = ({
    fit,
    height,
    sourceHeight,
    sourceWidth,
    width,
  }: {
    fit: "contain" | "cover" | "fill" | "none";
    height: number;
    sourceHeight: number;
    sourceWidth: number;
    width: number;
  }) => {
    if (fit === "fill") {
      return { height, width, x: 0, y: 0 };
    }

    if (fit === "none") {
      return {
        height: sourceHeight,
        width: sourceWidth,
        x: (width - sourceWidth) / 2,
        y: (height - sourceHeight) / 2,
      };
    }

    const scale =
      fit === "contain"
        ? Math.min(width / sourceWidth, height / sourceHeight)
        : Math.max(width / sourceWidth, height / sourceHeight);
    const fittedWidth = sourceWidth * scale;
    const fittedHeight = sourceHeight * scale;

    return {
      height: fittedHeight,
      width: fittedWidth,
      x: (width - fittedWidth) / 2,
      y: (height - fittedHeight) / 2,
    };
  };

  const quoteFontFamily = (fontFamily: string) =>
    `"${fontFamily.replaceAll('"', '\\"')}"`;

  const wrapText = ({
    context,
    font,
    maxWidth,
    text,
  }: {
    context: CanvasRenderingContext2D;
    font: string;
    maxWidth: number;
    text: string;
  }) => {
    context.save();
    context.font = font;

    const lines: string[] = [];
    for (const sourceLine of text.split("\n")) {
      const words = sourceLine.trim().split(" ").filter(Boolean);
      let line = "";

      for (const word of words) {
        const nextLine = line ? `${line} ${word}` : word;
        if (context.measureText(nextLine).width <= maxWidth || !line) {
          line = nextLine;
          continue;
        }

        lines.push(line);
        line = word;
      }

      lines.push(line);
    }

    context.restore();
    return lines.length > 0 ? lines : [""];
  };

  const getCachedTextLines = ({
    context,
    font,
    id,
    maxWidth,
    text,
  }: {
    context: CanvasRenderingContext2D;
    font: string;
    id: string;
    maxWidth: number;
    text: string;
  }) => {
    const key = `${id}:${font}:${maxWidth}:${text}`;
    const cachedLines = textLinesByKey.get(key);

    if (cachedLines) {
      return cachedLines;
    }

    const lines = wrapText({
      context,
      font,
      maxWidth,
      text,
    });
    textLinesByKey.set(key, lines);
    return lines;
  };

  const getTextAlignX = ({
    align,
    width,
  }: {
    align: "center" | "left" | "right";
    width: number;
  }) => {
    if (align === "left") {
      return -width / 2;
    }

    if (align === "right") {
      return width / 2;
    }

    return 0;
  };

  const getBoxTextAlignX = ({
    align,
    padding,
    width,
    x,
  }: {
    align: "center" | "left" | "right";
    padding: number;
    width: number;
    x: number;
  }) => {
    if (align === "left") {
      return x + padding;
    }

    if (align === "right") {
      return x + width - padding;
    }

    return x + width / 2;
  };

  const drawMedia = (
    context: CanvasRenderingContext2D,
    layer: BrowserMediaLayer
  ) => {
    const source = sourceById.get(layer.id);
    if (!source) {
      return;
    }

    const { height: sourceHeight, width: sourceWidth } = getSourceSize(source);
    const drawRect = getFittedRect({
      fit: layer.fit,
      height: layer.height,
      sourceHeight,
      sourceWidth,
      width: layer.width,
    });

    context.save();
    context.globalAlpha = layer.opacity;
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.drawImage(
      source,
      drawRect.x - layer.width / 2,
      drawRect.y - layer.height / 2,
      drawRect.width,
      drawRect.height
    );
    context.restore();
  };

  const drawText = (
    context: CanvasRenderingContext2D,
    layer: BrowserTextLayer
  ) => {
    const font = `${layer.fontWeight} ${layer.fontSize}px ${quoteFontFamily(
      layer.fontFamily
    )}, Arial, sans-serif`;
    const lines = getCachedTextLines({
      context,
      font,
      id: layer.id,
      maxWidth: layer.width,
      text: layer.text,
    });

    context.save();
    context.globalAlpha = layer.opacity;
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.font = font;
    context.fillStyle = layer.color;
    context.textAlign = layer.align;
    context.textBaseline = "middle";
    context.shadowBlur = 22;
    context.shadowColor = browserDefaultTextShadowColor;
    context.lineWidth = Math.max(2, layer.fontSize * 0.04);
    context.strokeStyle = "rgba(0, 0, 0, 0.62)";

    const totalHeight = lines.length * layer.lineHeight;
    const firstY = -totalHeight / 2 + layer.lineHeight / 2;

    for (const [lineIndex, line] of lines.entries()) {
      const x = getTextAlignX({ align: layer.align, width: layer.width });
      const y = firstY + lineIndex * layer.lineHeight;
      context.strokeText(line, x, y);
      context.fillText(line, x, y);
    }

    context.restore();
  };

  const drawCaption = (
    context: CanvasRenderingContext2D,
    layer: BrowserCaptionLayer
  ) => {
    const height = layer.lineHeight * 2.4;
    const x = (scene.canvas.width - layer.maxWidth) / 2;
    let y = scene.canvas.height - height - scene.canvas.height * 0.1;
    if (layer.position === "top") {
      y = scene.canvas.height * 0.1;
    } else if (layer.position === "center") {
      y = (scene.canvas.height - height) / 2;
    }
    const font = `${layer.fontWeight} ${layer.fontSize}px ${quoteFontFamily(
      layer.fontFamily
    )}, Arial, sans-serif`;

    context.save();
    context.fillStyle = layer.backgroundColor;
    context.beginPath();
    context.roundRect(x, y, layer.maxWidth, height, 14);
    context.fill();
    context.font = font;
    context.fillStyle = layer.color;
    context.textAlign = layer.align;
    context.textBaseline = "middle";
    context.shadowBlur = 14;
    context.shadowColor = browserDefaultTextShadowColor;

    const lines = getCachedTextLines({
      context,
      font,
      id: layer.id,
      maxWidth: layer.maxWidth - 68,
      text: layer.text,
    }).slice(0, 2);
    const totalHeight = lines.length * layer.lineHeight;
    const firstY = y + height / 2 - totalHeight / 2 + layer.lineHeight / 2;

    for (const [lineIndex, line] of lines.entries()) {
      context.fillText(
        line.toUpperCase(),
        getBoxTextAlignX({
          align: layer.align,
          padding: 34,
          width: layer.maxWidth,
          x,
        }),
        firstY + lineIndex * layer.lineHeight
      );
    }

    context.restore();
  };

  const loadAssets = async () => {
    await Promise.all(
      scene.layers.map((layer) => {
        if (layer.type === "image") {
          return loadImage(layer);
        }

        if (layer.type === "video") {
          return loadVideo(layer);
        }

        return Promise.resolve();
      })
    );
  };

  const renderFrame = async (frame: number) => {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create canvas context.");
    }

    const activeLayers = scene.layers.filter(
      (layer) =>
        frame >= layer.startFrame &&
        frame < layer.startFrame + layer.durationFrames
    );

    for (const layer of activeLayers) {
      if (layer.type !== "video") {
        continue;
      }

      const source = sourceById.get(layer.id);
      if (source instanceof HTMLVideoElement) {
        await seekVideo(
          source,
          (layer.sourceStartFrame +
            (frame - layer.startFrame) * layer.playbackRate) /
            scene.canvas.fps
        );
      }
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = browserDefaultBackground;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (const layer of activeLayers) {
      switch (layer.type) {
        case "image":
        case "video":
          drawMedia(context, layer);
          break;
        case "text":
          drawText(context, layer);
          break;
        case "caption":
          drawCaption(context, layer);
          break;
        default:
          break;
      }
    }

    return;
  };

  Object.assign(window, {
    __vbaasRenderFrame: renderFrame,
    __vbaasRenderReady: loadAssets(),
  });
}

async function renderBrowserFrame(frame: number): Promise<string> {
  const renderReady = (
    window as typeof window & { __vbaasRenderReady?: Promise<void> }
  ).__vbaasRenderReady;
  const renderFrame = (
    window as typeof window & {
      __vbaasRenderFrame?: (frame: number) => Promise<void>;
    }
  ).__vbaasRenderFrame;

  if (!renderFrame) {
    throw new Error("Browser renderer was not initialized.");
  }

  await renderReady;
  await renderFrame(frame);

  const canvas = document.getElementById("frame") as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error("Frame canvas not found.");
  }

  return canvas.toDataURL("image/png");
}

async function renderBrowserFrameToEndpoint({
  endpoint,
  frame,
}: {
  endpoint: string;
  frame: number;
}): Promise<void> {
  const renderReady = (
    window as typeof window & { __vbaasRenderReady?: Promise<void> }
  ).__vbaasRenderReady;
  const renderFrame = (
    window as typeof window & {
      __vbaasRenderFrame?: (frame: number) => Promise<void>;
    }
  ).__vbaasRenderFrame;

  if (!renderFrame) {
    throw new Error("Browser renderer was not initialized.");
  }

  await renderReady;
  await renderFrame(frame);

  const canvas = document.getElementById("frame") as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error("Frame canvas not found.");
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error("Unable to encode frame blob."));
    }, "image/png");
  });
  const response = await fetch(endpoint, {
    body: blob,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Unable to send frame ${frame}.`);
  }
}

async function encodeBrowserVideo({
  durationFrames,
  fps,
  mediabunnyUrl,
}: {
  durationFrames: number;
  fps: number;
  mediabunnyUrl: string;
}): Promise<number[]> {
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } =
    await import(mediabunnyUrl);
  const canvas = document.getElementById("frame") as HTMLCanvasElement | null;

  if (!canvas) {
    throw new Error("Frame canvas not found.");
  }

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, {
    bitrate: QUALITY_HIGH,
    codec: "avc",
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });
  await output.start();

  const renderReady = (
    window as typeof window & { __vbaasRenderReady?: Promise<void> }
  ).__vbaasRenderReady;
  const renderFrame = (
    window as typeof window & {
      __vbaasRenderFrame?: (frame: number) => Promise<void>;
    }
  ).__vbaasRenderFrame;

  if (!renderFrame) {
    throw new Error("Browser renderer was not initialized.");
  }

  await renderReady;

  for (let frame = 0; frame < durationFrames; frame++) {
    await renderFrame(frame);
    await videoSource.add(frame / fps, 1 / fps);
  }

  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) {
    throw new Error("Mediabunny did not produce an output buffer.");
  }

  return Array.from(new Uint8Array(buffer));
}
