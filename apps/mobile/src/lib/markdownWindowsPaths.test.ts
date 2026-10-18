import * as NodeModule from "node:module";
import { CHAT_MARKDOWN_REMARK_PLUGINS } from "@t3tools/shared/markdownPipeline";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { markdownWithWindowsPaths } from "./markdownDocument";
import { markdownImageSources } from "./markdownImageSources";

interface Md4cNode {
  readonly type: string;
  readonly content?: string;
  readonly attributes?: { readonly url?: string };
  readonly children?: ReadonlyArray<Md4cNode>;
}

// The same md4c parser the native renderer runs, built to WASM by react-native-enriched-markdown.
let parseMd4c: (markdown: string) => Md4cNode;

beforeAll(async () => {
  const createModule = NodeModule.createRequire(import.meta.url)(
    "react-native-enriched-markdown/src/web/wasm/md4c.js",
  );
  const md4c = await createModule();
  const parse = md4c.cwrap("parseMarkdown", "string", ["string", ...Array(8).fill("number")]);
  parseMd4c = (markdown) => JSON.parse(parse(markdown, 0, 0, 0, 0, 0, 0, 0, 1));
});

function text(node: Md4cNode): string {
  const inner = node.content ?? (node.children ?? []).map(text).join("");
  if (node.type === "Emphasis") return `<em>${inner}</em>`;
  if (node.type === "Code") return `<code>${inner}</code>`;
  if (node.type === "Link" || node.type === "Image") return `<${node.attributes?.url}>${inner}`;
  return inner;
}

const rendered = (markdown: string) => text(parseMd4c(markdownWithWindowsPaths(markdown))).trim();

function plainText(node: Md4cNode): string {
  const inner = node.content ?? (node.children ?? []).map(plainText).join("");
  return node.type === "Code" ? `<code>${inner}</code>` : inner;
}

function code(node: Md4cNode): string[] {
  if (node.type === "Code" || node.type === "CodeBlock") return [text(node)];
  return (node.children ?? []).flatMap(code);
}

const webProcessor = unified().use(remarkParse).use(CHAT_MARKDOWN_REMARK_PLUGINS);
function webText(markdown: string): string {
  type Node = { type: string; value?: string; children?: Node[] };
  const visit = (node: Node): string =>
    node.type === "inlineCode"
      ? `<code>${node.value}</code>`
      : (node.value ?? (node.children ?? []).map(visit).join(""));
  return visit(webProcessor.runSync(webProcessor.parse(markdown)) as Node).trim();
}

const path = String.raw`C:\repo\.config`;

describe("Windows paths in native Markdown", () => {
  it("keeps backslashes that md4c would read as escapes in prose paths", () => {
    expect(
      rendered(String.raw`Saved to C:\Users\me\.t3\_build and (C:\.scratch). Keep \*this\*.`),
    ).toBe(String.raw`Saved to C:\Users\me\.t3\_build and (C:\.scratch). Keep *this*.`);
  });

  it("renders prose paths the way web does", () => {
    for (const markdown of [
      String.raw`Saved to C:\Users\me\.t3\userdata and C:\a\_b, scratch in (C:\.scratch).`,
      String.raw`*C:\repo\.github* and [C:\repo\.vscode](https://example.com) and C:/work\.config`,
      String.raw`See C:\x and \*this\* and Note:\*that\* and Part a:\*x\*`,
      String.raw`Already escaped C:\\Users\\me\\.t3 shows as written`,
      String.raw`Escaped \` and ${path} then \``,
      String.raw`${"`"}C:\me\.t3${"`"}C:\me\.t3 and ${path}`,
    ])
      expect(plainText(parseMd4c(markdownWithWindowsPaths(markdown))).trim(), markdown).toBe(
        webText(markdown),
      );
  });

  it("does not let a kept separator start emphasis", () => {
    expect(rendered(String.raw`Matches C:\src\*.ts and C:\src\*.tsx`)).toBe(
      String.raw`Matches C:\src\*.ts and C:\src\*.tsx`,
    );
  });

  it("keeps link and image destinations as written", () => {
    expect(rendered(String.raw`[shot](C:\me\.t3\shot.png) ![](C:\me\.t3\img.png)`)).toBe(
      String.raw`<C:\me\.t3\shot.png>shot <C:\me\.t3\img.png>`,
    );
  });

  it("never changes code, including every prefix of a streamed message", () => {
    const messages = [
      `${"```"}\n${path}\n${"```"}\nAfter ${path}`,
      `~~~text\n${path}\n~~~`,
      `> ~~~text\n> ${path}\n> ~~~\n\nAfter ${path}`,
      `> ${"```"}text\n> ${path}\n> ${"```"}`,
      `- ${"```"}text\n  ${path}\n  ${"```"}`,
      `- ~~~text\n  ${path}\n  ~~~`,
      `1. Step\n\n   ${"```"}\n   ${path}\n   ${"```"}`,
      `- ${"```"}\n  ${path}\n- item\n  ${"```"}\n  ${path}`,
      `> ${"```"}\n> ${path}\nAfter ${path}\n${"```"}\n${path}`,
      `Paragraph\n\n    ${path}`,
      `>     ${path}`,
      `-     ${path}`,
      `Run \`${path}\` and \`\`${path} \` ${path}\`\` now`,
      `| a | b |\n|---|---|\n| \`${path}\` | ${path} |`,
      `- > ${"```"}\n  > ${path}\n  > ${"```"}`,
    ];
    for (const message of messages)
      for (let end = 1; end <= message.length; end += 1) {
        const prefix = message.slice(0, end);
        expect(code(parseMd4c(markdownWithWindowsPaths(prefix))), prefix).toEqual(
          code(parseMd4c(prefix)),
        );
      }
  });

  it("leaves autolinks alone, where backslashes are literal", () => {
    const markdown = `<https://example.com/${path}>`;
    expect(rendered(markdown)).toBe(text(parseMd4c(markdown)).trim());
  });

  it("keeps prose paths after the code ends", () => {
    expect(rendered(`> ~~~text\n> ${path}\n> ~~~\n\nAfter ${path}`)).toBe(`${path}\nAfter ${path}`);
    expect(rendered(`${"```"}\n${path}\n${"```"}\nAfter ${path}`)).toBe(`${path}\nAfter ${path}`);
  });

  it("gives the image gallery the paths the renderer shows", () => {
    expect(
      markdownImageSources(String.raw`![one](C:\me\.t3\one.png) ![two](C:\me\.t3\two.png)`),
    ).toEqual([String.raw`C:\me\.t3\one.png`, String.raw`C:\me\.t3\two.png`]);
  });
});
