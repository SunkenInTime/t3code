import { describe, expect, it } from "vite-plus/test";
import {
  applyThreadSearchOperatorCompletion,
  getThreadSearchOperatorCompletion,
  matchesThreadSearchOperators,
  parseThreadSearchOperators,
} from "./threadSearchOperators.logic";

// Local time on purpose: day operators follow the user's calendar, not UTC.
const now = new Date(2026, 7, 9, 12, 30);
const day = (month: number, date: number) => new Date(2026, month, date).getTime();

describe("parseThreadSearchOperators", () => {
  it("leaves plain queries to the regular search", () => {
    expect(parseThreadSearchOperators("fix bug", now)).toBeNull();
    expect(parseThreadSearchOperators("re: meeting notes", now)).toBeNull();
  });

  it("keeps an operator still being typed out of the free text", () => {
    expect(parseThreadSearchOperators("mobile in:", now)).toEqual({
      text: "mobile",
      projects: [],
      providers: [],
      startMs: null,
      endMs: null,
    });
    expect(parseThreadSearchOperators("provider:", now)).toMatchObject({ text: "" });
  });

  it("extracts project and provider values, including quoted names", () => {
    expect(parseThreadSearchOperators('fix in:Atlas in:"My Project" provider:Claude', now)).toEqual(
      {
        text: "fix",
        projects: ["atlas", "my project"],
        providers: ["claude"],
        startMs: null,
        endMs: null,
      },
    );
  });

  it("resolves on:, today, and yesterday to local calendar days", () => {
    expect(parseThreadSearchOperators("on:2026-08-01", now)).toMatchObject({
      startMs: day(7, 1),
      endMs: day(7, 2),
    });
    expect(parseThreadSearchOperators("on:today", now)).toMatchObject({
      startMs: day(7, 9),
      endMs: day(7, 10),
    });
    expect(parseThreadSearchOperators("on:yesterday", now)).toMatchObject({
      startMs: day(7, 8),
      endMs: day(7, 9),
    });
  });

  it("excludes the named day from before: and after:, intersecting repeats", () => {
    expect(
      parseThreadSearchOperators("after:2026-07-01 after:2026-08-01 before:2026-08-05", now),
    ).toMatchObject({ startMs: day(7, 2), endMs: day(7, 5) });
  });

  it("keeps unparseable dates as text", () => {
    expect(parseThreadSearchOperators("before:banana", now)).toBeNull();
    expect(parseThreadSearchOperators("on:2026-02-31 in:atlas", now)).toMatchObject({
      text: "on:2026-02-31",
      startMs: null,
    });
  });
});

describe("matchesThreadSearchOperators", () => {
  const thread = {
    projectLabels: ["Atlas", "/work/atlas"],
    providerLabels: ["claudeAgent", "Claude"],
    activityMs: day(7, 8) + 1_000,
  };
  const matches = (query: string) =>
    matchesThreadSearchOperators(parseThreadSearchOperators(query, now)!, thread);

  it("matches project and provider values by substring, ORing repeats", () => {
    expect(matches("in:atl")).toBe(true);
    expect(matches("in:work/atlas")).toBe(true);
    expect(matches("in:beacon in:atlas")).toBe(true);
    expect(matches("in:beacon")).toBe(false);
    expect(matches("provider:claude")).toBe(true);
    expect(matches("provider:codex")).toBe(false);
  });

  it("ANDs different operators and applies day bounds", () => {
    expect(matches("in:atlas on:yesterday")).toBe(true);
    expect(matches("in:atlas on:today")).toBe(false);
    expect(matches("after:2026-08-07 before:today")).toBe(true);
    expect(matches("after:yesterday")).toBe(false);
  });
});

describe("thread search operator completion", () => {
  it("finds the operator being typed at the end of the query", () => {
    expect(getThreadSearchOperatorCompletion("fix in:atl")).toEqual({
      keyword: "in",
      start: 4,
      partial: "atl",
    });
    expect(getThreadSearchOperatorCompletion('Provider:"claude co')).toEqual({
      keyword: "provider",
      start: 0,
      partial: "claude co",
    });
    expect(getThreadSearchOperatorCompletion("in:atlas ")).toBeNull();
    expect(getThreadSearchOperatorCompletion('in:"My Project"')).toBeNull();
    expect(getThreadSearchOperatorCompletion("fix on:")).toBeNull();
  });

  it("commits the picked value with a trailing space, quoting names with spaces", () => {
    const completion = getThreadSearchOperatorCompletion("fix in:my")!;
    expect(applyThreadSearchOperatorCompletion("fix in:my", completion, "Atlas")).toBe(
      "fix in:Atlas ",
    );
    expect(applyThreadSearchOperatorCompletion("fix in:my", completion, "My Project")).toBe(
      'fix in:"My Project" ',
    );
  });

  it("round-trips names containing quotes", () => {
    const query = applyThreadSearchOperatorCompletion(
      "in:my",
      getThreadSearchOperatorCompletion("in:my")!,
      'My "Quoted" Project',
    );
    expect(query).toBe('in:"My \\"Quoted\\" Project" ');
    expect(parseThreadSearchOperators(query, now)?.projects).toEqual(['my "quoted" project']);
    expect(getThreadSearchOperatorCompletion('in:"My \\"Quo')?.partial).toBe('My "Quo');
  });
});
