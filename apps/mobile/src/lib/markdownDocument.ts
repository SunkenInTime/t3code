import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);
export type MarkdownNode = Root | RootContent;

function decodeCodePoint(codePoint: number, entity: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) {
        return decodeCodePoint(Number.parseInt(decimal, 10), entity);
      }
      if (hexadecimal) {
        return decodeCodePoint(Number.parseInt(hexadecimal, 16), entity);
      }
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&apos;":
          return "'";
        case "&gt;":
          return ">";
        case "&lt;":
          return "<";
        case "&nbsp;":
          return "\u00a0";
        case "&quot;":
          return '"';
        default:
          return entity;
      }
    },
  );
}

const HTML_TAG = /<!--[\s\S]*?-->|<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function attribute(tag: string, name: string): string | null {
  const attributes = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(attributes)) {
    if (match[1]?.toLowerCase() === name) {
      return decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return null;
}

/** Called only for parsed HTML nodes, so Markdown code examples keep their literal tags. */
export function markdownHtmlContent(content: string): string {
  // An HTML block such as <details> can also contain Markdown fences and code spans.
  const codeRanges: Array<{ start: number; end: number }> = [];
  const tags = [...content.matchAll(HTML_TAG)];
  let tagIndex = 0;
  const delimiters = [...content.matchAll(/`+|~{3,}/g)].filter((delimiter) => {
    while (tags[tagIndex] && tags[tagIndex]!.index + tags[tagIndex]![0].length <= delimiter.index)
      tagIndex += 1;
    const tag = tags[tagIndex];
    return !tag || delimiter.index < tag.index;
  });
  for (let index = 0; index < delimiters.length; index += 1) {
    const opening = delimiters[index]!;
    const lineStart = content.lastIndexOf("\n", opening.index - 1) + 1;
    const fenced =
      opening[0].length >= 3 && /^ {0,3}$/.test(content.slice(lineStart, opening.index));
    if (opening[0][0] === "~" && !fenced) continue;
    let closingIndex = -1;
    for (let candidate = index + 1; candidate < delimiters.length; candidate += 1) {
      const closing = delimiters[candidate]!;
      if (!fenced && closing[0] === opening[0]) {
        closingIndex = candidate;
        break;
      }
      if (!fenced || closing[0][0] !== opening[0][0] || closing[0].length < opening[0].length)
        continue;
      const start = content.lastIndexOf("\n", closing.index - 1) + 1;
      const nextLine = content.indexOf("\n", closing.index);
      const end = nextLine === -1 ? content.length : nextLine;
      if (
        /^ {0,3}$/.test(content.slice(start, closing.index)) &&
        /^\s*$/.test(content.slice(closing.index + closing[0].length, end))
      ) {
        closingIndex = candidate;
        break;
      }
    }
    if (closingIndex === -1) {
      if (fenced) codeRanges.push({ start: opening.index, end: content.length });
      continue;
    }
    const closing = delimiters[closingIndex]!;
    codeRanges.push({ start: opening.index, end: closing.index + closing[0].length });
    index = closingIndex;
  }
  return content.replace(HTML_TAG, (tag, offset: number) => {
    if (codeRanges.some((range) => offset >= range.start && offset < range.end)) return tag;
    if (tag.startsWith("<!--")) return "";
    if (/^<img\b/i.test(tag)) {
      const src = attribute(tag, "src");
      if (!src) return "";
      const alt = (attribute(tag, "alt") ?? "").replace(/[\\[\]&]/g, "\\$&");
      const href = src
        .replace(/&/g, "\\&")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E")
        .replace(/\n/g, "");
      return `![${alt}](<${href}>)`;
    }
    if (/^<summary\b/i.test(tag)) return "\n\n**";
    if (/^<\/summary\s*>/i.test(tag)) return "**\n\n";
    if (/^<br\b/i.test(tag)) return "  \n";
    if (/^<\/?(?:p|div|details)\b/i.test(tag)) return "\n\n";
    return "";
  });
}

export function markdownWithHtml(markdown: string): string {
  if (!/<(?:!--|\/?[a-z])/i.test(markdown)) return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "html") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        edits.push({ start, end, content: markdownHtmlContent(node.value) });
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}

// A delimiter row such as `|---|:--:|`, possibly inside a blockquote or list item.
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const row = line.replace(/^[ \t>]+/, "").trim();
  return row
    .replace(/^\||\|$/g, "")
    .split("|")
    .every((cell) => /^:?-+:?$/.test(cell.trim()));
}

// Cheap pre-check for a delimiter row two lines below text, so most messages skip the parse.
function mayHaveTableUnderText(markdown: string): boolean {
  if (!markdown.includes("|")) return false;
  const lines = markdown.split(/\r\n|\r|\n/);
  for (let index = 2; index < lines.length; index += 1) {
    if (isTableDelimiterRow(lines[index]!) && /[^\s>]/.test(lines[index - 2]!)) return true;
  }
  return false;
}

/**
 * GFM lets a table interrupt a paragraph, but the native parser (md4c) only starts a table
 * on a paragraph's first line, so a table right under a line of text renders as one
 * run-on paragraph. Insert the blank line md4c needs before each such table.
 */
export function markdownWithTableBreaks(markdown: string): string {
  if (!mayHaveTableUnderText(markdown)) return markdown;
  const lineStarts: number[] = [];
  const visit = (node: MarkdownNode) => {
    if (!("children" in node)) return;
    node.children.forEach((child, index) => {
      const previous = node.children[index - 1];
      const start = child.position?.start;
      if (
        child.type === "table" &&
        previous?.type === "paragraph" &&
        start?.offset !== undefined &&
        previous.position?.end.line === start.line - 1
      )
        lineStarts.push(
          Math.max(
            markdown.lastIndexOf("\n", start.offset - 1),
            markdown.lastIndexOf("\r", start.offset - 1),
          ) + 1,
        );
      visit(child);
    });
  };
  visit(parser.parse(markdown));
  for (const lineStart of lineStarts.reverse()) {
    // The header row may be a lazy line without its container markers (`>` or list indent),
    // so copy the delimiter row's markers onto the blank line and the header row.
    const [, header = "", cells = "", ending = "\n", markers = ""] =
      /^([ \t>]*)([^\r\n]*)(\r\n|\r|\n)([ \t>]*)/.exec(markdown.slice(lineStart)) ?? [];
    markdown =
      markdown.slice(0, lineStart) +
      `${markers.trimEnd()}${ending}${markers}${cells}` +
      markdown.slice(lineStart + header.length + cells.length);
  }
  return markdown;
}

const QUOTE_MARKER = /^ {0,3}> ?/;
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?= |$) ?/;
const FENCE = /^[ \t]*(`{3,}(?!.*`)|~{3,})/;
// Headings, thematic breaks and setext underlines end the paragraph before them.
const BLOCK_BREAK = /^ {0,3}(?:#{1,6}(?:\s|$)|([-*_=])(?: *\1)+ *$)/;
const AUTOLINK = /<(?:[A-Za-z][A-Za-z\d+.-]{1,31}:[^\s<>]*|[\w.!#$%&'*+/=?^`{|}~-]+@[^\s<>]+)>/y;
// Web keeps an escape when the text before it ends in an unfinished drive path: from a drive
// path's first separator to the end of the word or of the Markdown text it sits in.
const DRIVE_START = /(?:^|\W)[A-Za-z]:[\\/]/g;

interface MarkdownLine {
  readonly start: number;
  readonly end: number;
  readonly depth: number;
  /** After the blockquote markers. */
  readonly quoted: string;
  /** After the blockquote and list markers. */
  readonly content: string;
  readonly listed: boolean;
  readonly blank: boolean;
  readonly tabbed: boolean;
}

interface OpenFence {
  readonly marker: string;
  readonly depth: number;
  readonly column: number;
  closable: boolean;
}

function leadingSpaces(text: string): number {
  return text.length - text.replace(/^ +/, "").length;
}

function markdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  for (const { 0: ending, index: end } of `${markdown}\n`.matchAll(/\r\n|\r|\n/g)) {
    const text = markdown.slice(start, end);
    let quoted = text;
    let depth = 0;
    for (let marker; (marker = QUOTE_MARKER.exec(quoted)); depth += 1)
      quoted = quoted.slice(marker[0].length);
    let content = quoted;
    let listed = false;
    for (let marker; (marker = LIST_MARKER.exec(content) ?? QUOTE_MARKER.exec(content));) {
      if (marker[0].trimStart().startsWith(">")) depth += 1;
      else listed = true;
      content = content.slice(marker[0].length);
    }
    lines.push({
      start,
      end,
      depth,
      quoted,
      content,
      listed,
      blank: content.trim() === "",
      tabbed: /\t/.test(text.slice(0, text.length - content.trimStart().length)),
    });
    start = end + ending.length;
  }
  return lines;
}

function closesFence(line: MarkdownLine, fence: OpenFence): boolean {
  if (!fence.closable || line.listed || line.tabbed || line.depth !== fence.depth) return false;
  // The innermost container starts zero to three columns before the opening fence, and a
  // closing fence sits zero to three columns into it. Only accept columns valid for all.
  const column = leadingSpaces(line.quoted);
  if (column < fence.column || column > Math.max(0, fence.column - 3) + 3) return false;
  const closer = /^([`~])\1*/.exec(line.quoted.slice(column))?.[0] ?? "";
  return (
    closer[0] === fence.marker[0] &&
    closer.length >= fence.marker.length &&
    line.quoted.slice(column + closer.length).trim() === ""
  );
}

/**
 * Code spans and autolinks in a paragraph, where backslashes are literal, or null when a
 * backtick is left unmatched.
 */
function literalSpans(text: string): Array<{ start: number; end: number }> | null {
  const spans: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += /[!-/:-@[-`{-~]/.test(text[index + 1] ?? "") ? 2 : 1;
      continue;
    }
    if (text[index] === "<") {
      AUTOLINK.lastIndex = index;
      const autolink = AUTOLINK.exec(text);
      if (autolink) spans.push({ start: index, end: AUTOLINK.lastIndex });
      index = autolink ? AUTOLINK.lastIndex : index + 1;
      continue;
    }
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let openerEnd = index;
    while (text[openerEnd] === "`") openerEnd += 1;
    // Backslashes are literal inside a code span, so the closer search ignores escapes.
    let closer = openerEnd;
    let closerEnd = -1;
    while (closer < text.length) {
      if (text[closer] !== "`") {
        closer += 1;
        continue;
      }
      let runEnd = closer;
      while (text[runEnd] === "`") runEnd += 1;
      if (runEnd - closer === openerEnd - index) {
        closerEnd = runEnd;
        break;
      }
      closer = runEnd;
    }
    if (closerEnd === -1) return null;
    spans.push({ start: index, end: closerEnd });
    index = closerEnd;
  }
  return spans;
}

function keptInWord(word: string, offset: number, kept: number[]) {
  DRIVE_START.lastIndex = 0;
  for (let drive; (drive = DRIVE_START.exec(word));) {
    const destination = /\]\(<?$/.test(word.slice(0, drive.index + 1));
    let index = drive.index + drive[0].length - 1;
    while (index < word.length) {
      const character = word[index]!;
      if (character === "\\" && /[!-/:-@[-`{-~]/.test(word[index + 1] ?? "")) {
        kept.push(offset + index);
        index += 2;
        continue;
      }
      // Where web's text ends: link text, a link destination, or emphasis.
      if (character === "]" || character === "*" || (destination && /[)>]/.test(character))) break;
      index += 1;
    }
    DRIVE_START.lastIndex = index;
  }
}

function keptInParagraph(markdown: string, lines: ReadonlyArray<MarkdownLine>, kept: number[]) {
  const start = lines[0]!.start;
  const text = markdown.slice(start, lines.at(-1)!.end);
  // Table cells pair backticks cell by cell, so leave tables with code alone.
  if (text.includes("`") && text.includes("|")) return;
  const spans = literalSpans(text);
  if (!spans) return;
  let proseStart = 0;
  for (const span of [...spans, { start: text.length, end: text.length }]) {
    const prose = text.slice(proseStart, span.start);
    for (const { 0: word, index: wordStart } of prose.matchAll(/\S+/g))
      keptInWord(word, start + proseStart + wordStart, kept);
    proseStart = span.end;
  }
}

/**
 * md4c reads the `\.` in `C:\me\.t3` as an escape. Before it parses, turn each escape inside
 * a drive path, by the rule `remarkKeepWindowsPaths` applies on web, into `\\\.`: an escaped
 * backslash and then the escape, so md4c shows `\.` and the character can't start emphasis.
 *
 * A full parse on every streamed update costs too much on the phone, so this finds code with
 * a line scan. Where the scan can't tell prose from code, such as an unmatched backtick, a
 * table with code spans, or a line indented four columns, it leaves the text as md4c would
 * read it anyway: a path there may lose a separator, but code never changes.
 */
export function markdownWithWindowsPaths(markdown: string): string {
  if (!/[A-Za-z]:\S*\\[!-/:-@[-`{-~]/.test(markdown)) return markdown;
  const kept: number[] = [];
  let fence: OpenFence | undefined;
  let paragraph: MarkdownLine[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) keptInParagraph(markdown, paragraph, kept);
    paragraph = [];
  };
  for (const line of markdownLines(markdown)) {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      // Past a line that may close the fence's container, md4c may have ended the code and
      // opened another fence, so no later line is trusted to close this one.
      else if (
        !line.blank &&
        (line.depth !== fence.depth || leadingSpaces(line.quoted) < fence.column)
      )
        fence.closable = false;
      continue;
    }
    const opener = FENCE.exec(line.content);
    if (opener) {
      endParagraph();
      fence = {
        marker: opener[1]!,
        depth: line.depth,
        column: line.quoted.length - line.content.length + opener[0].length - opener[1]!.length,
        closable: !line.tabbed,
      };
      continue;
    }
    // Four columns in may be an indented code block.
    if (line.blank || line.tabbed || leadingSpaces(line.content) >= 4) {
      endParagraph();
      continue;
    }
    const last = paragraph.at(-1);
    if (last && (line.listed || line.depth !== last.depth || BLOCK_BREAK.test(line.content)))
      endParagraph();
    paragraph.push(line);
    if (BLOCK_BREAK.test(line.content)) endParagraph();
  }
  endParagraph();
  let result = "";
  let copied = 0;
  for (const offset of kept) {
    result += `${markdown.slice(copied, offset)}\\\\`;
    copied = offset;
  }
  return result + markdown.slice(copied);
}

export function parseMarkdownDocument(markdown: string): Root {
  return parser.parse(markdownWithHtml(markdown));
}

/** The document as the native renderer parses it, with Windows path separators kept. */
export function parseNativeMarkdownDocument(markdown: string): Root {
  return parser.parse(markdownWithWindowsPaths(markdownWithHtml(markdown)));
}
