import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  useNativeRenderer: false,
  resources: [] as Array<unknown>,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <Value,>(value: Value) => value,
  useEffect: () => {},
  useMemo: <Value,>(factory: () => Value) => factory(),
  useState: <Value,>(initial: Value | (() => Value)) => [
    typeof initial === "function" ? (initial as () => Value)() : initial,
    vi.fn(),
  ],
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { absoluteFill: {} },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-gesture-handler", () => ({ TouchableOpacity: "TouchableOpacity" }));
vi.mock("react-native-nitro-markdown", () => ({
  Markdown: (props: {
    readonly children: string;
    readonly renderers: {
      readonly image: (input: {
        readonly node: { readonly href: string; readonly alt: string; readonly title: null };
      }) => ReactNode;
    };
  }) => {
    const image = markdownImage(props.children);
    return image === null ? null : props.renderers.image({ node: image });
  },
}));
vi.mock("../../components/AppText", () => ({ AppText: "Text" }));
vi.mock("../../lib/openExternalUrl", () => ({ tryOpenExternalUrl: vi.fn() }));
vi.mock("../../lib/useFontFamily", () => ({ useFontFamily: () => "System" }));
vi.mock("../../lib/useUniwindTheme", () => ({
  useUniwindTheme: () => new Proxy<Record<string, string>>({}, { get: () => "#000000" }),
}));
vi.mock("../../native/SelectableMarkdownText", () => ({
  hasNativeSelectableMarkdownText: () => testState.useNativeRenderer,
  SelectableMarkdownText: (props: {
    readonly markdown: string;
    readonly renderImage: (image: {
      readonly href: string;
      readonly alt: string | null;
      readonly title: string | null;
    }) => ReactNode;
  }) => {
    const image = markdownImage(props.markdown);
    return image === null ? null : props.renderImage(image);
  },
}));
vi.mock("../../state/assets", () => ({
  useAssetUrlState: (_environmentId: unknown, resource: unknown) => {
    testState.resources.push(resource);
    return { _tag: "Success", url: "https://signed.test/diagram.png" };
  },
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ appearance: { baseFontSize: 14 } }),
}));

import { FileMarkdownPreview } from "./FileMarkdownPreview";

function markdownImage(markdown: string): {
  readonly href: string;
  readonly alt: string;
  readonly title: null;
} | null {
  const match = /!\[([^\]]*)]\(([^)]+)\)/.exec(markdown);
  return match?.[2] ? { href: match[2], alt: match[1] ?? "", title: null } : null;
}

function renderTree(node: ReactNode): void {
  if (Array.isArray(node)) {
    node.forEach(renderTree);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function") {
    const render = element.type as (props: Record<string, unknown>) => ReactNode;
    renderTree(render(element.props));
    return;
  }
  renderTree(element.props.children as ReactNode);
}

function renderPreview(input: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly markdown: string;
}): void {
  renderTree(
    FileMarkdownPreview({
      cwd: input.cwd,
      relativePath: input.relativePath,
      markdown: input.markdown,
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    }),
  );
}

describe.each([
  ["native iOS", true],
  ["JavaScript fallback", false],
])("FileMarkdownPreview workspace images with the %s renderer", (_label, useNativeRenderer) => {
  beforeEach(() => {
    testState.useNativeRenderer = useNativeRenderer;
    testState.resources = [];
  });

  it.each([
    ["/workspace/project", "README.md", "/workspace/project/images/diagram.png"],
    ["/workspace/project", "docs/README.md", "/workspace/project/docs/images/diagram.png"],
    [
      "C:\\Users\\dara\\project",
      "docs\\README.md",
      "C:\\Users\\dara\\project\\docs\\images\\diagram.png",
    ],
  ])("requests an image relative to %s and %s", (cwd, relativePath, expectedPath) => {
    renderPreview({
      cwd,
      relativePath,
      markdown: "![diagram](images/diagram.png)",
    });

    expect(testState.resources).toEqual([
      {
        _tag: "workspace-file",
        threadId: ThreadId.make("thread-1"),
        path: expectedPath,
      },
    ]);
  });

  it("leaves remote images with the renderer that already handles them", () => {
    renderPreview({
      cwd: "/workspace/project",
      relativePath: "docs/README.md",
      markdown: "![remote](https://example.com/diagram.png)",
    });

    expect(testState.resources).toEqual([]);
  });
});
