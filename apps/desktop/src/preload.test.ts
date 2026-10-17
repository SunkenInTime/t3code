import type { DesktopBridge, DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as IpcChannels from "./ipc/channels.ts";

const { exposeInMainWorld, sendSync, invoke } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  sendSync: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { sendSync, invoke, on: vi.fn(), removeListener: vi.fn() },
  webFrame: { getZoomFactor: () => 1 },
  webUtils: { getPathForFile: () => "" },
}));
vi.mock("@clerk/electron/preload", () => ({ exposeClerkBridge: vi.fn() }));

const primary: DesktopEnvironmentBootstrap = {
  id: "primary",
  label: "Local",
  runningDistro: null,
  httpBaseUrl: "http://127.0.0.1:3773/",
  wsBaseUrl: "ws://127.0.0.1:3773/",
};
const wsl: DesktopEnvironmentBootstrap = {
  id: "wsl:default",
  label: "WSL (Ubuntu)",
  runningDistro: "Ubuntu",
  httpBaseUrl: "http://127.0.0.1:4000/",
  wsBaseUrl: "ws://127.0.0.1:4000/",
};

async function loadBridge(): Promise<DesktopBridge> {
  vi.resetModules();
  exposeInMainWorld.mockClear();
  await import("./preload.ts");
  const [, bridge] = exposeInMainWorld.mock.calls.find(([key]) => key === "desktopBridge")!;
  return bridge as DesktopBridge;
}

function syncReads(channel: string): number {
  return sendSync.mock.calls.filter(([called]) => called === channel).length;
}

describe("desktop preload topology reads", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    sendSync.mockReset();
    invoke.mockReset();
    sendSync.mockImplementation((channel: string) => {
      if (channel === IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL) return [primary];
      if (channel === IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL) return true;
      return undefined;
    });
  });

  it("blocks on the main process once, not on every poll", async () => {
    const bridge = await loadBridge();
    for (let poll = 0; poll < 100; poll++) {
      expect(bridge.getLocalEnvironmentBootstraps()).toEqual([primary]);
      expect(bridge.getLocalEnvironmentEnabled?.()).toBe(true);
    }
    expect(syncReads(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL)).toBe(1);
    expect(syncReads(IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL)).toBe(1);
  });

  it("refreshes over invoke and serves the result to synchronous readers", async () => {
    const bridge = await loadBridge();
    expect(bridge.getLocalEnvironmentBootstraps()).toEqual([primary]);

    invoke.mockResolvedValueOnce([primary, wsl]);
    expect(await bridge.readLocalEnvironmentBootstraps?.()).toEqual([primary, wsl]);
    expect(invoke).toHaveBeenCalledWith(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL);
    expect(bridge.getLocalEnvironmentBootstraps()).toEqual([primary, wsl]);

    invoke.mockResolvedValueOnce([primary]);
    await bridge.readLocalEnvironmentBootstraps?.();
    expect(bridge.getLocalEnvironmentBootstraps()).toEqual([primary]);
    expect(syncReads(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL)).toBe(1);
  });

  it("keeps the last topology when a refresh fails", async () => {
    const bridge = await loadBridge();
    invoke.mockResolvedValueOnce([primary, wsl]);
    await bridge.readLocalEnvironmentBootstraps?.();

    invoke.mockRejectedValueOnce(new Error("main process gone"));
    await expect(bridge.readLocalEnvironmentBootstraps?.()).rejects.toThrow("main process gone");
    expect(bridge.getLocalEnvironmentBootstraps()).toEqual([primary, wsl]);
    expect(syncReads(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL)).toBe(0);
  });
});
