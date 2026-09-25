import { describe, expect, it } from "vite-plus/test";
import * as Tracer from "effect/Tracer";
import { startThreadTitleTelemetry } from "./ThreadTitleTelemetry.ts";

describe("thread title telemetry", () => {
  function setup(captureContent: boolean) {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const recorder = startThreadTitleTelemetry({
      tracer,
      captureContent,
      nowMs: () => 1000,
      model: "gpt-6-luna",
      prompt: "Title this conversation",
      threadId: "thread-1",
      requestId: "request-1",
    });
    return { recorder, spans };
  }
  it("correlates raw and final output in an ended span", () => {
    const { recorder, spans } = setup(true);
    recorder.rawOutput('{"title":"  Fix reconnects  "}');
    recorder.finish({ title: "Fix reconnects" });
    const span = spans[0]!;
    expect(span.attributes.get("t3.thread.id")).toBe("thread-1");
    expect(span.attributes.get("t3.request.id")).toBe("request-1");
    expect(span.attributes.get("t3.title.raw_output")).toBe('{"title":"  Fix reconnects  "}');
    expect(span.attributes.get("t3.title.final")).toBe("Fix reconnects");
    expect(span.attributes.get("t3.title.prompt_sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(span.status._tag).toBe("Ended");
  });
  it("records failure without content when capture is disabled", () => {
    const { recorder, spans } = setup(false);
    recorder.rawOutput("sensitive response");
    recorder.finish(undefined);
    const span = spans[0]!;
    expect(span.attributes.get("t3.title.succeeded")).toBe(false);
    expect(span.attributes.has("t3.title.raw_output")).toBe(false);
    expect(span.attributes.has("gen_ai.input.messages")).toBe(false);
    expect(span.status._tag).toBe("Ended");
  });
  it("redacts credentials and tolerates exporter failures", () => {
    const { recorder, spans } = setup(true);
    recorder.rawOutput("password=hunter2 sk-abcdefghijklmnop");
    recorder.finish({ title: "Fix login errors" });
    expect(spans[0]!.attributes.get("t3.title.raw_output")).not.toContain("hunter2");
    expect(spans[0]!.attributes.get("t3.title.raw_output")).not.toContain("sk-abcdefghijklmnop");
    const broken = startThreadTitleTelemetry({
      tracer: Tracer.make({
        span: () => {
          throw new Error("offline");
        },
      }),
      captureContent: true,
      nowMs: () => 1000,
      model: "luna",
      prompt: "hello",
    });
    expect(() => {
      broken.rawOutput("response");
      broken.finish(undefined);
    }).not.toThrow();
  });
});
