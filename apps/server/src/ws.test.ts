import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as ThreadManagementService from "./orchestration-v2/ThreadManagementService.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as ProjectEnrichmentService from "./project/ProjectEnrichmentService.ts";
import * as OrchestrationEventStore from "./persistence/Services/OrchestrationEventStore.ts";
import { assert, it } from "@effect/vitest";
import { ORCHESTRATION_PROTOCOL_VERSION, ProjectId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import {
  hasCompatibleOrchestrationProtocol,
  resolveAvailableEditorsForConfig,
  shouldUseBoundedThreadSnapshot,
  subscribeOrchestrationV2Shell,
} from "./ws.ts";

it("accepts only the current orchestration protocol before websocket RPC setup", () => {
  assert.isTrue(
    hasCompatibleOrchestrationProtocol(
      new URL(`https://host.test/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}`),
    ),
  );
  assert.isFalse(hasCompatibleOrchestrationProtocol(new URL("https://host.test/ws")));
  assert.isFalse(
    hasCompatibleOrchestrationProtocol(
      new URL(`https://host.test/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION - 1}`),
    ),
  );
});

it("keeps full thread snapshot fallback unless the client opts into bounded history", () => {
  assert.isFalse(shouldUseBoundedThreadSnapshot({}));
  assert.isFalse(shouldUseBoundedThreadSnapshot({ acceptBoundedSnapshot: false }));
  assert.isTrue(shouldUseBoundedThreadSnapshot({ acceptBoundedSnapshot: true }));
});

it.effect("does not block server config when editor discovery never resolves", () =>
  Effect.gen(function* () {
    const discoveryInterrupted = yield* Deferred.make<void>();
    const responseFiber = yield* resolveAvailableEditorsForConfig(
      Effect.never.pipe(
        Effect.onInterrupt(() => Deferred.succeed(discoveryInterrupted, undefined)),
      ),
    ).pipe(Effect.forkChild);

    yield* TestClock.adjust(Duration.seconds(5));

    const availableEditors = yield* Fiber.join(responseFiber);
    yield* Deferred.await(discoveryInterrupted);
    assert.deepEqual(availableEditors, []);
  }),
);

it.effect(
  "enrichment refreshes reuse changed identities without re-requesting project metadata",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const changes = yield* PubSub.unbounded<ProjectEnrichmentService.ProjectEnrichmentChange>();
        const synchronized = yield* Deferred.make<void>();
        const requestedRoots: string[] = [];
        const projects = ["changed", "unchanged"].map((name) => ({
          id: ProjectId.make(name),
          title: name,
          workspaceRoot: `/workspace/${name}`,
          defaultModelSelection: null,
          scripts: [],
          repositoryIdentity: null,
          createdAt: "2026-10-02T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
        }));
        const identity = {
          canonicalKey: "github.com/example/changed",
          locator: {
            source: "git-remote" as const,
            remoteName: "origin",
            remoteUrl: "https://github.com/example/changed.git",
          },
        };
        const layer = Layer.mergeAll(
          NodeSqliteClient.layer({ filename: ":memory:" }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
          Layer.mock(ProjectService.ProjectService)({}),
          Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed(projects) }),
          Layer.mock(OrchestrationEventStore.OrchestrationEventStore)({
            latestApplicationSequence: Effect.succeed(7),
            getReplayStats: () => Effect.succeed({ eventCount: 0, rawPayloadBytes: 0 }),
            readApplicationEvents: () => Stream.empty,
            streamProjectedApplicationEvents: () => Stream.never,
          }),
          Layer.mock(ProjectEnrichmentService.ProjectEnrichmentService)({
            subscribeChanges: PubSub.subscribe(changes),
            getAvailable: (root) =>
              Effect.sync(() => {
                requestedRoots.push(root);
                return {
                  repositoryIdentity: null,
                  faviconPath: null,
                  repositoryIdentityResolved: false,
                };
              }),
          }),
        );
        const result = yield* subscribeOrchestrationV2Shell({
          afterSequence: 7,
          requestCompletionMarker: true,
        }).pipe(
          Effect.flatMap((stream) =>
            stream.pipe(
              Stream.tap((item) =>
                item.kind === "synchronized"
                  ? Deferred.succeed(synchronized, undefined)
                  : Effect.void,
              ),
              Stream.take(2),
              Stream.runCollect,
            ),
          ),
          Effect.provide(layer),
          Effect.forkChild,
        );
        yield* Deferred.await(synchronized);
        assert.sameMembers(
          requestedRoots,
          projects.map((project) => project.workspaceRoot),
        );
        // Fill the coalescing batch so this proof does not depend on a timer.
        for (let index = 0; index < 64; index++) {
          yield* PubSub.publish(changes, {
            workspaceRoot: projects[0]!.workspaceRoot,
            repositoryIdentityResolved: true,
            enrichment: {
              repositoryIdentity: identity,
              faviconPath: null,
              repositoryIdentityResolved: true,
            },
          });
        }
        const items = yield* Fiber.join(result);
        const refresh = items.find((item) => item.kind === "snapshot");
        assert.deepEqual(refresh?.snapshot.projects, [
          { ...projects[0]!, repositoryIdentity: identity },
        ]);
        assert.lengthOf(requestedRoots, 2);
      }),
    ),
);
