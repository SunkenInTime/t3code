import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionProfile,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  ConnectionCatalogDocument as RuntimeConnectionCatalogDocument,
  type ConnectionCatalogDocument as RuntimeConnectionCatalogDocumentType,
} from "@t3tools/client-runtime/platform";
import type { PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopSavedEnvironments from "../settings/DesktopSavedEnvironments.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const EncryptedConnectionCatalogDocument = Schema.Struct({
  version: Schema.Literal(1),
  encryptedCatalog: Schema.String,
});
type EncryptedConnectionCatalogDocument = typeof EncryptedConnectionCatalogDocument.Type;

const EncryptedConnectionCatalogDocumentJson = fromLenientJson(EncryptedConnectionCatalogDocument);
const decodeCatalogFileJson = Schema.decodeEffect(fromLenientJson(Schema.Unknown));
const decodeEncryptedConnectionCatalogDocument = Schema.decodeUnknownEffect(
  EncryptedConnectionCatalogDocument,
);
const encodeEncryptedConnectionCatalogDocumentJson = Schema.encodeEffect(
  EncryptedConnectionCatalogDocumentJson,
);
const RuntimeConnectionCatalogDocumentJson = Schema.fromJsonString(
  RuntimeConnectionCatalogDocument,
);
const encodeRuntimeConnectionCatalogDocumentJson = Schema.encodeEffect(
  RuntimeConnectionCatalogDocumentJson,
);

const DesktopConnectionCatalogStoreWriteOperation = Schema.Literals([
  "create-temporary-file-name",
  "encode-document",
  "create-directory",
  "write-temporary-file",
  "sync-temporary-file",
  "replace-catalog-file",
]);

const DesktopConnectionCatalogStoreMigrationOperation = Schema.Literals([
  "read-legacy-registry",
  "read-legacy-secret",
  "encode-catalog",
  "persist-catalog",
]);

const DesktopConnectionCatalogStoreProtectionOperation = Schema.Literals([
  "check-encryption-availability",
  "encrypt-catalog",
  "decrypt-catalog",
]);

export class DesktopConnectionCatalogStoreWriteError extends Schema.TaggedError<DesktopConnectionCatalogStoreWriteError>()(
  "DesktopConnectionCatalogStoreWriteError",
  {
    operation: DesktopConnectionCatalogStoreWriteOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop connection catalog write failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopConnectionCatalogStoreDecodeError extends Schema.TaggedError<DesktopConnectionCatalogStoreDecodeError>()(
  "DesktopConnectionCatalogStoreDecodeError",
  {
    resource: Schema.Literal("encryptedCatalog"),
    catalogPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode ${this.resource} for the desktop connection catalog at ${this.catalogPath}.`;
  }
}

export class DesktopConnectionCatalogStoreReadError extends Schema.TaggedError<DesktopConnectionCatalogStoreReadError>()(
  "DesktopConnectionCatalogStoreReadError",
  {
    catalogPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read the desktop connection catalog at ${this.catalogPath}.`;
  }
}

export class DesktopConnectionCatalogStoreDocumentDecodeError extends Schema.TaggedError<DesktopConnectionCatalogStoreDocumentDecodeError>()(
  "DesktopConnectionCatalogStoreDocumentDecodeError",
  {
    catalogPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode the desktop connection catalog document at ${this.catalogPath}.`;
  }
}

export class DesktopConnectionCatalogStoreMigrationError extends Schema.TaggedError<DesktopConnectionCatalogStoreMigrationError>()(
  "DesktopConnectionCatalogStoreMigrationError",
  {
    operation: DesktopConnectionCatalogStoreMigrationOperation,
    catalogPath: Schema.String,
    environmentId: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const environment =
      this.environmentId === undefined ? "" : ` for environment ${this.environmentId}`;
    return `Legacy desktop saved-environment migration failed during ${this.operation}${environment} into ${this.catalogPath}.`;
  }
}

export class DesktopConnectionCatalogStoreProtectionError extends Schema.TaggedError<DesktopConnectionCatalogStoreProtectionError>()(
  "DesktopConnectionCatalogStoreProtectionError",
  {
    operation: DesktopConnectionCatalogStoreProtectionOperation,
    catalogPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop connection catalog protection failed during ${this.operation} at ${this.catalogPath}.`;
  }
}

export class DesktopConnectionCatalogStore extends Context.Service<
  DesktopConnectionCatalogStore,
  {
    readonly get: Effect.Effect<
      Option.Option<string>,
      | DesktopConnectionCatalogStoreReadError
      | DesktopConnectionCatalogStoreDocumentDecodeError
      | DesktopConnectionCatalogStoreWriteError
      | DesktopConnectionCatalogStoreDecodeError
      | DesktopConnectionCatalogStoreMigrationError
      | DesktopConnectionCatalogStoreProtectionError
    >;
    readonly set: (
      catalog: string,
    ) => Effect.Effect<
      boolean,
      DesktopConnectionCatalogStoreWriteError | DesktopConnectionCatalogStoreProtectionError
    >;
    readonly clear: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopConnectionCatalogStore") {}

function decodeSecretBytes(
  catalogPath: string,
  encoded: string,
): Effect.Effect<Uint8Array, DesktopConnectionCatalogStoreDecodeError> {
  return Effect.fromResult(Base64.decode(encoded)).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopConnectionCatalogStoreDecodeError({
          resource: "encryptedCatalog",
          catalogPath,
          cause,
        }),
    ),
  );
}

const readCatalogFile = (
  fileSystem: FileSystem.FileSystem,
  catalogPath: string,
): Effect.Effect<Uint8Array | null, DesktopConnectionCatalogStoreReadError> =>
  fileSystem.readFile(catalogPath).pipe(
    Effect.catch((error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed<Uint8Array | null>(null)
        : Effect.fail(
            new DesktopConnectionCatalogStoreReadError({
              catalogPath,
              cause: error,
            }),
          ),
    ),
  );

const writeDocument = Effect.fn("desktop.connectionCatalogStore.writeDocument")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly filePath: string;
  readonly contents: Uint8Array;
  readonly suffix: string;
}): Effect.fn.Return<void, DesktopConnectionCatalogStoreWriteError> {
  const directory = input.path.dirname(input.filePath);
  const tempPath = `${input.filePath}.${process.pid}.${input.suffix}.tmp`;
  yield* input.fileSystem.makeDirectory(directory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopConnectionCatalogStoreWriteError({
          operation: "create-directory",
          path: directory,
          cause,
        }),
    ),
  );
  yield* Effect.gen(function* () {
    yield* input.fileSystem.writeFile(tempPath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreWriteError({
            operation: "write-temporary-file",
            path: tempPath,
            cause,
          }),
      ),
    );
    // Without a flush, a power cut after the rename can leave NTFS with the new
    // size but none of the data. Windows only flushes a handle opened for writing.
    yield* input.fileSystem.open(tempPath, { flag: "r+" }).pipe(
      Effect.flatMap((file) => file.sync),
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreWriteError({
            operation: "sync-temporary-file",
            path: tempPath,
            cause,
          }),
      ),
    );
    yield* input.fileSystem.rename(tempPath, input.filePath).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreWriteError({
            operation: "replace-catalog-file",
            path: input.filePath,
            cause,
          }),
      ),
    );
  }).pipe(
    Effect.ensuring(
      input.fileSystem.remove(tempPath, { force: true }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not remove a temporary connection catalog file.", {
            tempPath,
            error,
          }),
        ),
      ),
    ),
  );
});

function connectionId(prefix: "bearer" | "ssh", environmentId: string): string {
  return `${prefix}:${environmentId}`;
}

const migrateSavedEnvironmentRecords = Effect.fn(
  "desktop.connectionCatalogStore.migrateSavedEnvironmentRecords",
)(function* (
  records: readonly PersistedSavedEnvironmentRecord[],
  savedEnvironments: DesktopSavedEnvironments.DesktopSavedEnvironments["Service"],
  catalogPath: string,
): Effect.fn.Return<
  RuntimeConnectionCatalogDocumentType,
  DesktopConnectionCatalogStoreMigrationError
> {
  const targets: Array<RuntimeConnectionCatalogDocumentType["targets"][number]> = [];
  const profiles: Array<RuntimeConnectionCatalogDocumentType["profiles"][number]> = [];
  const credentials: Array<RuntimeConnectionCatalogDocumentType["credentials"][number]> = [];

  for (const record of records) {
    if (record.relayManaged !== undefined) {
      targets.push(
        new RelayConnectionTarget({
          environmentId: record.environmentId,
          label: record.label,
        }),
      );
      continue;
    }

    if (record.desktopSsh !== undefined) {
      const id = connectionId("ssh", record.environmentId);
      targets.push(
        new SshConnectionTarget({
          environmentId: record.environmentId,
          label: record.label,
          connectionId: id,
        }),
      );
      profiles.push(
        new SshConnectionProfile({
          connectionId: id,
          environmentId: record.environmentId,
          label: record.label,
          target: record.desktopSsh,
        }),
      );
      continue;
    }

    const id = connectionId("bearer", record.environmentId);
    targets.push(
      new BearerConnectionTarget({
        environmentId: record.environmentId,
        label: record.label,
        connectionId: id,
      }),
    );
    profiles.push(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: record.environmentId,
        label: record.label,
        httpBaseUrl: record.httpBaseUrl,
        wsBaseUrl: record.wsBaseUrl,
      }),
    );
    const token = yield* savedEnvironments.getSecret(record.environmentId).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreMigrationError({
            operation: "read-legacy-secret",
            catalogPath,
            environmentId: record.environmentId,
            cause,
          }),
      ),
    );
    if (Option.isSome(token)) {
      credentials.push({
        connectionId: id,
        credential: new BearerConnectionCredential({ token: token.value }),
      });
    }
  }

  return {
    schemaVersion: 1,
    targets,
    profiles,
    credentials,
    remoteDpopTokens: [],
    disabledEnvironmentIds: [],
  };
});

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const crypto = yield* Crypto.Crypto;
  const savedEnvironments = yield* DesktopSavedEnvironments.DesktopSavedEnvironments;
  const catalogPath = path.join(environment.stateDir, "connection-catalog.json");
  const encryptionAvailable = safeStorage.isEncryptionAvailable.pipe(
    Effect.mapError(
      (cause) =>
        new DesktopConnectionCatalogStoreProtectionError({
          operation: "check-encryption-availability",
          catalogPath,
          cause,
        }),
    ),
  );

  const randomFileSuffix = crypto.randomUUIDv4().pipe(
    Effect.map((uuid) => uuid.replace(/-/g, "")),
    Effect.mapError(
      (cause) =>
        new DesktopConnectionCatalogStoreWriteError({
          operation: "create-temporary-file-name",
          path: catalogPath,
          cause,
        }),
    ),
  );

  const writeCatalog = Effect.fn("desktop.connectionCatalogStore.writeCatalog")(function* (
    catalog: string,
  ) {
    const encryptedCatalog = Base64.encode(
      yield* safeStorage.encryptString(catalog).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopConnectionCatalogStoreProtectionError({
              operation: "encrypt-catalog",
              catalogPath,
              cause,
            }),
        ),
      ),
    );
    const suffix = yield* randomFileSuffix;
    const encoded = yield* encodeEncryptedConnectionCatalogDocumentJson({
      version: 1,
      encryptedCatalog,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreWriteError({
            operation: "encode-document",
            path: catalogPath,
            cause,
          }),
      ),
    );
    yield* writeDocument({
      fileSystem,
      path,
      filePath: catalogPath,
      contents: new TextEncoder().encode(`${encoded}\n`),
      suffix,
    });
  });

  const migrateLegacyCatalog = Effect.gen(function* () {
    if (!(yield* encryptionAvailable)) {
      return Option.none<string>();
    }
    const records = yield* savedEnvironments.getRegistry.pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreMigrationError({
            operation: "read-legacy-registry",
            catalogPath,
            cause,
          }),
      ),
    );
    if (records.length === 0) {
      return Option.none<string>();
    }
    const catalog = yield* migrateSavedEnvironmentRecords(records, savedEnvironments, catalogPath);
    const encoded = yield* encodeRuntimeConnectionCatalogDocumentJson(catalog).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreMigrationError({
            operation: "encode-catalog",
            catalogPath,
            cause,
          }),
      ),
    );
    yield* writeCatalog(encoded).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopConnectionCatalogStoreMigrationError({
            operation: "persist-catalog",
            catalogPath,
            cause,
          }),
      ),
    );
    return Option.some(encoded);
  });

  // The copy is named by its content, so a relaunch over the same file
  // rewrites the same copy, which also repairs one a crash left partial.
  const backUpDamagedCatalog = Effect.fn("desktop.connectionCatalogStore.backUpDamagedCatalog")(
    function* (bytes: Uint8Array) {
      const digest = yield* crypto.digest("SHA-256", bytes).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopConnectionCatalogStoreWriteError({
              operation: "create-temporary-file-name",
              path: catalogPath,
              cause,
            }),
        ),
      );
      const backupPath = `${catalogPath}.corrupt.${Hex.encode(digest).slice(0, 16)}`;
      yield* writeDocument({
        fileSystem,
        path,
        filePath: backupPath,
        contents: bytes,
        suffix: yield* randomFileSuffix,
      });
      yield* Effect.logWarning("The desktop connection catalog is not JSON; starting without it.", {
        catalogPath,
        backupPath,
      });
    },
  );

  return DesktopConnectionCatalogStore.of({
    get: Effect.gen(function* () {
      const bytes = yield* readCatalogFile(fileSystem, catalogPath);
      if (bytes === null) {
        return yield* migrateLegacyCatalog;
      }
      const json = yield* Effect.result(decodeCatalogFileJson(new TextDecoder().decode(bytes)));
      if (json._tag === "Failure") {
        // Not JSON at all, as after a power cut: NUL-filled, empty or cut short.
        // Start without a catalog but leave the file for the next save to
        // replace, and don't migrate: that would write over a save another
        // app instance may have just made. JSON that fails the schema below,
        // like a newer app's version, keeps failing since its ciphertext may
        // still be readable.
        yield* backUpDamagedCatalog(bytes);
        return Option.none<string>();
      }
      const document = yield* decodeEncryptedConnectionCatalogDocument(json.success).pipe(
        Effect.mapError(
          (cause) => new DesktopConnectionCatalogStoreDocumentDecodeError({ catalogPath, cause }),
        ),
      );
      if (!(yield* encryptionAvailable)) {
        return Option.none<string>();
      }
      const decrypted = yield* decodeSecretBytes(catalogPath, document.encryptedCatalog).pipe(
        Effect.flatMap((encryptedCatalog) =>
          safeStorage.decryptString(encryptedCatalog).pipe(
            Effect.mapError(
              (cause) =>
                new DesktopConnectionCatalogStoreProtectionError({
                  operation: "decrypt-catalog",
                  catalogPath,
                  cause,
                }),
            ),
          ),
        ),
      );
      return Option.some(decrypted);
    }).pipe(Effect.withSpan("desktop.connectionCatalogStore.get")),
    set: Effect.fn("desktop.connectionCatalogStore.set")(function* (catalog) {
      if (!(yield* encryptionAvailable)) {
        return false;
      }
      yield* writeCatalog(catalog);
      return true;
    }),
    clear: fileSystem.remove(catalogPath, { force: true }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not clear the desktop connection catalog.", {
          catalogPath,
          error,
        }),
      ),
      Effect.withSpan("desktop.connectionCatalogStore.clear"),
    ),
  });
});

export const layer = Layer.effect(DesktopConnectionCatalogStore, make);
