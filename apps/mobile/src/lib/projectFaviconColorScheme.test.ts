import * as Encoding from "effect/Encoding";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveProjectFaviconColorScheme,
  resolveSvgColorScheme,
} from "./projectFaviconColorScheme";

// The reduced icon from #12823.
const ADAPTIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440" fill="none" stroke="currentColor" stroke-width="9">
  <style>:root{color:#111827}@media(prefers-color-scheme:dark){:root{color:#F8FAFC}}</style>
  <path d="M 40 220 L 220 40 L 400 220 L 220 400 Z"/>
</svg>`;

const adaptive = (css: string, body = '<path stroke="currentColor"/>') =>
  `<svg xmlns="http://www.w3.org/2000/svg"><style>${css}</style>${body}</svg>`;

describe("resolveSvgColorScheme", () => {
  it("bakes the root color for the app's scheme into currentColor", () => {
    const dark = resolveSvgColorScheme(ADAPTIVE_SVG, "dark");
    expect(dark).toContain('stroke="#F8FAFC"');
    expect(dark).not.toMatch(/@media|currentColor/);
    const light = resolveSvgColorScheme(ADAPTIVE_SVG, "light");
    expect(light).toContain('stroke="#111827"');
    expect(light).not.toMatch(/@media|currentColor|#F8FAFC/);
  });

  it("keeps rules that do not use currentColor for the matching scheme", () => {
    const svg = adaptive(
      "@MEDIA (Prefers-Color-Scheme: Dark) { path { stroke: #fff } }",
      '<path stroke="#000"/>',
    );
    expect(resolveSvgColorScheme(svg, "dark")).toBe(
      adaptive(" path { stroke: #fff } ", '<path stroke="#000"/>'),
    );
    expect(resolveSvgColorScheme(svg, "light")).toBe(adaptive("", '<path stroke="#000"/>'));
  });

  it("only rewrites currentColor where it is a paint value", () => {
    const svg = adaptive(
      "svg{color:#111}@media (prefers-color-scheme: dark){svg{color:#eee}}",
      '<linearGradient id="paint:currentColor"/><path fill="url(#paint:currentColor)" style="stroke: currentColor !important"/>',
    );
    expect(resolveSvgColorScheme(svg, "dark")).toContain(
      '<linearGradient id="paint:currentColor"/><path fill="url(#paint:currentColor)" style="stroke: #eee !important"/>',
    );
  });

  it.each([
    ["not queries", "@media not (prefers-color-scheme: dark){:root{color:#fff}}"],
    ["compound queries", "@media screen and (prefers-color-scheme: dark){:root{color:#fff}}"],
    [
      "element-specific colors",
      ":root{color:#000}.accent{color:red}@media (prefers-color-scheme: dark){:root{color:#fff}}",
    ],
    ["other at-rules", "@import url(a.css);@media (prefers-color-scheme: dark){:root{color:#fff}}"],
    ["XML entities", ":root{color:&#35;000}@media (prefers-color-scheme: dark){:root{color:#fff}}"],
  ])("leaves %s to the native decoder", (_, css) => {
    const svg = adaptive(css);
    expect(resolveSvgColorScheme(svg, "dark")).toBe(svg);
  });

  it("leaves nested <svg> elements to the native decoder", () => {
    const svg = adaptive(
      "svg{color:red}@media (prefers-color-scheme: dark){:root{color:#fff}}",
      '<svg><path stroke="currentColor"/></svg>',
    );
    expect(resolveSvgColorScheme(svg, "dark")).toBe(svg);
  });

  it("leaves icons without color-scheme queries untouched", () => {
    const svg = adaptive(":root{color:#fff}");
    expect(resolveSvgColorScheme(svg, "dark")).toBe(svg);
  });
});

describe("resolveProjectFaviconColorScheme", () => {
  it("re-encodes inline SVG icons and passes other sources through", () => {
    const url = `data:image/svg+xml;base64,${Encoding.encodeBase64(ADAPTIVE_SVG)}`;
    const resolved = resolveProjectFaviconColorScheme(url, "dark");
    expect(resolved).toBe(
      `data:image/svg+xml;base64,${Encoding.encodeBase64(resolveSvgColorScheme(ADAPTIVE_SVG, "dark"))}`,
    );
    for (const other of ["data:image/png;base64,AAAA", "https://remote.test/icon.svg"]) {
      expect(resolveProjectFaviconColorScheme(other, "dark")).toBe(other);
    }
  });
});
