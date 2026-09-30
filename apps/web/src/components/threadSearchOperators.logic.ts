// Discord-style operators for the command palette's thread search:
//   in:<project>          project name or path contains the value
//   provider:<provider>   provider name, instance id, or driver contains the value
//   before:/after:/on:    a local calendar day: YYYY-MM-DD, today, or yesterday
// Values with spaces are quoted (in:"My Project"), with \" for a literal quote.
// Different operators AND together; repeating one ORs its values. Everything
// else stays free text, and a date that doesn't parse stays free text rather
// than filtering everything.

interface ThreadSearchOperators {
  /** The free text left once operator tokens are removed. */
  readonly text: string;
  /** Lowercased in: values. */
  readonly projects: ReadonlyArray<string>;
  /** Lowercased provider: values. */
  readonly providers: ReadonlyArray<string>;
  /** Inclusive lower and exclusive upper activity bounds; null is unbounded. */
  readonly startMs: number | null;
  readonly endMs: number | null;
}

// A run of non-space characters, where a quoted section may contain spaces.
// An unterminated quote runs to the end: the user is still typing it.
const TOKEN_PATTERN = /(?:[^\s"]|"(?:[^"\\]|\\.)*"?)+/g;
const OPERATOR_PATTERN = /^(in|provider|before|after|on):(.*)$/i;

function parseLocalDay(value: string, now: Date): { start: number; end: number } | null {
  let year = now.getFullYear();
  let month = now.getMonth();
  let day = now.getDate();
  if (value === "yesterday") {
    day -= 1;
  } else if (value !== "today") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!iso) return null;
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
    const date = new Date(year, month, day);
    // The Date constructor rolls typos over (2026-02-31 becomes March 3rd).
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null;
    }
  }
  return {
    start: new Date(year, month, day).getTime(),
    end: new Date(year, month, day + 1).getTime(),
  };
}

/** Drops unescaped quotes and unescapes \". */
function unquote(value: string): string {
  return value.replace(/\\"|"/g, (match) => (match === '"' ? "" : '"'));
}

/** Returns null when the query has no operators, so callers keep plain search. */
export function parseThreadSearchOperators(query: string, now: Date): ThreadSearchOperators | null {
  const text: string[] = [];
  const projects: string[] = [];
  const providers: string[] = [];
  let startMs: number | null = null;
  let endMs: number | null = null;
  let hasOperator = false;

  for (const token of query.match(TOKEN_PATTERN) ?? []) {
    const operator = OPERATOR_PATTERN.exec(token);
    if (!operator) {
      text.push(token);
      continue;
    }
    const keyword = operator[1]!.toLowerCase();
    const value = unquote(operator[2]!).trim().toLowerCase();
    // A bare `in:` or `on:` is still being typed; it filters nothing and searches nothing.
    if (keyword === "in" || keyword === "provider" || value.length === 0) {
      if (value.length > 0) (keyword === "in" ? projects : providers).push(value);
      hasOperator = true;
      continue;
    }
    const day = parseLocalDay(value, now);
    if (day === null) {
      text.push(token);
      continue;
    }
    hasOperator = true;
    // Like Discord, before: and after: exclude the named day. Repeats intersect.
    const start = keyword === "on" ? day.start : keyword === "after" ? day.end : null;
    const end = keyword === "on" ? day.end : keyword === "before" ? day.start : null;
    if (start !== null) startMs = Math.max(startMs ?? start, start);
    if (end !== null) endMs = Math.min(endMs ?? end, end);
  }

  if (!hasOperator) return null;
  return { text: text.join(" "), projects, providers, startMs, endMs };
}

export function matchesThreadSearchOperators(
  operators: ThreadSearchOperators,
  thread: {
    readonly projectLabels: ReadonlyArray<string | null | undefined>;
    readonly providerLabels: ReadonlyArray<string | null | undefined>;
    readonly activityMs: number;
  },
): boolean {
  const matchesAny = (
    values: ReadonlyArray<string>,
    labels: ReadonlyArray<string | null | undefined>,
  ) =>
    values.length === 0 ||
    values.some((value) => labels.some((label) => label?.toLowerCase().includes(value)));
  return (
    matchesAny(operators.projects, thread.projectLabels) &&
    matchesAny(operators.providers, thread.providerLabels) &&
    (operators.startMs === null || thread.activityMs >= operators.startMs) &&
    (operators.endMs === null || thread.activityMs < operators.endMs)
  );
}

interface ThreadSearchOperatorCompletion {
  readonly keyword: "in" | "provider";
  /** Index where the operator token starts in the query. */
  readonly start: number;
  /** The unquoted value typed so far. */
  readonly partial: string;
}

/** The `in:` or `provider:` token still being typed at the end of the query. */
export function getThreadSearchOperatorCompletion(
  query: string,
): ThreadSearchOperatorCompletion | null {
  const match = /(?:^|\s)((in|provider):("(?:[^"\\]|\\.)*|[^\s"]*))$/i.exec(query);
  if (!match) return null;
  return {
    keyword: match[2]!.toLowerCase() === "in" ? "in" : "provider",
    start: query.length - match[1]!.length,
    partial: unquote(match[3]!),
  };
}

/** Replaces the token being typed with the picked value, quoted if it has spaces or quotes. */
export function applyThreadSearchOperatorCompletion(
  query: string,
  completion: ThreadSearchOperatorCompletion,
  value: string,
): string {
  const rendered = /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
  return `${query.slice(0, completion.start)}${completion.keyword}:${rendered} `;
}
