import "../index.css";

import {
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { getRouter } from "../router";
import { useStore } from "../store";

const PROJECT_ID = "project-sidebar-motion" as ProjectId;
const PROJECT_TITLE = "Sidebar Motion Project";
const NOW_ISO = "2026-03-15T12:00:00.000Z";
const THREAD_IDS = Array.from(
  { length: 8 },
  (_, index) => `thread-sidebar-motion-${index + 1}` as ThreadId,
);
const ACTIVE_THREAD_OUTSIDE_PREVIEW = THREAD_IDS[7]!;

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
}

interface SidebarLayoutSnapshot {
  activeRowHeight: number;
  activeRowInstances: number;
  activeRowTopWithinViewport: number;
  renderedThreadIds: string[];
  translateY: number;
  viewportHeight: number;
}

let fixture: TestFixture;

const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
    ],
    availableEditors: [],
  };
}

function isoAt(offsetMinutes: number): string {
  return new Date(Date.parse(NOW_ISO) - offsetMinutes * 60_000).toISOString();
}

function createSnapshot(activeThreadId: ThreadId): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: PROJECT_TITLE,
        workspaceRoot: "/repo/project",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: THREAD_IDS.map((threadId, index) => {
      const createdAt = isoAt(index);

      return {
        id: threadId,
        projectId: PROJECT_ID,
        title: `Thread ${index + 1}`,
        model: "gpt-5",
        interactionMode: "default" as const,
        runtimeMode: "full-access" as const,
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
        messages: [
          {
            id: `message-${index + 1}` as MessageId,
            role: "user" as const,
            text: `Sidebar thread ${index + 1}`,
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId,
          status: "ready" as const,
          providerName: "codex",
          runtimeMode: "full-access" as const,
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
      };
    }),
    updatedAt: NOW_ISO,
  };
}

function buildFixture(activeThreadId: ThreadId): TestFixture {
  return {
    snapshot: createSnapshot(activeThreadId),
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/project",
      projectName: PROJECT_TITLE,
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: activeThreadId,
    },
  };
}

function resolveWsRpc(tag: string): unknown {
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    client.send(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      let request: { id: string; body: { _tag: string } };
      try {
        request = JSON.parse(rawData) as { id: string; body: { _tag: string } };
      } catch {
        return;
      }
      const method = request.body?._tag;
      if (typeof method !== "string") return;
      client.send(
        JSON.stringify({
          id: request.id,
          result: resolveWsRpc(method),
        }),
      );
    });
  }),
  http.get("*/attachments/:attachmentId", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    { timeout: 4_000, interval: 16 },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

async function setViewport(): Promise<void> {
  await page.viewport(960, 900);
  await waitForLayout();
}

async function settleSidebarMotion(): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 260);
  });
  await waitForLayout();
}

async function mountApp(activeThreadId: ThreadId): Promise<{ cleanup: () => Promise<void> }> {
  fixture = buildFixture(activeThreadId);
  await setViewport();
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(createMemoryHistory({ initialEntries: [`/${activeThreadId}`] }));
  const screen = await render(<RouterProvider router={router} />, { container: host });
  await waitForLayout();

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

async function waitForProjectButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(document.querySelectorAll('[data-slot="sidebar-menu-button"]')).find((element) =>
        element.textContent?.includes(PROJECT_TITLE),
      ) as HTMLButtonElement | null,
    "Unable to find the sidebar project toggle button.",
  );
}

async function readSidebarLayout(activeThreadId: ThreadId): Promise<SidebarLayoutSnapshot> {
  const viewport = await waitForElement(
    () =>
      document.querySelector<HTMLElement>(
        `[data-project-thread-viewport][data-project-id="${PROJECT_ID}"]`,
      ),
    "Unable to find the animated sidebar thread viewport.",
  );
  const motion = await waitForElement(
    () => viewport.querySelector<HTMLElement>("[data-project-thread-motion]"),
    "Unable to find the animated sidebar thread list.",
  );
  const activeRow = await waitForElement(
    () => document.querySelector<HTMLElement>(`[data-thread-id="${activeThreadId}"]`),
    "Unable to find the active sidebar thread row.",
  );
  const viewportRect = viewport.getBoundingClientRect();
  const activeRect = activeRow.getBoundingClientRect();
  const transform = getComputedStyle(motion).transform;

  return {
    activeRowHeight: activeRect.height,
    activeRowInstances: document.querySelectorAll(`[data-thread-id="${activeThreadId}"]`).length,
    activeRowTopWithinViewport: activeRect.top - viewportRect.top,
    renderedThreadIds: Array.from(document.querySelectorAll<HTMLElement>("[data-thread-id]")).map(
      (element) => element.dataset.threadId ?? "",
    ),
    translateY: transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42,
    viewportHeight: viewportRect.height,
  };
}

describe("Sidebar collapse motion", () => {
  beforeAll(async () => {
    fixture = buildFixture(ACTIVE_THREAD_OUTSIDE_PREVIEW);
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(async () => {
    await setViewport();
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps an active thread outside the preview slice in the animated list during collapse and expand", async () => {
    const mounted = await mountApp(ACTIVE_THREAD_OUTSIDE_PREVIEW);

    try {
      const projectButton = await waitForProjectButton();
      const expandedLayout = await readSidebarLayout(ACTIVE_THREAD_OUTSIDE_PREVIEW);
      expect(expandedLayout.renderedThreadIds).toContain(ACTIVE_THREAD_OUTSIDE_PREVIEW);
      expect(expandedLayout.renderedThreadIds).toHaveLength(7);
      expect(expandedLayout.activeRowInstances).toBe(1);

      projectButton.click();
      await settleSidebarMotion();

      const collapsedLayout = await readSidebarLayout(ACTIVE_THREAD_OUTSIDE_PREVIEW);
      expect(collapsedLayout.activeRowInstances).toBe(1);
      expect(Math.abs(collapsedLayout.activeRowTopWithinViewport)).toBeLessThanOrEqual(2);
      expect(Math.abs(collapsedLayout.viewportHeight - collapsedLayout.activeRowHeight)).toBeLessThanOrEqual(
        2,
      );
      expect(collapsedLayout.translateY).toBeLessThan(-1);

      projectButton.click();
      await settleSidebarMotion();

      const reExpandedLayout = await readSidebarLayout(ACTIVE_THREAD_OUTSIDE_PREVIEW);
      expect(reExpandedLayout.renderedThreadIds).toContain(ACTIVE_THREAD_OUTSIDE_PREVIEW);
      expect(reExpandedLayout.renderedThreadIds).toHaveLength(7);
      expect(reExpandedLayout.activeRowInstances).toBe(1);
      expect(Math.abs(reExpandedLayout.translateY)).toBeLessThanOrEqual(1);
    } finally {
      await mounted.cleanup();
    }
  });
});
