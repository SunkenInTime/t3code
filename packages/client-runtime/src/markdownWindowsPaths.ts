/**
 * CommonMark reads a backslash before ASCII punctuation as an escape, even
 * inside a link or image destination. Agents write Windows paths with their
 * native separator, so `C:\Users\dara\.t3\shot.png` parses as
 * `C:\Users\dara.t3\shot.png` and the asset request asks for a file that does
 * not exist. Rewriting the separators to `/` before parsing keeps every
 * character in place: the path is still absolute, the parser has nothing to
 * unescape, and the text keeps its length so source offsets stay valid.
 */

// Inline destinations after `](` and reference definitions such as `[id]: C:\...`.
const DESTINATION_START_PATTERN = /(?:\]\(\s*|^ {0,3}\[[^\]\n]+\]:[ \t]*)(<?)([A-Za-z]:\\)/gm;
// A code span opens and closes with backtick runs of the same length. A run
// next to another backtick is part of a longer run, and a backslash before the
// opening run escapes its first backtick. Escapes are inert inside a span, so
// a backslash before the closing run does not.
const INLINE_CODE_PATTERN = /(?<![`\\])(`+)[^`][\s\S]*?(?<!`)\1(?!`)/g;
// A fence can sit inside block quotes and list items; the container prefixes
// come first, then up to three spaces, then the fence run.
const CODE_FENCE_PATTERN = /^(?:(?: {0,3}(?:>|[-+*]|\d{1,9}[.)])(?: |$))*) {0,3}(`{3,}|~{3,})(.*)$/;

/** Length of a bare destination starting at `start`, honoring balanced parentheses. */
function bareDestinationLength(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") break;
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    index += 1;
  }
  return index - start;
}

function normalizeDestinations(segment: string): string {
  if (!segment.includes(":\\")) return segment;
  let result = "";
  let cursor = 0;
  for (const match of segment.matchAll(DESTINATION_START_PATTERN)) {
    const angle = match[1] === "<";
    const start = match.index + match[0].length - 3;
    if (start < cursor) continue;
    const length = angle
      ? (() => {
          const end = segment.indexOf(">", start);
          const lineEnd = segment.indexOf("\n", start);
          return end < 0 || (lineEnd >= 0 && lineEnd < end) ? -1 : end - start;
        })()
      : bareDestinationLength(segment, start);
    if (length < 0) continue;
    result += segment.slice(cursor, start);
    result += segment.slice(start, start + length).replaceAll("\\", "/");
    cursor = start + length;
  }
  return result + segment.slice(cursor);
}

function normalizeOutsideInlineCode(segment: string): string {
  let result = "";
  let cursor = 0;
  for (const match of segment.matchAll(INLINE_CODE_PATTERN)) {
    result += normalizeDestinations(segment.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  return result + normalizeDestinations(segment.slice(cursor));
}

/**
 * Rewrites Windows drive-letter link and image destinations to forward slashes
 * so backslash escapes cannot corrupt the path during parsing. Code spans and
 * fenced code blocks are left as written. The result has the same length as
 * the input.
 */
export function normalizeWindowsMarkdownDestinations(markdown: string): string {
  if (!markdown.includes(":\\")) return markdown;

  const lines = markdown.split("\n");
  const output: string[] = [];
  let prose: string[] = [];
  let openFence: string | null = null;

  const flushProse = () => {
    if (prose.length === 0) return;
    output.push(normalizeOutsideInlineCode(prose.join("\n")));
    prose = [];
  };

  for (const line of lines) {
    const match = CODE_FENCE_PATTERN.exec(line);
    const fence = match?.[1];
    const info = match?.[2] ?? "";
    if (openFence === null) {
      // A backtick fence cannot carry a backtick in its info string.
      if (fence !== undefined && !(fence[0] === "`" && info.includes("`"))) {
        flushProse();
        openFence = fence;
        output.push(line);
      } else {
        prose.push(line);
      }
      continue;
    }
    output.push(line);
    if (
      fence !== undefined &&
      fence[0] === openFence[0] &&
      fence.length >= openFence.length &&
      info.trim() === ""
    ) {
      openFence = null;
    }
  }
  flushProse();
  return output.join("\n");
}
