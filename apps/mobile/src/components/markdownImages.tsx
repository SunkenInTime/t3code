import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View, type ViewStyle } from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";

import { useAssetUrlState } from "../state/assets";
import {
  MARKDOWN_IMAGE_MAX_WIDTH,
  resolveMarkdownImageDisplaySize,
} from "../features/threads/markdownImageSize";
import { AppText as Text } from "./AppText";

export function ThreadMarkdownImageView(props: {
  readonly uri: string | null;
  readonly sourceKey: string;
  readonly unavailable: boolean;
  readonly alt: string | null;
  readonly onPressImage?: ((uri: string) => void) | undefined;
}) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);

  useEffect(() => {
    setSourceSize(null);
  }, [props.sourceKey]);

  useEffect(() => {
    setFailedUri(null);
  }, [props.uri]);

  const displaySize =
    sourceSize === null
      ? null
      : resolveMarkdownImageDisplaySize({
          sourceWidth: sourceSize.width,
          sourceHeight: sourceSize.height,
          availableWidth,
        });
  const failed = props.unavailable || (props.uri !== null && failedUri === props.uri);
  const placeholderWidth: ViewStyle["width"] =
    availableWidth > 0 ? Math.min(availableWidth, MARKDOWN_IMAGE_MAX_WIDTH) : "100%";
  const frameStyle: ViewStyle = displaySize ?? { width: placeholderWidth, aspectRatio: 16 / 9 };

  const image =
    props.uri === null || failed ? (
      <View
        className="items-center justify-center rounded-[10px] bg-md-code-bg"
        style={{
          ...frameStyle,
        }}
      >
        {failed ? (
          <Text className="text-xs text-foreground-muted">Image unavailable</Text>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    ) : (
      <View
        className="items-center justify-center overflow-hidden rounded-[10px] bg-md-code-bg"
        style={{
          ...frameStyle,
        }}
      >
        <ThreadMarkdownImageRequest
          key={props.uri}
          uri={props.uri}
          onLoad={setSourceSize}
          onError={() => setFailedUri(props.uri)}
        />
      </View>
    );

  return (
    <View
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      style={{ alignSelf: "stretch", gap: 6 }}
    >
      {props.uri !== null && !failed && props.onPressImage ? (
        <TouchableOpacity
          accessibilityRole="imagebutton"
          accessibilityLabel={props.alt ?? "Markdown image"}
          activeOpacity={0.7}
          onPress={() => props.onPressImage?.(props.uri!)}
          style={{ alignSelf: "flex-start" }}
        >
          {image}
        </TouchableOpacity>
      ) : (
        image
      )}
      {props.alt ? (
        <Text selectable className="text-xs text-foreground-muted">
          {props.alt}
        </Text>
      ) : null}
    </View>
  );
}

function ThreadMarkdownImageRequest(props: {
  readonly uri: string;
  readonly onLoad: (sourceSize: { width: number; height: number }) => void;
  readonly onError: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <Image
        source={{ uri: props.uri }}
        resizeMode="contain"
        accessible={false}
        onLoad={(event) => {
          setLoaded(true);
          props.onLoad(event.nativeEvent.source);
        }}
        onError={props.onError}
        style={{ width: "100%", height: "100%", opacity: loaded ? 1 : 0 }}
      />
      {loaded ? null : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
        >
          <Text className="text-xs text-foreground-muted">Loading image…</Text>
        </View>
      )}
    </>
  );
}

/** Markdown image whose src is a workspace file. It loads through a signed asset URL. */
export function ThreadMarkdownImage(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly path: string;
  readonly alt: string | null;
  readonly onPressImage?: ((uri: string) => void) | undefined;
}) {
  const assetUrl = useAssetUrlState(props.environmentId, {
    _tag: "workspace-file",
    threadId: props.threadId,
    path: props.path,
  });

  return (
    <ThreadMarkdownImageView
      uri={assetUrl._tag === "Success" ? assetUrl.url : null}
      sourceKey={props.path}
      unavailable={assetUrl._tag === "Failure"}
      alt={props.alt}
      onPressImage={props.onPressImage}
    />
  );
}

export function ThreadMarkdownImageUnavailable(props: { readonly alt: string | null }) {
  return <ThreadMarkdownImageView uri={null} sourceKey="unavailable" unavailable alt={props.alt} />;
}
