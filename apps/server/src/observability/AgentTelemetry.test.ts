import { assert, describe, it } from "@effect/vitest";
import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

import { AgentTelemetryRecorder } from "./AgentTelemetry.ts";

const THREAD = "thread-1";
const TURN = "turn-1";

function makeRecorder(captureContent = true) {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const recorder = new AgentTelemetryRecorder({
    tracer,
    captureContent,
    staticAttributes: { "host.name": "test-host" },
    nowMs: () => Date.parse("2026-01-01T00:10:00.000Z"),
  });
  const real = () =>
    spans.filter((span) => span.attributes.get("logfire.span_type") !== "pending_span");
  const named = (prefix: string) => real().filter((span) => span.name.startsWith(prefix));
  return { recorder, spans, real, named };
}

let seq = 0;
function event(
  type: string,
  second: number,
  fields: Record<string, unknown> = {},
): ProviderRuntimeEvent {
  seq += 1;
  return {
    eventId: `event-${seq}`,
    provider: "claudeAgent",
    threadId: THREAD,
    turnId: TURN,
    createdAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + second * 1000).toISOString(),
    type,
    ...fields,
  } as unknown as ProviderRuntimeEvent;
}

const claudeUsage = (second: number, input: number, output: number, stopReason: string) =>
  event("thread.token-usage.updated", second, {
    payload: { usage: { usedTokens: input + output } },
    raw: {
      source: "claude.sdk.message",
      method: "claude/stream_event/message_delta",
      payload: {
        type: "stream_event",
        event: {
          type: "message_delta",
          delta: { stop_reason: stopReason },
          usage: {
            input_tokens: input,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 10,
            output_tokens: output,
          },
        },
      },
    },
  });

const bashTool = (
  lifecycle: "item.started" | "item.completed",
  second: number,
  id: string,
  options: { command: string; result?: string; isError?: boolean; status?: string },
) =>
  event(lifecycle, second, {
    itemId: id,
    payload: {
      itemType: "command_execution",
      status: options.status ?? (lifecycle === "item.started" ? "inProgress" : "completed"),
      title: "Command",
      data: {
        toolName: "Bash",
        input: { command: options.command },
        ...(options.result !== undefined
          ? {
              result: {
                type: "tool_result",
                tool_use_id: id,
                content: options.result,
                is_error: options.isError === true,
              },
            }
          : {}),
      },
    },
  });

const endExit = (span: Tracer.NativeSpan) => {
  assert.strictEqual(span.status._tag, "Ended");
  return (span.status as Extract<Tracer.SpanStatus, { _tag: "Ended" }>).exit;
};

describe("AgentTelemetryRecorder", () => {
  it("records a Claude turn as agent, chat, and tool spans", () => {
    const { recorder, spans, named } = makeRecorder();
    recorder.noteTurnInput({
      threadId: THREAD,
      text: "Fix the failing test",
      attachmentCount: 0,
      model: "claude-sonnet-5",
      link: undefined,
    });
    recorder.handle(event("turn.started", 0, { payload: {} }));
    recorder.handle(
      event("content.delta", 1, {
        itemId: "text-1",
        payload: { streamKind: "assistant_text", delta: "Running the tests." },
      }),
    );
    recorder.handle(
      event("item.completed", 2, {
        itemId: "text-1",
        payload: { itemType: "assistant_message", status: "completed" },
      }),
    );
    recorder.handle(bashTool("item.started", 2, "tool-1", { command: "npm test" }));
    recorder.handle(claudeUsage(3, 5, 40, "tool_use"));
    recorder.handle(
      bashTool("item.completed", 6, "tool-1", {
        command: "npm test",
        result: "1 failing",
        isError: true,
        status: "failed",
      }),
    );
    recorder.handle(
      event("item.completed", 8, {
        itemId: "text-2",
        payload: { itemType: "assistant_message", status: "completed", detail: "Fixed it." },
      }),
    );
    recorder.handle(claudeUsage(9, 7, 20, "end_turn"));
    recorder.handle(
      event("turn.completed", 10, {
        payload: {
          state: "completed",
          totalCostUsd: 0.12,
          tokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 232,
            outputTokens: 60,
            hasSubagents: false,
          },
        },
      }),
    );

    const [agent] = named("invoke_agent");
    assert.isDefined(agent);
    assert.strictEqual(agent!.attributes.get("gen_ai.agent.name"), "T3 Code / Claude");
    assert.strictEqual(agent!.attributes.get("gen_ai.request.model"), "claude-sonnet-5");
    assert.strictEqual(agent!.attributes.get("gen_ai.conversation.id"), THREAD);
    assert.strictEqual(agent!.attributes.get("t3.agent.model_requests"), 2);
    assert.strictEqual(agent!.attributes.get("t3.agent.tool_calling_requests"), 1);
    assert.strictEqual(agent!.attributes.get("t3.agent.tool_calls"), 1);
    assert.strictEqual(agent!.attributes.get("t3.agent.failed_tool_calls"), 1);
    assert.strictEqual(agent!.attributes.get("final_result"), "Fixed it.");
    assert.isTrue(Exit.isSuccess(endExit(agent!)));

    const chats = named("chat ");
    assert.strictEqual(chats.length, 2);
    // Input counts cache reads and writes, like Pydantic AI.
    assert.strictEqual(chats[0]!.attributes.get("gen_ai.usage.input_tokens"), 115);
    assert.strictEqual(chats[0]!.attributes.get("gen_ai.usage.cache_read.input_tokens"), 100);
    assert.deepStrictEqual(chats[0]!.attributes.get("gen_ai.response.finish_reasons"), [
      "tool_use",
    ]);
    assert.strictEqual(chats[0]!.attributes.get("t3.genai.chat.start_source"), "turn_start");
    assert.strictEqual(chats[1]!.attributes.get("t3.genai.chat.start_source"), "tool_result");
    // The second response starts once the tool result is back.
    assert.strictEqual(
      chats[1]!.startTime,
      BigInt(Date.parse("2026-01-01T00:00:06.000Z")) * 1_000_000n,
    );
    const firstOutput = JSON.parse(chats[0]!.attributes.get("gen_ai.output.messages") as string);
    assert.deepStrictEqual(
      firstOutput[0].parts.map((part: { type: string }) => part.type),
      ["text", "tool_call"],
    );
    const secondInput = JSON.parse(chats[1]!.attributes.get("gen_ai.input.messages") as string);
    assert.strictEqual(secondInput[0].parts[0].type, "tool_call_response");
    assert.strictEqual(secondInput[0].parts[0].result, "1 failing");

    const [tool] = named("execute_tool");
    assert.strictEqual(tool!.attributes.get("gen_ai.tool.name"), "Bash");
    assert.strictEqual(
      tool!.attributes.get("gen_ai.tool.call.arguments"),
      '{"command":"npm test"}',
    );
    assert.strictEqual(Option.getOrUndefined(tool!.parent)?.spanId, agent!.spanId);
    assert.isTrue(Exit.isFailure(endExit(tool!)));

    // Agent and tool each get a pending twin so they show while running.
    const pending = spans.filter(
      (span) => span.attributes.get("logfire.span_type") === "pending_span",
    );
    assert.strictEqual(pending.length, 2);
    assert.strictEqual(Option.getOrUndefined(pending[0]!.parent)?.spanId, agent!.spanId);
    assert.strictEqual(pending[0]!.attributes.get("logfire.pending_parent_id"), "0000000000000000");
    assert.strictEqual(recorder.openRunCount, 0);
  });

  it("counts repeated Codex usage snapshots once", () => {
    const { recorder, named } = makeRecorder();
    const codex = (type: string, second: number, fields: Record<string, unknown> = {}) =>
      ({ ...event(type, second, fields), provider: "codex" }) as ProviderRuntimeEvent;
    const usage = (second: number, total: number) =>
      codex("thread.token-usage.updated", second, {
        payload: { usage: { usedTokens: total } },
        raw: {
          source: "codex.app-server.notification",
          method: "thread/tokenUsage/updated",
          payload: {
            tokenUsage: {
              total: { inputTokens: total, outputTokens: 10 },
              last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 },
            },
          },
        },
      });
    recorder.handle(codex("turn.started", 0, { payload: {} }));
    recorder.handle(usage(1, 100));
    recorder.handle(usage(2, 100));
    recorder.handle(usage(3, 200));
    recorder.handle(codex("turn.completed", 4, { payload: { state: "completed" } }));

    assert.strictEqual(named("chat ").length, 2);
    const [agent] = named("invoke_agent");
    assert.strictEqual(agent!.attributes.get("gen_ai.agent.name"), "T3 Code / Codex");
    assert.strictEqual(agent!.attributes.get("t3.usage.status"), "summed_from_responses");
    assert.strictEqual(agent!.attributes.get("gen_ai.aggregated_usage.input_tokens"), 200);
  });

  it("ends unfinished tools and the run as interrupted when a turn aborts", () => {
    const { recorder, named } = makeRecorder();
    recorder.handle(event("turn.started", 0, { payload: {} }));
    recorder.handle(bashTool("item.started", 1, "tool-1", { command: "sleep 100" }));
    recorder.handle(event("turn.aborted", 5, { payload: { reason: "User interrupted" } }));

    const [tool] = named("execute_tool");
    const [agent] = named("invoke_agent");
    assert.strictEqual(tool!.attributes.get("t3.tool.status"), "unfinished");
    assert.isTrue(
      Cause.hasInterruptsOnly((endExit(tool!) as Exit.Failure<unknown, unknown>).cause),
    );
    assert.isTrue(
      Cause.hasInterruptsOnly((endExit(agent!) as Exit.Failure<unknown, unknown>).cause),
    );
    assert.strictEqual(agent!.attributes.get("t3.turn.state"), "interrupted");
  });

  it("marks a failed turn as an error with the provider's message", () => {
    const { recorder, named } = makeRecorder();
    recorder.handle(event("turn.started", 0, { payload: {} }));
    recorder.handle(
      event("turn.completed", 2, { payload: { state: "failed", errorMessage: "Overloaded" } }),
    );
    const exit = endExit(named("invoke_agent")[0]!);
    assert.isTrue(Exit.isFailure(exit));
    assert.include(Cause.pretty((exit as Exit.Failure<unknown, unknown>).cause), "Overloaded");
  });

  it("omits message and tool content unless capture is enabled", () => {
    const { recorder, real } = makeRecorder(false);
    recorder.noteTurnInput({
      threadId: THREAD,
      text: "secret plan",
      attachmentCount: 0,
      model: undefined,
      link: undefined,
    });
    recorder.handle(event("turn.started", 0, { payload: {} }));
    recorder.handle(bashTool("item.started", 1, "tool-1", { command: "cat .env" }));
    recorder.handle(
      bashTool("item.completed", 2, "tool-1", { command: "cat .env", result: "X=1" }),
    );
    recorder.handle(claudeUsage(3, 1, 1, "end_turn"));
    recorder.handle(event("turn.completed", 4, { payload: { state: "completed" } }));

    for (const span of real()) {
      for (const key of [
        "gen_ai.input.messages",
        "gen_ai.output.messages",
        "gen_ai.tool.call.arguments",
        "gen_ai.tool.call.result",
        "final_result",
      ]) {
        assert.isFalse(span.attributes.has(key), `${span.name} carried ${key}`);
      }
    }
  });

  it("scrubs sensitive argument keys", () => {
    const { recorder, named } = makeRecorder();
    recorder.handle(event("turn.started", 0, { payload: {} }));
    recorder.handle(
      event("item.completed", 1, {
        itemId: "mcp-1",
        payload: {
          itemType: "mcp_tool_call",
          status: "completed",
          data: { toolName: "deploy", input: { api_key: "sk-live-123", region: "us" } },
        },
      }),
    );
    const args = JSON.parse(
      named("execute_tool")[0]!.attributes.get("gen_ai.tool.call.arguments") as string,
    );
    assert.strictEqual(args.region, "us");
    assert.notInclude(args.api_key, "sk-live");
  });

  it("ignores events for turns it never saw start and duplicate starts", () => {
    const { recorder, named } = makeRecorder();
    recorder.handle(bashTool("item.started", 1, "tool-1", { command: "ls" }));
    recorder.handle(event("turn.started", 2, { payload: {} }));
    recorder.handle(event("turn.started", 3, { payload: {} }));
    recorder.handle(event("turn.completed", 4, { payload: { state: "completed" } }));
    assert.strictEqual(named("invoke_agent").length, 1);
    assert.strictEqual(named("execute_tool").length, 0);
  });

  it("closes open runs on shutdown", () => {
    const { recorder, named } = makeRecorder();
    recorder.handle(event("turn.started", 0, { payload: {} }));
    recorder.closeAll("shutdown");
    assert.strictEqual(recorder.openRunCount, 0);
    assert.strictEqual(named("invoke_agent")[0]!.status._tag, "Ended");
  });
});
