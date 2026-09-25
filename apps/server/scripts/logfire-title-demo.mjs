import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

const root = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));
const connection = await NodeFSP.readFile(`${root}.t3/title-demo.json`, "utf8")
  .then(JSON.parse)
  .catch(() => ({}));
const origin = process.env.T3_DEMO_ORIGIN ?? connection.origin;
if (!origin) throw new Error("Start node demos/logfire-titles/start.mjs first.");
const { token } = JSON.parse(
  NodeChildProcess.execFileSync(
    "node",
    [
      "apps/server/src/bin.ts",
      "auth",
      "session",
      "issue",
      "--base-dir",
      `${root}.t3`,
      "--ttl",
      "2h",
      "--label",
      "Title demo",
      "--json",
    ],
    { cwd: root, encoding: "utf8" },
  ),
);
const request = async (route, body) => {
  const response = await fetch(`${origin}${route}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
};
const dispatch = (command) =>
  request("/api/orchestration/dispatch", { commandId: NodeCrypto.randomUUID(), ...command });
const corpus = JSON.parse(
  await NodeFSP.readFile(`${root}demos/logfire-titles/corpus.json`, "utf8"),
);
const [action, caseId, suppliedRequestId] = process.argv.slice(2);

const protocol = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(
    Socket.layerWebSocket(`${origin.replace(/^http/, "ws")}/ws?orchestrationProtocol=1`).pipe(
      Layer.provide(
        Layer.succeed(
          Socket.WebSocketConstructor,
          (url, protocols) =>
            new NodeSocket.NodeWS.WebSocket(url, protocols, {
              headers: { authorization: `Bearer ${token}` },
            }),
        ),
      ),
    ),
  ),
  Layer.provide(RpcSerialization.layerJson),
);

if (action === "reset") {
  for (const item of corpus) {
    await dispatch({
      type: "thread.meta.update",
      threadId: `logfire-title-${item.id}`,
      title: item.baseline_title ?? item.previous_title,
    });
    await dispatch({
      type: "thread.unsettle",
      threadId: `logfire-title-${item.id}`,
      reason: "user",
    });
  }
  console.log(JSON.stringify({ reset: corpus.length }));
} else if (action === "snapshot") {
  const shell = await request("/api/orchestration/shell");
  console.log(
    JSON.stringify(shell.threads.filter((thread) => thread.projectId === "logfire-title-demo")),
  );
} else if (action === "investigate") {
  const runDirectory = `${root}.t3/title-evals`;
  const runs = await Promise.all(
    (await NodeFSP.readdir(runDirectory)).map(async (name) => {
      try {
        return JSON.parse(await NodeFSP.readFile(`${runDirectory}/${name}/results.json`, "utf8"));
      } catch {
        return undefined;
      }
    }),
  );
  const latestRun = runs
    .filter((run) => run?.source_sha256 && run.total === corpus.length && run.task_errors === 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latestRun)
    throw new Error("Run uv run demos/logfire-titles/evaluate.py --name baseline first.");
  const threadId = NodeCrypto.randomUUID();
  const prompt =
    (await NodeFSP.readFile(`${root}demos/logfire-titles/investigate.md`, "utf8")) +
    `\n\nThis run's T3_DEMO_ORIGIN=${origin}. Logfire project: ${process.env.T3_DEMO_LOGFIRE_PROJECT ?? "use the authenticated project"}. Dataset: T3 title pipeline. Baseline: ${latestRun.run_id}, beginning ${latestRun.created_at}. Baseline evaluation: ${latestRun.eval_url}. Candidate run name: repair-${threadId.slice(0, 8)}.`;
  // Keep the investigator on the installed T3 host: editing demo server code
  // restarts this development server and would otherwise kill its own agent.
  console.log(
    prompt +
      "\n\nWorkspace: " +
      root +
      "\nRun this investigation in a fresh Astra Medium thread on your regular T3 Code host, with this checkout open. Keep the demo web app beside it; the demo server may restart during a code fix.",
  );
} else if (action === "wait") {
  const threadId = caseId;
  if (!threadId) throw new Error("Use wait <investigator-thread-id>");
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(WsRpcGroup);
        yield* client["orchestration.subscribeShell"]({}).pipe(
          Stream.filter((item) => {
            const thread =
              item.kind === "snapshot"
                ? item.snapshot.threads.find((t) => t.id === threadId)
                : item.kind === "thread-upserted"
                  ? item.thread
                  : undefined;
            return (
              thread?.id === threadId && thread.latestTurn && thread.latestTurn.state !== "running"
            );
          }),
          Stream.take(1),
          Stream.runDrain,
        );
      }).pipe(Effect.provide(protocol), Effect.timeout("15 minutes")),
    ),
  );
  const { thread } = await request(`/api/orchestration/threads/${threadId}`);
  console.log(
    JSON.stringify({
      thread_id: threadId,
      state: thread.latestTurn.state,
      messages: thread.messages.filter((m) => m.role === "assistant").map((m) => m.text),
    }),
  );
} else if (action === "generate") {
  const item = corpus.find((item) => item.id === caseId);
  if (!item) throw new Error(`Unknown corpus case ${caseId}`);
  const threadId = `logfire-title-${item.id}`;
  const requestId = suppliedRequestId ?? NodeCrypto.randomUUID();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))
    throw new Error("Request ID must be a UUID.");
  await dispatch({ type: "thread.meta.update", threadId, title: item.previous_title });
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(WsRpcGroup);
        const ready = yield* Deferred.make();

        const stream = client["orchestration.subscribeShell"]({
          requestCompletionMarker: true,
        }).pipe(
          Stream.tap((item) =>
            item.kind === "synchronized" ? Deferred.succeed(ready, undefined) : Effect.void,
          ),
          Stream.filter(
            (item) =>
              item.kind === "thread-upserted" &&
              item.thread.id === threadId &&
              item.thread.titleState?.version === requestId &&
              item.thread.titleRegeneration === null,
          ),
          Stream.take(1),
          Stream.runCollect,
        );
        const completion = yield* stream.pipe(Effect.forkScoped);
        yield* Deferred.await(ready);
        yield* client["orchestration.dispatchCommand"]({
          type: "thread.meta.update",
          threadId,
          regenerateTitle: true,
          commandId: requestId,
        });
        yield* Fiber.join(completion);
        return yield* Effect.tryPromise(() => request(`/api/orchestration/threads/${threadId}`));
      }).pipe(Effect.provide(protocol), Effect.timeout("3 minutes")),
    ),
  );
  console.log(
    JSON.stringify({
      case_id: caseId,
      thread_id: threadId,
      request_id: requestId,
      title: result.thread.title,
    }),
  );
} else {
  throw new Error("Use reset, snapshot, investigate, wait <thread-id>, or generate <case-id>.");
}
