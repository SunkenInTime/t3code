import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type * as Tracer from "effect/Tracer";

// Only the supplied prompt and structured final response are captured, never CLI
// stdout/stderr, environment variables, or provider reasoning events.
function redact(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,})\b/g, "[redacted]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|authorization)\s*[=:]\s*["']?)([^\s"',;}]+)/gi,
      "$1[redacted]",
    );
}

/** An explicit exporter span because this demo disables the runtime tracer. */
export function startThreadTitleTelemetry(input: {
  tracer: Tracer.Tracer | undefined;
  captureContent: boolean;
  model: string;
  nowMs: () => number;
  prompt: string;
  threadId?: string | undefined;
  requestId?: string | undefined;
}) {
  let span: Tracer.Span | undefined;
  const start = input.nowMs();
  const safely = (work: () => void) => {
    try {
      work();
    } catch {
      /* Telemetry must not change generation behavior. */
    }
  };
  safely(() => {
    span = input.tracer?.span({
      name: "generate thread title",
      parent: Option.none(),
      annotations: Context.empty(),
      links: [],
      startTime: BigInt(start) * 1_000_000n,
      kind: "client",
      root: true,
      sampled: true,
    });
    if (!span) return;
    span.attribute("logfire.msg", "generate thread title");
    span.attribute("gen_ai.operation.name", "chat");
    span.attribute("gen_ai.provider.name", "openai");
    span.attribute("gen_ai.request.model", input.model);
    span.attribute(
      "t3.title.prompt_sha256",
      NodeCrypto.createHash("sha256").update(input.prompt).digest("hex"),
    );
    if (input.threadId) {
      span.attribute("t3.thread.id", input.threadId);
      span.attribute("gen_ai.conversation.id", input.threadId);
    }
    if (input.requestId) span.attribute("t3.request.id", input.requestId);
    if (input.captureContent)
      span.attribute("gen_ai.input.messages", [
        { role: "user", parts: [{ type: "text", content: redact(input.prompt) }] },
      ]);
  });
  return {
    rawOutput: (raw: string) =>
      safely(() => {
        if (!input.captureContent) return;
        span?.attribute("t3.title.raw_output", redact(raw));
        span?.attribute("gen_ai.output.messages", [
          { role: "assistant", parts: [{ type: "text", content: redact(raw) }] },
        ]);
      }),
    finish: (result: { title: string } | undefined) =>
      safely(() => {
        if (result && input.captureContent) span?.attribute("t3.title.final", redact(result.title));
        span?.attribute("t3.title.duration_ms", input.nowMs() - start);
        span?.attribute("t3.title.succeeded", result !== undefined);
        if (!result) span?.attribute("error.type", "ThreadTitleGenerationError");
        span?.end(
          BigInt(input.nowMs()) * 1_000_000n,
          result ? Exit.void : Exit.fail("Thread title generation failed"),
        );
      }),
  };
}
