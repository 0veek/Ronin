import { afterEach, expect, it, vi } from "vite-plus/test";
import { createDeviceStreamClient } from "./stream.ts";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const envelope = (tag: number, payload: number[]) => {
  const length = 1 + payload.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    tag,
    ...payload,
  ];
};

class MjpegImage extends EventTarget {
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";
  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }
  }
}

function recoveryFixture(platform: "ios" | "android" = "ios", preferMjpeg = true) {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    binaryType = "";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: ArrayBuffer | string }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    constructor() {
      sockets.push(this);
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  const decoders: Decoder[] = [];
  class Decoder {
    static isConfigSupported = vi.fn(async () => ({ supported: true }));
    state = "unconfigured";
    decodeQueueSize = 0;
    configure() {
      this.state = "configured";
    }
    reset = vi.fn(() => {
      this.state = "unconfigured";
      this.decodeQueueSize = 0;
    });
    close() {
      this.state = "closed";
    }
    decode = vi.fn();
    readonly callbacks: { output: (frame: VideoFrame) => void; error: () => void };
    constructor(callbacks: { output: (frame: VideoFrame) => void; error: () => void }) {
      this.callbacks = callbacks;
      decoders.push(this);
    }
  }
  vi.stubGlobal("VideoDecoder", Decoder);
  vi.stubGlobal("EncodedVideoChunk", vi.fn());
  const videoBodies: ReadableStreamDefaultController<Uint8Array>[] = [];
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const signal = init.signal!;
    signals.push(signal);
    if (!url.includes("stream.avcc")) return Promise.resolve(new Response("prime"));
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(body) {
            videoBodies.push(body);
            signal.addEventListener("abort", () => body.error(new Error("aborted")), {
              once: true,
            });
          },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const events = {
    onStatus: vi.fn(),
    onScreen: vi.fn(),
    onUnauthorized: vi.fn(),
    onMjpegFallback: vi.fn(),
    onInputConnected: vi.fn(),
  };
  const drawImage = vi.fn();
  const image = new MjpegImage();
  const client = createDeviceStreamClient(
    {
      platform,
      preferMjpeg,
      deviceId: "test-device",
      access: {
        httpBase: "https://test/api/device-hub",
        wsBase: "wss://test/api/device-hub",
        credentials: true,
        query: {},
      },
    },
    { getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement,
    events,
  );
  client.setMjpegImage(image as unknown as HTMLImageElement);
  const imageReady = () => {
    image.naturalWidth = 400;
    image.naturalHeight = 800;
    image.dispatchEvent(new Event("load"));
  };
  const decodedFrame = (index = decoders.length - 1) => {
    const close = vi.fn();
    decoders[index]!.callbacks.output({
      displayWidth: 400,
      displayHeight: 800,
      close,
    } as unknown as VideoFrame);
    return close;
  };
  const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0, 0x1f, 0, 0, 1, 0x65]).buffer;
  return {
    client,
    events,
    image,
    imageReady,
    sockets,
    signals,
    fetch,
    videoBodies,
    decoders,
    Decoder,
    drawImage,
    decodedFrame,
    sps,
  };
}

it("waits for iOS input admission and respects native input loss and recovery", async () => {
  const { client, sockets, events } = recoveryFixture();
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  const socket = sockets[0]!;
  socket.onopen?.();
  expect(events.onInputConnected).not.toHaveBeenCalledWith(true);
  socket.onmessage?.({ data: new Uint8Array([0x83]).buffer });
  expect(events.onInputConnected).toHaveBeenLastCalledWith(true);
  const config = (inputUnavailable: boolean) => {
    const json = new TextEncoder().encode(
      JSON.stringify({ width: 400, height: 800, orientation: "portrait", inputUnavailable }),
    );
    const packet = new Uint8Array(1 + json.length);
    packet[0] = 0x82;
    packet.set(json, 1);
    socket.onmessage?.({ data: packet.buffer });
  };
  config(true);
  expect(events.onInputConnected).toHaveBeenLastCalledWith(false, "Simulator input is unavailable");
  socket.send.mockClear();
  client.sendTouch("begin", 0.2, 0.3);
  client.pressButton("home");
  expect(socket.send).not.toHaveBeenCalled();
  config(false);
  expect(events.onInputConnected).toHaveBeenLastCalledWith(true, undefined);
  client.sendTouch("begin", 0.2, 0.3);
  expect(socket.send).toHaveBeenCalledOnce();
  client.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("drops an iOS decode backlog and resumes at a keyframe without switching to MJPEG", async () => {
  const { client, videoBodies, decoders, events, decodedFrame } = recoveryFixture("ios", false);
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  const body = videoBodies[0]!;
  body.enqueue(new Uint8Array([...envelope(1, [1, 0x64, 0, 0x1f]), ...envelope(2, [1])]));
  await vi.advanceTimersByTimeAsync(0);
  decodedFrame();
  const decoder = decoders[0]!;
  expect(decoder.decode).toHaveBeenCalledOnce();
  decoder.decodeQueueSize = 9;
  body.enqueue(new Uint8Array([...envelope(3, [2]), ...envelope(3, [3])]));
  await vi.advanceTimersByTimeAsync(0);
  expect(decoder.reset).toHaveBeenCalledOnce();
  expect(decoder.decode).toHaveBeenCalledOnce();
  body.enqueue(new Uint8Array([...envelope(2, [4]), ...envelope(3, [5])]));
  await vi.advanceTimersByTimeAsync(0);
  expect(decoder.decode).toHaveBeenCalledTimes(3);
  expect(events.onMjpegFallback).not.toHaveBeenCalled();
  expect(events.onStatus).toHaveBeenLastCalledWith("streaming", undefined);
  client.stop();
});

it("does not repaint a delayed JPEG seed over newer decoded video", async () => {
  const { client, videoBodies, drawImage, decodedFrame } = recoveryFixture("ios", false);
  let resolveBitmap!: (bitmap: ImageBitmap) => void;
  vi.stubGlobal(
    "createImageBitmap",
    () =>
      new Promise((resolve) => {
        resolveBitmap = resolve;
      }),
  );
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  videoBodies[0]!.enqueue(
    new Uint8Array([...envelope(4, [1]), ...envelope(1, [1, 0x64, 0, 0x1f]), ...envelope(2, [2])]),
  );
  await vi.advanceTimersByTimeAsync(0);
  decodedFrame();
  const close = vi.fn();
  resolveBitmap({ width: 400, height: 800, close } as unknown as ImageBitmap);
  await vi.advanceTimersByTimeAsync(0);
  expect(drawImage).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  client.stop();
});

it("reopens a stalled AVCC body without disconnecting input, then receives fresh video", async () => {
  const { client, videoBodies, events, signals, sockets, decodedFrame } = recoveryFixture(
    "ios",
    false,
  );
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ width: 400, height: 800, close }));
  try {
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.onmessage?.({ data: new Uint8Array([0x83]).buffer });
    videoBodies[0]!.enqueue(new Uint8Array(envelope(4, [1])));
    await vi.advanceTimersByTimeAsync(0);
    expect(events.onStatus).toHaveBeenLastCalledWith("streaming", undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(events.onStatus).toHaveBeenLastCalledWith(
      "connecting",
      expect.stringContaining("stopped receiving video"),
    );
    expect(signals[1]!.aborted).toBe(true);
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(events.onInputConnected).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(videoBodies).toHaveLength(2);
    videoBodies[1]!.enqueue(new Uint8Array(envelope(1, [1, 0x64, 0, 0x1f])));
    await vi.advanceTimersByTimeAsync(0);
    decodedFrame();
    expect(events.onStatus).toHaveBeenLastCalledWith("streaming", undefined);
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    client.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
