// C6 sealed-data filesystem guard (hermetic offline tests).
// Rejects reads, listings, copies and opens under sealed roots BEFORE
// touching disk, in-process and in spawned node subprocesses (via NODE_OPTIONS).
// Leaves stat/lstat untouched.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..", "..");
const ownPath = join(here, "sealed-guard.mjs");

const sealedDirs = [
  join(repo, "services", "bot", "fixtures", "holdout-v1"),
  join(repo, "eval", "heldout"),
  resolve("/workspace/heldout-sealed"),
];
const sealedFilePrefixes = [
  join(repo, "eval", "heldout-presealed.sha256"),
  join(repo, "eval", "shield-heldout.sha256"),
];

function toPathString(p) {
  if (typeof p === "string") return p;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(p)) return p.toString();
  if (p instanceof URL) {
    try {
      return fileURLToPath(p);
    } catch {
      return null;
    }
  }
  return null;
}

function normalized(p) {
  const s = toPathString(p);
  if (s === null) return null;
  try {
    return resolve(s);
  } catch {
    return null;
  }
}

export function isSealedPath(p) {
  const r = normalized(p);
  if (r === null) return false;
  for (const d of sealedDirs) {
    if (r === d || r.startsWith(d + sep)) return true;
  }
  for (const prefix of sealedFilePrefixes) {
    if (r === prefix || r.startsWith(prefix)) return true;
  }
  return false;
}

function sealedError(p) {
  const err = new Error(`sealed data access forbidden: ${String(toPathString(p) ?? p)}`);
  err.code = "SEALED_ACCESS";
  return err;
}

function checkOne(p) {
  if (isSealedPath(p)) throw sealedError(p);
}

function checkTwo(src, dest) {
  if (isSealedPath(src)) throw sealedError(src);
  if (isSealedPath(dest)) throw sealedError(dest);
}

function isCallback(v) {
  return typeof v === "function";
}

// Callback-style async fs fn: fail via callback when one is present,
// otherwise throw synchronously (mirrors Node's sync validation).
function guardFirstArgCallback(orig) {
  return function guarded(...args) {
    if (args.length > 0 && isSealedPath(args[0])) {
      const err = sealedError(args[0]);
      const last = args[args.length - 1];
      if (isCallback(last)) {
        process.nextTick(() => last(err));
        return undefined;
      }
      throw err;
    }
    return orig.apply(this, args);
  };
}

function guardCopyCallback(orig) {
  return function guarded(src, dest, ...rest) {
    if (isSealedPath(src) || isSealedPath(dest)) {
      const err = sealedError(isSealedPath(src) ? src : dest);
      const last = rest[rest.length - 1];
      if (isCallback(last)) {
        process.nextTick(() => last(err));
        return undefined;
      }
      throw err;
    }
    return orig.call(this, src, dest, ...rest);
  };
}

function guardSync(orig) {
  return function guarded(...args) {
    if (args.length > 0) checkOne(args[0]);
    return orig.apply(this, args);
  };
}

function guardCopySync(orig) {
  return function guarded(src, dest, ...rest) {
    checkTwo(src, dest);
    return orig.call(this, src, dest, ...rest);
  };
}

function guardPromiseFirstArg(orig) {
  return function guarded(...args) {
    if (args.length > 0 && isSealedPath(args[0])) return Promise.reject(sealedError(args[0]));
    return orig.apply(this, args);
  };
}

function guardPromiseCopy(orig) {
  return function guarded(src, dest, ...rest) {
    if (isSealedPath(src)) return Promise.reject(sealedError(src));
    if (isSealedPath(dest)) return Promise.reject(sealedError(dest));
    return orig.call(this, src, dest, ...rest);
  };
}

function guardStream(orig) {
  return function guarded(path, ...rest) {
    checkOne(path);
    return orig.call(this, path, ...rest);
  };
}

if (!globalThis.__sealedGuardInstalled) {
  // Sync reads / listings / copies / opens.
  fs.readFileSync = guardSync(fs.readFileSync);
  fs.readdirSync = guardSync(fs.readdirSync);
  fs.opendirSync = guardSync(fs.opendirSync);
  fs.cpSync = guardCopySync(fs.cpSync);
  fs.copyFileSync = guardCopySync(fs.copyFileSync);
  fs.openSync = guardSync(fs.openSync);
  // Callback-style async entry points.
  fs.readFile = guardFirstArgCallback(fs.readFile);
  fs.readdir = guardFirstArgCallback(fs.readdir);
  fs.opendir = guardFirstArgCallback(fs.opendir);
  fs.cp = guardCopyCallback(fs.cp);
  fs.copyFile = guardCopyCallback(fs.copyFile);
  fs.open = guardFirstArgCallback(fs.open);
  fs.createReadStream = guardStream(fs.createReadStream);
  // Promise entry points.
  fsp.readFile = guardPromiseFirstArg(fsp.readFile);
  fsp.readdir = guardPromiseFirstArg(fsp.readdir);
  fsp.opendir = guardPromiseFirstArg(fsp.opendir);
  fsp.cp = guardPromiseCopy(fsp.cp);
  fsp.copyFile = guardPromiseCopy(fsp.copyFile);
  fsp.open = guardPromiseFirstArg(fsp.open);
  try {
    syncBuiltinESMExports();
  } catch {
    /* older runtimes: named ESM bindings already share the CJS object */
  }
  globalThis.__sealedGuardInstalled = true;
}

// Propagate to spawned node subprocesses that inherit this env.
try {
  const flag = `--import ${ownPath}`;
  const cur = process.env["NODE_OPTIONS"] ?? "";
  if (!cur.includes(ownPath)) {
    process.env["NODE_OPTIONS"] = cur ? `${cur} ${flag}` : flag;
  }
} catch {
  /* env propagation is best-effort */
}
