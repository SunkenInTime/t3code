import type { ToolActivityIcon, ToolActivitySource } from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";

export function normalizeMcpText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/gu, " ");
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

export function normalizeMcpHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= 4096
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

// Demo build: servers whose calls should read as the sponsor's product on camera.
// Logos are bundled so the work log renders them without an external request.
const BRANDED_MCP_SERVERS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly name: string;
  readonly icon: ToolActivityIcon;
}> = [
  {
    pattern: /^apify(?:[-_]mcp)?$/iu,
    name: "Apify MCP",
    // Official Apify mark from https://apify.com/icon2.png.
    icon: {
      _tag: "themed-logo",
      logoUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAHjSURBVHgBvZZNTsJAHMX/r+DHkiPgwj1H0Bt4AL9Y6BpPYDmBxaCJbCQx7hs9AL2BLE3EOEdgBQGh4wwJEYaW+U+1PFL6Nen78d6UFqRUfj6qUEwlcpA4CaPF/f2arEhyu0YvQITy09EBUdwhV028PVENhd4s12SpOKUvcgQgSYceZVFM9bm5lgjQ18cog9wBJIQ4e/HNw707BGoVkaPcAYBq2qligaqUM0DDnHyLeg8gCG5V8AFU9Gri+bZhvVv4CqJLTDkkAD3x+qyRE34VPACgLU7DNjH1cY+ulNTgjLUD6Oi/4XyLTYvkAyRs4xgJYOme50r/N8jYXsV6AMfoTfWaiGxVpANkjN6UrYo1CWSL3pStimSAP0Zval0VqwD/FL2ptCoSEuBHP7rcvlbLm6yVrI/htCqWATyE3Oi1uXoB8dVSGQ8GHQ5EUhULAOqZPsYVMTQ3n++7QOgq1Kq/CoCYFb1p7goxq0L+VuGpj6JR0R+/BpTRfAliOLghiz6bCOdVgJiymS9Kzfb2zsOY9URkAbiYu0JYAbKYu0AgL3MuBPI050B4eZtrqRl/rq+ZdA55mxtm/k5rXDeObcY8DQKbNE+CmAEML7bOATzSRoWr3dYoKM62C4VI/fpD2qyE/voBY3kBoumhLtkAAAAASUVORK5CYII=",
    },
  },
];

export function mcpToolPresentation(input: {
  readonly toolName?: unknown;
  readonly serverName?: unknown;
  readonly title?: unknown;
  readonly serverDisplayName?: unknown;
  readonly iconUrl?: unknown;
  readonly iconUrlDark?: unknown;
  readonly source?: unknown;
}): {
  readonly title?: string;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
} {
  const source =
    typeof input.source === "object" && input.source !== null ? input.source : undefined;
  const qualified =
    typeof input.toolName === "string" ? /^mcp__(.+?)__(.+)$/i.exec(input.toolName) : null;
  const server = normalizeMcpText(input.serverName ?? qualified?.[1] ?? input.serverDisplayName);
  const tool = normalizeMcpText(qualified?.[2] ?? input.toolName);
  if (server && tool && resolveT3McpToolDefinition(`${server}.${tool}`)) return {};
  const brand = server
    ? BRANDED_MCP_SERVERS.find((entry) => entry.pattern.test(server))
    : undefined;
  const title =
    normalizeMcpText(input.title) ??
    (brand && tool ? `${brand.name} · ${tool}` : undefined) ??
    (server && tool ? normalizeMcpText(tool.replace(/[_-]+/gu, " ")) : undefined);
  if (!server) return title ? { title } : {};
  const name =
    brand?.name ??
    normalizeMcpText(input.serverDisplayName) ??
    normalizeMcpText(source && Reflect.get(source, "name")) ??
    normalizeMcpText(server.replace(/[_-]+/gu, " ")) ??
    server;
  const logoUrl =
    normalizeMcpHttpUrl(input.iconUrl) ??
    normalizeMcpHttpUrl(source && Reflect.get(source, "logoUrl"));
  const logoUrlDark =
    normalizeMcpHttpUrl(input.iconUrlDark) ??
    normalizeMcpHttpUrl(source && Reflect.get(source, "logoUrlDark"));
  const icon =
    brand?.icon ??
    (logoUrl
      ? { _tag: "themed-logo" as const, logoUrl, ...(logoUrlDark ? { logoUrlDark } : {}) }
      : undefined);
  return {
    ...(title ? { title } : {}),
    ...(icon ? { toolIcon: icon } : {}),
    toolSource: {
      key: `mcp:${server.toLowerCase()}`,
      name,
      kind: "integration",
      ...(icon ? { icon } : {}),
    },
  };
}
