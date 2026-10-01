/**
 * Runtime-level collab regression: boots the REAL CodexSessionRuntime against
 * a scripted mock app-server peer that replays the captured multi-agent wire
 * sequence (codexMultiAgentWire.json) plus the shapes the capture alone can't
 * script (receiver-turn bookkeeping via collabAgentToolCall, child terminal
 * lifecycle, approval pass-through). This is the layer the pure routing-table
 * test can't reach: ordering between the legacy receiver-turn suppressor and
 * v2 interception, registration state, and synthetic event emission.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { type ProviderApprovalDecision, type ProviderEvent, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { assert, describe } from "vite-plus/test";

import wireFixture from "../testFixtures/codexMultiAgentWire.json" with { type: "json" };
import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

const ROOT = wireFixture.rootThreadId;
const [CHILD_A, CHILD_B] = wireFixture.childThreadIds as [string, string];
const MEMORY = "memory-consolidation-thread";
const decodeMcpElicitationResponse = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.Number,
      result: Schema.Unknown,
    }),
  ),
);

/**
 * The captured sequence, extended with the shapes the live capture didn't
 * include: a collabAgentToolCall with receiverThreadIds (feeds the legacy
 * receiver-turn map, so ordering vs. v2 interception is exercised), child
 * terminal lifecycle, and a serverRequest/resolved addressed to a child
 * (must pass through to the parent path, not vanish).
 */
function buildScript() {
  const captured = wireFixture.notifications;
  const extras = [
    {
      method: "item/completed",
      params: {
        threadId: ROOT,
        item: {
          type: "collabAgentToolCall",
          id: "call_fixture_wait",
          tool: "wait",
          status: "completed",
          senderThreadId: ROOT,
          receiverThreadIds: [CHILD_A, CHILD_B],
        },
      },
    },
    // Background memory work can reach this connection with no thread/started
    // announcing it. Its output belongs to another thread; only its approval
    // cleanup still matters to the parent.
    ...agentMessage(MEMORY, "memory-message", "internal memory update"),
    { method: "warning", params: { threadId: MEMORY, message: "internal memory warning" } },
    { method: "serverRequest/resolved", params: { threadId: MEMORY, requestId: "memory-req" } },
    // Child terminal lifecycle AFTER the receiver map knows the children —
    // pre-fix, the legacy suppressor dropped these before interception saw
    // them, so no synthetic agent events were emitted.
    {
      method: "turn/completed",
      params: {
        threadId: CHILD_A,
        turn: { id: `${CHILD_A}-turn-1`, status: "completed", items: [] },
      },
    },
    { method: "thread/closed", params: { threadId: CHILD_B } },
    // Parent-owned traffic addressed to a child conversation: must reach the
    // parent path (approval correlation cleanup), not be swallowed.
    { method: "serverRequest/resolved", params: { threadId: CHILD_A, requestId: "req-1" } },
  ];
  return {
    rootThreadId: ROOT,
    notifications: [...captured.filter((entry) => entry.method !== "turn/completed"), ...extras],
  };
}

/** An agent message streamed on `threadId`: started, one delta, completed. */
function agentMessage(threadId: string, itemId: string, text: string) {
  const turnId = `${threadId}-turn`;
  return [
    {
      method: "item/started",
      params: {
        threadId,
        turnId,
        startedAtMs: 0,
        item: { type: "agentMessage", id: itemId, text: "" },
      },
    },
    { method: "item/agentMessage/delta", params: { threadId, turnId, itemId, delta: text } },
    {
      method: "item/completed",
      params: {
        threadId,
        turnId,
        completedAtMs: 0,
        item: { type: "agentMessage", id: itemId, text },
      },
    },
  ];
}

function capturedStartedActivity(childId = CHILD_A) {
  const captured = wireFixture.notifications.find((entry) => {
    const item = (entry.params as { item?: { type?: string; kind?: string } }).item;
    return item?.type === "subAgentActivity" && item.kind === "started";
  });
  assert.isDefined(captured);
  return {
    ...captured,
    params: {
      ...captured.params,
      item: {
        ...captured.params.item,
        agentThreadId: childId,
        agentPath: "/root/model-check",
      },
    },
  };
}

function capturedSpawnedThread(childId = CHILD_A) {
  const captured = wireFixture.notifications.find((entry) => entry.method === "thread/started");
  assert.isDefined(captured);
  return {
    ...captured,
    params: {
      thread: {
        ...captured.params.thread,
        id: childId,
        sessionId: childId,
        parentThreadId: ROOT,
        agentNickname: "model-check",
        agentRole: "verifier",
        source: {
          subAgent: {
            thread_spawn: {
              agent_nickname: "model-check",
              agent_path: "/root/model-check",
              agent_role: "verifier",
              depth: 1,
              parent_thread_id: ROOT,
            },
          },
        },
      },
    },
  };
}

function childSettings(threadId: string, model: string, effort: string) {
  return {
    method: "thread/settings/updated",
    params: {
      threadId,
      threadSettings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        collaborationMode: { mode: "default", settings: { model } },
        cwd: "/workspace/repo",
        effort,
        model,
        modelProvider: "openai",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    },
  };
}

function readRecordedRequests() {
  return NodeFS.readFileSync(`${scriptPath}.requests`, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
}

const scriptPath = NodePath.join(import.meta.dirname, "../testFixtures/.collab-script.json");
// Windows cannot run the shebang wrapper; the .cmd sibling does the same job.
const peerPath = NodePath.join(
  import.meta.dirname,
  `../testFixtures/codexCollabMockPeer.${HostProcessPlatform.defaultValue() === "win32" ? "cmd" : "sh"}`,
);

describe("CodexSessionRuntime collab integration", () => {
  it.effect("looks up child model metadata once after activity registration", () =>
    Effect.gen(function* () {
      const script = {
        rootThreadId: ROOT,
        recordRequests: true,
        notifications: [
          capturedStartedActivity(),
          capturedStartedActivity(),
          {
            ...capturedStartedActivity(CHILD_B),
            params: {
              ...capturedStartedActivity(CHILD_B).params,
              item: { ...capturedStartedActivity(CHILD_B).params.item, kind: "interacted" },
            },
          },
          { method: "thread/closed", params: { threadId: CHILD_B } },
          capturedSpawnedThread(ROOT),
        ],
        childResumeSnapshots: {
          [CHILD_A]: { model: "gpt-5.6-luna", reasoningEffort: "low" },
        },
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-model-activity"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const metadataFiber = yield* runtime.events.pipe(
        Stream.filter(
          (event) =>
            event.method === "collabAgent/metadataUpdated" &&
            (event.payload as { agentThreadId?: string }).agentThreadId === CHILD_A,
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      const session = yield* runtime.start();
      assert.equal(session.model, "gpt-5.6-sol");
      yield* runtime.sendTurn({ input: "start one child" });
      const metadataEvents = Array.from(yield* Fiber.join(metadataFiber));
      assert.deepInclude(metadataEvents[0]?.payload, {
        agentThreadId: CHILD_A,
        model: "gpt-5.6-luna",
        effort: "low",
      });
      assert.deepEqual(readRecordedRequests(), [
        {
          method: "thread/resume",
          params: { threadId: CHILD_A, excludeTurns: true },
        },
      ]);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps child settings and reroutes newer than the resume snapshot", () =>
    Effect.gen(function* () {
      const statusChanged = wireFixture.notifications.find(
        (entry) =>
          entry.method === "thread/status/changed" &&
          (entry.params as { threadId?: string }).threadId === CHILD_A,
      );
      assert.isDefined(statusChanged);
      const script = {
        rootThreadId: ROOT,
        recordRequests: true,
        notifications: [
          childSettings(CHILD_A, "child-before", "medium"),
          capturedSpawnedThread(),
          childSettings(CHILD_A, "child-after", "high"),
          {
            method: "model/rerouted",
            params: {
              threadId: CHILD_A,
              turnId: `${CHILD_A}-turn`,
              fromModel: "child-after",
              toModel: "child-rerouted",
              reason: "highRiskCyberActivity",
            },
          },
          {
            method: "model/rerouted",
            params: {
              threadId: ROOT,
              turnId: `${ROOT}-turn`,
              fromModel: "gpt-5.6-sol",
              toModel: "root-rerouted",
              reason: "highRiskCyberActivity",
            },
          },
        ],
        childResumeSnapshots: {
          [CHILD_A]: {
            model: "stale-snapshot",
            reasoningEffort: "low",
            notifications: [statusChanged],
          },
        },
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-model-spawn"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const eventsFiber = yield* runtime.events.pipe(
        Stream.takeUntil(
          (event) =>
            event.method === "collabAgent/statusChanged" &&
            (event.payload as { agentThreadId?: string }).agentThreadId === CHILD_A,
        ),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "start one spawned child" });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      const started = events.find((event) => event.method === "collabAgent/started");
      assert.deepInclude(started?.payload, {
        agentThreadId: CHILD_A,
        model: "child-before",
        effort: "medium",
      });
      const childStatus = events.find((event) => event.method === "collabAgent/statusChanged");
      assert.deepInclude(childStatus?.payload, {
        agentThreadId: CHILD_A,
        model: "child-rerouted",
        effort: "high",
      });
      assert.isTrue(
        events.some(
          (event) =>
            event.method === "model/rerouted" &&
            (event.payload as { threadId?: string }).threadId === ROOT,
        ),
        "the root reroute must stay on the parent path",
      );
      assert.isFalse(
        events.some(
          (event) =>
            (event.method === "thread/settings/updated" || event.method === "model/rerouted") &&
            (event.payload as { threadId?: string }).threadId === CHILD_A,
        ),
        "child metadata notifications must not leak to the parent path",
      );
      assert.equal(readRecordedRequests().length, 1);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not delay the parent turn when the child lookup fails", () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
        }),
      );
      for (const [name, childSnapshot] of [
        ["hang", { hang: true }],
        ["error", { error: "child unavailable" }],
      ] as const) {
        yield* Effect.gen(function* () {
          const marker = `lookup-${name}`;
          const script = {
            rootThreadId: ROOT,
            recordRequests: true,
            resumeRequestMarker: marker,
            notifications: [capturedStartedActivity()],
            childResumeSnapshots: { [CHILD_A]: childSnapshot },
          };
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
          NodeFS.rmSync(`${scriptPath}.requests`, { force: true });

          const runtime = yield* makeCodexSessionRuntime({
            threadId: ThreadId.make(`thread-collab-model-${name}`),
            binaryPath: peerPath,
            cwd: NodeOS.tmpdir(),
            runtimeMode: "full-access",
            environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
          });
          const eventsFiber = yield* runtime.events.pipe(
            Stream.takeUntil(
              (event) =>
                event.method === "serverRequest/resolved" &&
                (event.payload as { requestId?: string }).requestId === marker,
            ),
            Stream.runCollect,
            Effect.forkScoped,
          );

          yield* runtime.start();
          yield* runtime.sendTurn({ input: "finish without child metadata" });
          const events = Array.from(yield* Fiber.join(eventsFiber));
          assert.isTrue(events.some((event) => event.method === "turn/completed"));
          assert.equal(readRecordedRequests().length, 1);

          yield* runtime.close;
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
        }).pipe(Effect.scoped);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("replays the captured fan-out into synthetic agent events without child leaks", () =>
    Effect.gen(function* () {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(buildScript()), "utf8");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(scriptPath, { force: true })),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-integration"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });

      const eventsFiber = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "fan out" });

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const methods = events.map((event) => event.method);

      // Children registered from subAgentActivity become synthetic agent
      // lifecycle — including terminal rows that arrive AFTER the receiver
      // map knows them (the ordering this test exists to pin).
      assert.include(methods, "collabAgent/activity");
      assert.include(methods, "collabAgent/turnCompleted");
      assert.include(methods, "collabAgent/closed");

      const childTurnCompleted = events.find(
        (event) =>
          event.method === "collabAgent/turnCompleted" &&
          (event.payload as { agentThreadId?: string }).agentThreadId === CHILD_A,
      );
      assert.isDefined(childTurnCompleted, "child A's turn completion becomes an agent event");

      const childClosed = events.find(
        (event) =>
          event.method === "collabAgent/closed" &&
          (event.payload as { agentThreadId?: string }).agentThreadId === CHILD_B,
      );
      assert.isDefined(childClosed, "child B's close becomes an agent event");

      // Parent-owned resolution passes through — not swallowed, not
      // re-labelled as an agent event.
      assert.include(methods, "serverRequest/resolved");

      // The root's own subAgentActivity about "/root" must NOT register the
      // root as a child: the parent turn completion still flows.
      assert.include(methods, "turn/completed");

      // No raw child conversation methods leak onto the parent stream.
      const leaked = events.filter((event) => {
        const payload = event.payload as { threadId?: string } | undefined;
        const addressedToChild = payload?.threadId === CHILD_A || payload?.threadId === CHILD_B;
        return addressedToChild && (event.method?.startsWith("thread/") ?? false);
      });
      assert.deepEqual(
        leaked.map((event) => event.method),
        [],
        "child thread/* lifecycle must not appear as parent events",
      );

      const addressedToMemory = events
        .filter(
          (event) => (event.payload as { threadId?: string } | undefined)?.threadId === MEMORY,
        )
        .map((event) => event.method);
      assert.deepEqual(
        addressedToMemory.filter((method) => method !== "serverRequest/resolved"),
        [],
        "unannounced memory output must not appear as parent events",
      );
      assert.include(
        addressedToMemory,
        "serverRequest/resolved",
        "approval cleanup for an unidentified thread must not be held",
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("delivers a child's output that precedes its registration to the child", () =>
    Effect.gen(function* () {
      // Codex can stream a v2 child's items before the parent's
      // subAgentActivity registers it. Those items must reach the child path
      // in order once it registers, ahead of its later output.
      const script = {
        rootThreadId: ROOT,
        notifications: [
          ...agentMessage(CHILD_A, "early-message", "early child reply"),
          capturedStartedActivity(CHILD_A),
          ...agentMessage(CHILD_A, "later-message", "later child reply"),
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(scriptPath, { force: true })),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-early-child"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const eventsFiber = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "fan out" });
      const events = Array.from(yield* Fiber.join(eventsFiber));

      assert.deepEqual(
        events
          .filter(
            (event) =>
              (event.method === "collabAgent/activity" || event.method === "collabAgent/item") &&
              (event.payload as { agentThreadId?: string }).agentThreadId === CHILD_A,
          )
          .map((event) => {
            const item = (event.payload as { item?: { id: string; text: string } }).item;
            return item ? `${item.id}: ${item.text}` : event.method;
          }),
        [
          "collabAgent/activity",
          "early-message: ",
          "early-message: early child reply",
          "later-message: ",
          "later-message: later child reply",
        ],
      );
      assert.deepEqual(
        events
          .filter(
            (event) => (event.payload as { threadId?: string } | undefined)?.threadId === CHILD_A,
          )
          .map((event) => event.method),
        [],
        "child output must not appear as parent events",
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps announced subagent and receiver-map child output on the parent path", () =>
    Effect.gen(function* () {
      const REVIEW = "review-subagent-thread";
      const RECEIVER = "receiver-child-thread";
      const rootThreadStarted = wireFixture.notifications.find(
        (entry) => entry.method === "thread/started",
      );
      const collabToolCall = wireFixture.notifications.find(
        (entry) =>
          entry.method === "item/started" &&
          (entry.params as { item?: { type?: string } }).item?.type === "collabAgentToolCall",
      );
      assert.isDefined(rootThreadStarted);
      assert.isDefined(collabToolCall);
      const script = {
        rootThreadId: ROOT,
        notifications: [
          {
            ...rootThreadStarted,
            params: {
              thread: {
                ...rootThreadStarted.params.thread,
                id: REVIEW,
                sessionId: REVIEW,
                source: { subAgent: "review" },
              },
            },
          },
          ...agentMessage(REVIEW, "review-message", "review finding"),
          {
            ...collabToolCall,
            params: {
              ...collabToolCall.params,
              item: { ...collabToolCall.params.item, receiverThreadIds: [RECEIVER] },
            },
          },
          ...agentMessage(RECEIVER, "receiver-message", "receiver reply"),
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(scriptPath, { force: true })),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-announced"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const eventsFiber = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "review and delegate" });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      const parentEventsFor = (threadId: string) =>
        events
          .filter(
            (event) => (event.payload as { threadId?: string } | undefined)?.threadId === threadId,
          )
          .map((event) => `${event.method} ${event.turnId}`);

      assert.deepEqual(parentEventsFor(REVIEW), [
        `item/started ${REVIEW}-turn`,
        `item/agentMessage/delta ${REVIEW}-turn`,
        `item/completed ${REVIEW}-turn`,
      ]);
      // Receiver-map children are stamped with the parent turn that spawned them.
      const parentTurnId = (collabToolCall.params as { turnId: string }).turnId;
      assert.deepEqual(parentEventsFor(RECEIVER), [
        `item/started ${parentTurnId}`,
        `item/agentMessage/delta ${parentTurnId}`,
        `item/completed ${parentTurnId}`,
      ]);

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the newest receiver turn when a child's held tool call replays", () =>
    Effect.gen(function* () {
      // Child A names receiver R before A registers, so that tool call is
      // held. The root then names R in its own turn. Registering A replays
      // the old call, which must not point R back at A's older turn.
      const RECEIVER = "receiver-child-thread";
      const collabToolCall = wireFixture.notifications.find(
        (entry) =>
          entry.method === "item/started" &&
          (entry.params as { item?: { type?: string } }).item?.type === "collabAgentToolCall",
      );
      assert.isDefined(collabToolCall);
      const toolCall = (threadId: string, turnId: string) => ({
        ...collabToolCall,
        params: {
          ...collabToolCall.params,
          threadId,
          turnId,
          item: {
            ...collabToolCall.params.item,
            id: `${threadId}-call`,
            senderThreadId: threadId,
            receiverThreadIds: [RECEIVER],
          },
        },
      });
      const rootTurnId = wireFixture.responses.turnStart.turn.id;
      const script = {
        rootThreadId: ROOT,
        notifications: [
          toolCall(CHILD_A, `${CHILD_A}-older-turn`),
          toolCall(ROOT, rootTurnId),
          capturedStartedActivity(CHILD_A),
          ...agentMessage(RECEIVER, "receiver-message", "receiver reply"),
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(scriptPath, { force: true })),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-receiver-replay"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const eventsFiber = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "delegate twice" });
      const events = Array.from(yield* Fiber.join(eventsFiber));

      assert.deepEqual(
        events
          .filter(
            (event) => (event.payload as { threadId?: string } | undefined)?.threadId === RECEIVER,
          )
          .map((event) => `${event.method} ${event.turnId}`),
        [
          `item/started ${rootTurnId}`,
          `item/agentMessage/delta ${rootTurnId}`,
          `item/completed ${rootTurnId}`,
        ],
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("delivers the new root's output sent before a resume fallback opens it", () =>
    Effect.gen(function* () {
      // The stored cursor names a thread Codex no longer has, so the open
      // falls back to thread/start. Codex streams the new root's output before
      // answering, while the stale cursor is still the known root. The peer
      // answers only after the runtime looks up SYNC_CHILD, which it does once
      // everything before that registration has been routed.
      const STALE = "stale-root-thread";
      const SYNC_CHILD = "sync-child-thread";
      const script = {
        rootThreadId: ROOT,
        childResumeSnapshots: { [STALE]: { error: `thread not found: ${STALE}` } },
        threadStartNotifications: [
          ...agentMessage(ROOT, "early-root", "before the open response"),
          capturedStartedActivity(SYNC_CHILD),
        ],
        threadStartAfterResumeOf: SYNC_CHILD,
        notifications: agentMessage(ROOT, "later-root", "after the open response"),
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(scriptPath, { force: true })),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-resume-fallback"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        resumeCursor: { threadId: STALE },
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const eventsFiber = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );

      const session = yield* runtime.start();
      assert.deepEqual(session.resumeCursor, { threadId: ROOT });
      yield* runtime.sendTurn({ input: "continue" });
      const events = Array.from(yield* Fiber.join(eventsFiber));

      assert.deepEqual(
        events
          .filter((event) => event.method === "item/completed")
          .map((event) => String(event.itemId)),
        ["early-root", "later-root"],
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // it.live: the runtime talks to a real child process; under it.effect's
  // TestClock the internal timers freeze and the join never completes.
  it.live("Stop skips child turns that failed before the child registered", () =>
    Effect.gen(function* () {
      // Children A and B each start a turn and fail it while unregistered, so
      // their errors are held. A registers afterwards; B never does. Neither
      // failed turn may stay interruptible: an interrupt to a dead child can
      // stall Stop before it reaches the root.
      const failedTurn = (childId: string) => {
        const turnStarted = wireFixture.notifications.find(
          (entry) =>
            entry.method === "turn/started" &&
            (entry.params as { threadId?: string }).threadId === childId,
        );
        assert.isDefined(turnStarted);
        const turnId = (turnStarted.params as { turn: { id: string } }).turn.id;
        return [
          turnStarted,
          {
            method: "error",
            params: {
              threadId: childId,
              turnId,
              willRetry: false,
              error: { message: "child turn failed" },
            },
          },
        ];
      };
      const script = {
        rootThreadId: ROOT,
        holdTurnOpen: true,
        notifications: [
          ...failedTurn(CHILD_A),
          ...failedTurn(CHILD_B),
          capturedStartedActivity(CHILD_A),
          // Notifications are handled in order, so once this root message is
          // out, the registration and its replay have finished.
          ...agentMessage(ROOT, "root-marker", "registered"),
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      const interruptsPath = `${scriptPath}.interrupts`;
      NodeFS.rmSync(interruptsPath, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(interruptsPath, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-stop-failed-child"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const markerFiber = yield* runtime.events.pipe(
        Stream.filter(
          (event) => event.method === "item/completed" && event.itemId === "root-marker",
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "fan out" });
      const marker = yield* Fiber.join(markerFiber).pipe(Effect.timeoutOption("15 seconds"));
      assert.isTrue(marker._tag === "Some", "the root marker never arrived");

      yield* runtime.interruptTurn();

      const interruptedThreads = NodeFS.readFileSync(interruptsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { threadId?: string }).threadId);
      assert.deepEqual(interruptedThreads, [ROOT], "only the root turn is still live");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // it.live: the runtime talks to a real child process; under it.effect's
  // TestClock the internal timers freeze and the join never completes.
  it.live("Stop reaches a child's newer turn after its held error replays", () =>
    Effect.gen(function* () {
      // Child A fails turn 1, starts turn 2, then registers. The error is
      // held until registration; replaying it must not forget turn 2.
      const turnStartedA = wireFixture.notifications.find(
        (entry) =>
          entry.method === "turn/started" &&
          (entry.params as { threadId?: string }).threadId === CHILD_A,
      );
      assert.isDefined(turnStartedA);
      const newerTurnId = `${CHILD_A}-turn-2`;
      const script = {
        rootThreadId: ROOT,
        holdTurnOpen: true,
        notifications: [
          {
            method: "error",
            params: {
              threadId: CHILD_A,
              turnId: `${CHILD_A}-turn-1`,
              willRetry: false,
              error: { message: "child turn failed" },
            },
          },
          {
            ...turnStartedA,
            params: {
              ...turnStartedA.params,
              turn: { ...turnStartedA.params.turn, id: newerTurnId },
            },
          },
          capturedStartedActivity(CHILD_A),
          // Notifications are handled in order, so once this root message is
          // out, any replay triggered by the registration has finished.
          ...agentMessage(ROOT, "root-marker", "registered"),
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      const interruptsPath = `${scriptPath}.interrupts`;
      NodeFS.rmSync(interruptsPath, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(interruptsPath, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-stop-replayed-error"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });
      const markerFiber = yield* runtime.events.pipe(
        Stream.filter(
          (event) => event.method === "item/completed" && event.itemId === "root-marker",
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "fan out" });
      const marker = yield* Fiber.join(markerFiber).pipe(Effect.timeoutOption("15 seconds"));
      assert.isTrue(marker._tag === "Some", "the root marker never arrived");

      yield* runtime.interruptTurn();

      const interrupts = NodeFS.readFileSync(interruptsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { threadId?: string; turnId?: string });
      assert.include(
        interrupts.map((entry) => `${entry.threadId} ${entry.turnId}`),
        `${CHILD_A} ${newerTurnId}`,
        "child A's newer turn must be interrupted",
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // it.live: the runtime talks to a real child process; under it.effect's
  // TestClock the internal timers freeze and the join never completes.
  it.live("Stop interrupts every live child regardless of registration timing", () =>
    Effect.gen(function* () {
      // Ordering + liveness torture for stop-everything: child A's
      // turn/started arrives BEFORE anything registers it (foreign
      // suppression path must record the live turn); child B's arrives after
      // registration; child A's interrupt HANGS (RPC never settles — worse
      // than rejecting) and the bounded deadline must still deliver B's and
      // the parent's interrupts. The turn stays open so children are live
      // when Stop fires.
      // Build from REAL captured rows (hand-written shapes fail notification
      // schema validation and are silently dropped): reorder so child A's
      // turn/started precedes its registration, and drop terminal rows so
      // children stay live when Stop fires.
      const byIndex = wireFixture.notifications;
      const isTurnStarted = (entry: (typeof byIndex)[number], child: string) =>
        entry.method === "turn/started" &&
        (entry.params as { threadId?: string }).threadId === child;
      const isRegistration = (entry: (typeof byIndex)[number], child: string) => {
        const item = (entry.params as { item?: { type?: string; agentThreadId?: string } }).item;
        return item?.type === "subAgentActivity" && item.agentThreadId === child;
      };
      const turnStartedA = byIndex.find((entry) => isTurnStarted(entry, CHILD_A));
      const turnStartedB = byIndex.find((entry) => isTurnStarted(entry, CHILD_B));
      const registrationA = byIndex.find((entry) => isRegistration(entry, CHILD_A));
      const registrationB = byIndex.find((entry) => isRegistration(entry, CHILD_B));
      const rootThreadStarted = byIndex.find((entry) => entry.method === "thread/started");
      assert.isDefined(turnStartedA);
      assert.isDefined(turnStartedB);
      assert.isDefined(registrationA);
      assert.isDefined(registrationB);
      assert.isDefined(rootThreadStarted);
      const memoryThreadStarted = {
        ...rootThreadStarted,
        params: {
          thread: {
            ...rootThreadStarted.params.thread,
            id: MEMORY,
            sessionId: MEMORY,
            source: "unknown",
            threadSource: "memory_consolidation",
          },
        },
      };
      const memoryTurnStarted = {
        ...turnStartedA,
        params: {
          ...turnStartedA.params,
          threadId: MEMORY,
          turn: { ...turnStartedA.params.turn, id: "memory-consolidation-turn" },
        },
      };
      const script = {
        rootThreadId: ROOT,
        holdTurnOpen: true,
        hangInterruptFor: CHILD_A,
        notifications: [
          turnStartedA,
          registrationA,
          memoryThreadStarted,
          memoryTurnStarted,
          registrationB,
          turnStartedB,
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      const interruptsPath = `${scriptPath}.interrupts`;
      NodeFS.rmSync(interruptsPath, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(interruptsPath, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-collab-stop"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });

      // Wait for both children's turnStarted signals to be processed before
      // stopping (B via the registered-child path; A only produces live-turn
      // bookkeeping, so key on B's synthetic event).
      const childBStartedFiber = yield* runtime.events.pipe(
        Stream.filter(
          (event) =>
            event.method === "collabAgent/turnStarted" &&
            (event.payload as { agentThreadId?: string }).agentThreadId === CHILD_B,
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "fan out and hang" });
      const childBStarted = yield* Fiber.join(childBStartedFiber).pipe(
        Effect.timeoutOption("15 seconds"),
      );
      assert.isTrue(childBStarted._tag === "Some", "child B turnStarted never arrived");

      // Stop everything. A's interrupt hangs forever — the bounded child
      // deadline must expire and the parent interrupt must still be sent.
      yield* runtime.interruptTurn();

      const parseInterruptLine = (line: string) => JSON.parse(line) as { threadId?: string };
      const interrupted = NodeFS.readFileSync(interruptsPath, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map(parseInterruptLine);
      const interruptedThreads = new Set(interrupted.map((entry) => entry.threadId));
      assert.isTrue(
        interruptedThreads.has(CHILD_A),
        "pre-registration child A must still receive the interrupt RPC",
      );
      assert.isTrue(interruptedThreads.has(CHILD_B), "registered child B must be interrupted");
      assert.isTrue(
        interruptedThreads.has(MEMORY),
        "memory consolidation must be interrupted without appearing in chat",
      );
      assert.isTrue(interruptedThreads.has(ROOT), "parent turn must be interrupted last");

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  // it.live: the runtime talks to a real child process; under it.effect's
  // TestClock the internal timers freeze and the join never completes.
  it.live("Stop answers a parked app-permission approval with a withheld grant", () =>
    Effect.gen(function* () {
      // Interrupting a turn whose app-permission prompt is still parked must
      // settle that prompt: the handler resumes with "cancel", the peer gets
      // an empty grant (permission withheld), and nothing hangs until close.
      const script = {
        rootThreadId: ROOT,
        holdTurnOpen: true,
        notifications: [],
        serverRequests: [
          {
            method: "item/permissions/requestApproval",
            label: "perm-1",
            params: {
              cwd: "/tmp/project",
              itemId: "app_1",
              permissions: { network: { enabled: true } },
              reason: "Fetch data from api.example.com",
              startedAtMs: 1_778_000_000_000,
              threadId: "${threadId}",
              turnId: "${turnId}",
            },
          },
        ],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      const responsesPath = `${scriptPath}.approvalResponses`;
      NodeFS.rmSync(responsesPath, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(responsesPath, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-permission-stop"),
        binaryPath: peerPath,
        cwd: "/tmp",
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });

      // One consumer for the whole stream: `events` is a plain queue stream,
      // so two forks would compete for events and each could starve the
      // other's filter. Signal the two milestones through Deferreds instead.
      const requestedReady = yield* Deferred.make<ProviderEvent>();
      const settledReady = yield* Deferred.make<ProviderEvent>();
      yield* runtime.events.pipe(
        Stream.runForEach((event) => {
          if (event.method === "item/permissions/requestApproval") {
            return Deferred.succeed(requestedReady, event);
          }
          if (event.method === "serverRequest/resolved" && event.requestKind === "permission") {
            return Deferred.succeed(settledReady, event);
          }
          return Effect.void;
        }),
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "use the connected app" });
      const requested = yield* Deferred.await(requestedReady).pipe(
        Effect.timeoutOption("15 seconds"),
      );
      assert.isTrue(requested._tag === "Some", "permission approval request never arrived");

      yield* runtime.interruptTurn();

      // The peer emits serverRequest/resolved only AFTER recording the
      // runtime's answer, so awaiting this receipt makes reading the sidecar
      // race-free. The runtime correlates that receipt back to the canonical
      // request (requestKind + requestId) — the same event chain the adapter
      // folds into approval.resolved, so the card actually closes.
      const settled = yield* Deferred.await(settledReady).pipe(Effect.timeoutOption("15 seconds"));
      assert.isTrue(settled._tag === "Some", "interrupt did not settle the parked approval");
      const settledEvent = settled._tag === "Some" ? settled.value : undefined;
      assert.isDefined(settledEvent);
      assert.isDefined(
        settledEvent?.requestId,
        "receipt must correlate back to the canonical approval request",
      );

      const recorded = NodeFS.readFileSync(responsesPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { id: number; label: string; result: unknown });
      assert.equal(recorded.length, 1);
      const answer = recorded[0];
      assert.isDefined(answer);
      assert.equal(answer.label, "perm-1");
      // Cancelled approvals withhold the grant: an empty permission profile.
      assert.deepEqual(answer.result, { permissions: {} });

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("Stop targets the active turn when Codex has accepted a queued follow-up", () =>
    Effect.gen(function* () {
      const activeTurnId = "019fe3e8-f908-7f31-8d51-283f4a47897a";
      const queuedTurnId = "019fe3eb-8faf-7de3-a85b-ac64c7f9c8c3";
      const script = {
        rootThreadId: ROOT,
        holdTurnOpen: true,
        onlyFirstTurnStarts: true,
        turnIds: [activeTurnId, queuedTurnId],
        expectedActiveTurnId: activeTurnId,
        notifications: [],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      const interruptsPath = `${scriptPath}.interrupts`;
      NodeFS.rmSync(interruptsPath, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(interruptsPath, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-queued-stop"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
      });

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "keep working" });
      yield* runtime.sendTurn({ input: "queued follow-up" });
      yield* runtime.interruptTurn();

      const interrupts = NodeFS.readFileSync(interruptsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { threadId?: string; turnId?: string });
      assert.deepEqual(interrupts.at(-1), {
        threadId: ROOT,
        turnId: activeTurnId,
      });

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  const elicitationCases = [
    {
      decision: "accept",
      response: { action: "accept", content: { approval: "once" } },
    },
    {
      decision: "acceptForSession",
      response: {
        action: "accept",
        _meta: { persist: "session" },
        content: { approval: "session" },
      },
    },
    {
      decision: "acceptAlways",
      response: {
        action: "accept",
        _meta: { persist: "always" },
        content: { approval: "always" },
      },
    },
    { decision: "decline", response: { action: "decline" } },
    { decision: "cancel", response: { action: "cancel" } },
  ] satisfies ReadonlyArray<{
    readonly decision: ProviderApprovalDecision;
    readonly response: Record<string, unknown>;
  }>;

  for (const { decision, response } of elicitationCases) {
    it.live(`returns the MCP elicitation ${decision} response to Codex`, () =>
      Effect.gen(function* () {
        const scriptedRequest = {
          id: 7001,
          method: "mcpServer/elicitation/request",
          params: {
            mode: "form",
            message: "Allow ChatGPT to use Safari?",
            serverName: "computer-use",
            threadId: ROOT,
            turnId: wireFixture.responses.turnStart.turn.id,
            _meta: { app_name: "Safari", persist: ["session", "always"] },
            requestedSchema: {
              type: "object",
              properties: {
                approval: {
                  type: "string",
                  enum: ["once", "session", "always"],
                },
              },
              required: ["approval"],
            },
          },
        };
        const script = {
          rootThreadId: ROOT,
          holdTurnOpen: true,
          completeTurnOnServerResponse: true,
          notifications: [],
          serverRequests: [scriptedRequest],
        };
        const responsesPath = `${scriptPath}.responses`;
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
        NodeFS.rmSync(responsesPath, { force: true });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            NodeFS.rmSync(scriptPath, { force: true });
            NodeFS.rmSync(responsesPath, { force: true });
          }),
        );

        const runtime = yield* makeCodexSessionRuntime({
          threadId: ThreadId.make("thread-codex-mcp-elicitation"),
          binaryPath: peerPath,
          cwd: NodeOS.tmpdir(),
          runtimeMode: "auto",
          environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
        });
        const approvalRequested = yield* Deferred.make<ProviderEvent>();
        const turnCompleted = yield* Deferred.make<void>();
        yield* runtime.events.pipe(
          Stream.runForEach((event) =>
            event.method === "mcpServer/elicitation/request"
              ? Deferred.succeed(approvalRequested, event).pipe(Effect.asVoid)
              : event.method === "turn/completed"
                ? Deferred.succeed(turnCompleted, undefined).pipe(Effect.asVoid)
                : Effect.void,
          ),
          Effect.forkScoped,
        );

        yield* runtime.start();
        yield* runtime.sendTurn({ input: "Open Safari" });
        const approval = yield* Deferred.await(approvalRequested);
        assert.equal(approval.requestKind, "mcp-elicitation");
        assert.isDefined(approval.requestId);
        if (approval.requestId === undefined) return;

        yield* runtime.respondToRequest(approval.requestId, decision);
        yield* Deferred.await(turnCompleted);

        const recordedResponse = yield* decodeMcpElicitationResponse(
          NodeFS.readFileSync(responsesPath, "utf8"),
        );
        assert.equal(recordedResponse.id, scriptedRequest.id);
        assert.deepEqual(recordedResponse.result, response);

        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }
});

describe("CodexSessionRuntime compaction", () => {
  it.effect("restores T3 context after the root thread compacts", () =>
    Effect.gen(function* () {
      const compacted = (threadId: string) => ({
        method: "item/completed",
        params: {
          threadId,
          turnId: `${threadId}-turn`,
          completedAtMs: 0,
          item: { type: "contextCompaction", id: `compaction-${threadId}` },
        },
      });
      const script = {
        rootThreadId: ROOT,
        recordRequests: true,
        // A child's compaction must not inject into the root thread.
        notifications: [compacted(CHILD_A), compacted(ROOT)],
      };
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      NodeFS.writeFileSync(scriptPath, JSON.stringify(script), "utf8");
      NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          NodeFS.rmSync(scriptPath, { force: true });
          NodeFS.rmSync(`${scriptPath}.requests`, { force: true });
        }),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-compaction-context"),
        binaryPath: peerPath,
        cwd: NodeOS.tmpdir(),
        runtimeMode: "full-access",
        environment: { ...process.env, T3_CODEX_COLLAB_SCRIPT: scriptPath },
        models: Effect.succeed([
          { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", isCustom: false, capabilities: null },
        ]),
      });
      const completedFiber = yield* runtime.events.pipe(
        Stream.filter((event) => event.method === "turn/completed"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({ input: "keep going", interactionMode: "default" });
      yield* Fiber.join(completedFiber);

      // The restore is awaited before later notifications, so it has landed.
      const requests = readRecordedRequests();
      assert.lengthOf(requests, 1);
      const [inject] = requests;
      assert.isDefined(inject);
      assert.equal(inject.method, "thread/inject_items");
      assert.equal(inject.params.threadId, ROOT);
      const texts = (
        inject.params.items as ReadonlyArray<{ role: string; content: [{ text: string }] }>
      ).map((item) => {
        assert.equal(item.role, "developer");
        return item.content[0].text;
      });
      assert.lengthOf(texts, 1);
      assert.match(
        texts[0] ?? "",
        /^<t3_code_runtime><runtime_info>.*as GPT-5\.6 Sol \(model slug: gpt-5\.6-sol\).*<\/t3_code_runtime>$/s,
      );

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
