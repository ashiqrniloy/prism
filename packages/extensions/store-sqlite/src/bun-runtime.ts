import type { Database } from "bun:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ponytail: require() not static import — Node turns `import "bun:sqlite"` into ERR_UNSUPPORTED_ESM_URL_SCHEME before this message. Delete the seam when a non-Bun import is no longer a supported failure.
function loadBunSqlite(): new (filename: string) => Database {
  try {
    const ctor = require("bun:sqlite").Database;
    if (typeof ctor !== "function") throw new Error("bun:sqlite did not export Database");
    return ctor;
  } catch (error) {
    throw new Error("@arnilo/prism-extensions/store-sqlite requires the Bun runtime (bun:sqlite).", { cause: error });
  }
}

export const BunSqlite = loadBunSqlite();
