import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";

const SVG_DATA_URL_PREFIX = "data:image/svg+xml;base64,";
const STYLE_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const MEDIA_RE = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/gi;
const COLOR_SCHEME_QUERY_RE = /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/i;
// Rules start after the previous one, so trailing text is scanned once.
const RULE_RE = /(?<=^|\})([^{}]*)\{([^{}]*)\}/g;
const ROOT_COLOR_ATTRIBUTE_RE = /^<svg\b[^>]*?\scolor\s*=\s*["']([^"']*)["']/i;
const INLINE_COLOR_RE = /\s(?:color\s*=|style\s*=\s*["'][^"']*(?<![-\w])color\s*:)/gi;
const PAINT_ATTRIBUTE_RE =
  /(\s(?:fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*["'])\s*currentColor\s*(["'])/gi;
const STYLE_ATTRIBUTE_RE = /(\sstyle\s*=\s*(["']))([\s\S]*?)(\2)/gi;
const PAINT_DECLARATION_RE =
  /((?:^|[;{\s])(?:fill|stroke|stop-color|flood-color|lighting-color)\s*:\s*)currentColor(?=\s*(?:!important\s*)?(?:[;}]|$))/gi;

/**
 * Native SVG decoders ignore `prefers-color-scheme` media queries, and CoreSVG
 * also ignores `currentColor`, so an adaptive icon keeps its light colors in dark
 * mode. This bakes the app's scheme into the common pattern: color-scheme media
 * queries plus a root `color` used through `currentColor`. Stylesheets outside
 * that shape are returned unchanged.
 */
export function resolveSvgColorScheme(svg: string, scheme: "light" | "dark"): string {
  let adaptive = false;
  let supported = true;
  const resolved = svg.replace(STYLE_RE, (_, open: string, css: string, close: string) => {
    const flat = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(MEDIA_RE, (_media, query: string, body: string) => {
        const match = COLOR_SCHEME_QUERY_RE.exec(query.trim());
        if (match) adaptive = true;
        else supported = false;
        return match?.[1]?.toLowerCase() === scheme ? body : "";
      });
    if (flat.includes("@") || flat.includes("<![CDATA[") || flat.includes("&")) supported = false;
    return open + flat + close;
  });
  // One root color can only stand in for currentColor in a single <svg>.
  if (!adaptive || !supported || (resolved.match(/<svg\b/gi)?.length ?? 0) > 1) return svg;

  // `:root` outranks `svg`, and both outrank the root's `color` attribute.
  const rootColors: { ":root"?: string; svg?: string } = {};
  for (const style of resolved.matchAll(STYLE_RE)) {
    for (const [, selectors = "", declarations = ""] of (style[2] ?? "").matchAll(RULE_RE)) {
      for (const declaration of declarations.split(";")) {
        const [property = "", ...value] = declaration.split(":");
        if (property.trim().toLowerCase() !== "color") continue;
        const color = value.join(":").trim();
        if (color.includes("!")) return svg;
        for (const selector of selectors.split(",")) {
          const key = selector.trim().toLowerCase();
          if (key !== ":root" && key !== "svg") return svg;
          rootColors[key] = color;
        }
      }
    }
  }
  const svgTag = resolved.slice(Math.max(0, resolved.search(/<svg\b/i)));
  const attributeColor = ROOT_COLOR_ATTRIBUTE_RE.exec(svgTag)?.[1]?.trim();
  if ([...resolved.matchAll(INLINE_COLOR_RE)].length > (attributeColor ? 1 : 0)) return svg;

  const color = rootColors[":root"] ?? rootColors.svg ?? attributeColor;
  if (!color || /^(?:currentcolor|inherit|initial|unset|revert)$/i.test(color)) return resolved;
  const bakeCss = (css: string) => css.replace(PAINT_DECLARATION_RE, `$1${color}`);
  return resolved
    .replace(PAINT_ATTRIBUTE_RE, `$1${color}$2`)
    .replace(STYLE_RE, (_, open: string, css: string, close: string) => open + bakeCss(css) + close)
    .replace(
      STYLE_ATTRIBUTE_RE,
      (_, open: string, _quote: string, css: string, close: string) => open + bakeCss(css) + close,
    );
}

/** Applies `resolveSvgColorScheme` to an inline SVG icon; other sources pass through. */
export function resolveProjectFaviconColorScheme(url: string, scheme: "light" | "dark"): string {
  if (!url.startsWith(SVG_DATA_URL_PREFIX)) return url;
  const decoded = Encoding.decodeBase64String(url.slice(SVG_DATA_URL_PREFIX.length));
  if (Result.isFailure(decoded)) return url;
  const resolved = resolveSvgColorScheme(decoded.success, scheme);
  return resolved === decoded.success ? url : SVG_DATA_URL_PREFIX + Encoding.encodeBase64(resolved);
}
