import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const REQUIRED_FIXTURES = [];

const HEX40_RE = /^[0-9a-f]{40}$/;

function isExcludedName(name) {
  if (name === ".git") return true;
  if (name.startsWith(".env")) return true;
  if (name.endsWith(".pem")) return true;
  if (name.endsWith(".key")) return true;
  if (name.includes("secret")) return true;
  if (name === "eval") return true;
  if (name === "fixtures") return true;
  if (name === "test" || name === "tests") return true;
  if (name.startsWith("e2e")) return true;
  if (name === "node_modules") return true;
  if (name.endsWith(".test.js")) return true;
  if (name.endsWith(".map")) return true;
  if (name.endsWith(".d.ts")) return true;
  if (name.includes("heldout") || name.includes("holdout") || name.includes("sealed")) return true;
  return false;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function validateSourceSha(sha) {
  if (!HEX40_RE.test(sha)) {
    throw new Error("invalid --source-sha: must be 40 lowercase hex");
  }
}

function assertNotSymlink(absPath) {
  let st;
  try {
    st = fs.lstatSync(absPath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`symlink not allowed: ${absPath}`);
  }
  return st;
}

function walkAllowlistedDir(absDir, archivePrefix) {
  const results = [];
  const stack = [absDir];
  const prefixLen = absDir.length;
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      if (cur === absDir) throw e;
      continue;
    }
    for (const ent of entries) {
      if (isExcludedName(ent.name)) continue;
      const absPath = path.join(cur, ent.name);
      if (ent.isSymbolicLink()) {
        throw new Error(`symlink not allowed: ${absPath}`);
      }
      if (ent.isDirectory()) {
        stack.push(absPath);
      } else if (ent.isFile()) {
        if (!ent.name.endsWith(".js")) continue;
        const relInside = absPath.slice(prefixLen + 1).replace(/\\/g, "/");
        const archivePath = archivePrefix ? `${archivePrefix}/${relInside}` : relInside;
        // extra per-file excluded already handled via name check
        // also check lstat to catch symlink files that readdir type might miss on some fs
        const lst = fs.lstatSync(absPath);
        if (lst.isSymbolicLink()) throw new Error(`symlink not allowed: ${absPath}`);
        results.push({ sourceAbs: absPath, archivePath });
      }
    }
  }
  return results;
}

export function planRuntime(opts) {
  const repoRoot = path.resolve(opts.repoRoot);
  const sourceSha = opts.sourceSha;
  validateSourceSha(sourceSha);

  const plan = [];

  function requireFile(relPosix, archivePath) {
    const abs = path.join(repoRoot, relPosix);
    const st = assertNotSymlink(abs);
    if (!st || !st.isFile()) {
      throw new Error(`missing required file: ${relPosix}`);
    }
    plan.push({ sourceAbs: abs, archivePath });
  }

  function requireDir(relPosix) {
    const abs = path.join(repoRoot, relPosix);
    const st = assertNotSymlink(abs);
    if (!st || !st.isDirectory()) {
      throw new Error(`missing required directory: ${relPosix}`);
    }
    return abs;
  }

  // apps/web/package.json
  requireFile("apps/web/package.json", "apps/web/package.json");

  // apps/web/dist/src
  const webDistSrc = requireDir("apps/web/dist/src");
  const webFiles = walkAllowlistedDir(webDistSrc, "apps/web/dist/src");
  // require public-start.js exists
  const hasPublicStart = webFiles.some((e) => e.archivePath === "apps/web/dist/src/public-start.js");
  if (!hasPublicStart) {
    throw new Error("missing required file: apps/web/dist/src/public-start.js");
  }
  for (const e of webFiles) plan.push(e);

  // twin asset optional
  for (const twin of ["apps/web/public/ai-self.png", "apps/web/public/ai-self.jpg"]) {
    const abs = path.join(repoRoot, twin);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) throw new Error(`symlink not allowed: ${abs}`);
    if (st.isFile()) {
      plan.push({ sourceAbs: abs, archivePath: twin });
      break;
    }
  }

  // packages/core/package.json -> node_modules/@second-seat/core/package.json
  requireFile("packages/core/package.json", "node_modules/@second-seat/core/package.json");
  const coreDistSrc = requireDir("packages/core/dist/src");
  const coreFiles = walkAllowlistedDir(coreDistSrc, "node_modules/@second-seat/core/dist/src");
  for (const e of coreFiles) plan.push(e);

  // services/bot/package.json
  requireFile("services/bot/package.json", "node_modules/@second-seat/bot/package.json");
  const botDistSrc = requireDir("services/bot/dist/src");
  const botFiles = walkAllowlistedDir(botDistSrc, "node_modules/@second-seat/bot/dist/src");
  for (const e of botFiles) plan.push(e);

  // parser: resolve single symlink
  const parserLinkPath = path.join(repoRoot, "services/bot/node_modules/@meta-sam/parser");
  let parserReal;
  try {
    parserReal = fs.realpathSync(parserLinkPath);
  } catch {
    throw new Error("missing required parser package: services/bot/node_modules/@meta-sam/parser");
  }
  let parserStat;
  try { parserStat = fs.statSync(parserReal); } catch { throw new Error("missing required parser package"); }
  if (!parserStat.isDirectory()) throw new Error("missing required parser package");
  const parserPkgJson = path.join(parserReal, "package.json");
  const pSt = assertNotSymlink(parserPkgJson);
  if (!pSt || !pSt.isFile()) throw new Error("missing required parser package.json");
  const pkgRaw = fs.readFileSync(parserPkgJson, "utf8");
  let pkg;
  try { pkg = JSON.parse(pkgRaw); } catch { throw new Error("invalid parser package.json"); }
  if (pkg.name !== "@meta-sam/parser") throw new Error("parser package name mismatch");
  plan.push({ sourceAbs: parserPkgJson, archivePath: "node_modules/@meta-sam/parser/package.json" });
  const parserDist = path.join(parserReal, "dist");
  const pdSt = assertNotSymlink(parserDist);
  if (!pdSt || !pdSt.isDirectory()) throw new Error("missing required parser dist");
  const parserFiles = walkAllowlistedDir(parserDist, "node_modules/@meta-sam/parser/dist");
  for (const e of parserFiles) plan.push(e);

  // fixtures (currently empty)
  for (const f of REQUIRED_FIXTURES) {
    requireFile(f, f);
  }

  // sort by archivePath
  plan.sort((a, b) => a.archivePath.localeCompare(b.archivePath));

  // ensure no duplicates
  const seen = new Set();
  for (const e of plan) {
    if (seen.has(e.archivePath)) throw new Error(`duplicate archive path: ${e.archivePath}`);
    seen.add(e.archivePath);
  }

  return plan;
}

export function packRuntime(opts) {
  const repoRoot = path.resolve(opts.repoRoot);
  const outDir = path.resolve(opts.outDir);
  const sourceSha = opts.sourceSha;
  validateSourceSha(sourceSha);

  const plan = planRuntime({ repoRoot, sourceSha });

  // read file contents
  const entries = [];
  for (const item of plan) {
    const st = fs.lstatSync(item.sourceAbs);
    if (st.isSymbolicLink()) throw new Error(`symlink not allowed: ${item.sourceAbs}`);
    const buf = fs.readFileSync(item.sourceAbs);
    entries.push({
      path: item.archivePath,
      type: "file",
      content: buf.toString("base64"),
    });
  }

  const manifest = {
    sourceSha,
    plan: plan.map((p) => p.archivePath),
  };

  const artifact = { manifest, entries };
  const json = JSON.stringify(artifact);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"));

  fs.mkdirSync(outDir, { recursive: true });
  const name = `second-seat-runtime-${sourceSha.slice(0, 12)}.json.gz`;
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, gz);
  const sha256 = crypto.createHash("sha256").update(gz).digest("hex");
  const info = {
    name,
    size: gz.length,
    sha256,
    sourceSha,
    paths: plan.map((p) => p.archivePath),
  };
  return { outPath, info, plan };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--source-sha") args.sourceSha = argv[++i];
    else if (a === "--plan-only") args.planOnly = true;
    else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.repo || !args.out || !args.sourceSha) {
    console.error("usage: pack-runtime.mjs --repo <root> --out <dir> --source-sha <40hex> [--plan-only]");
    process.exit(1);
  }
  try {
    validateSourceSha(args.sourceSha);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  if (args.planOnly) {
    let plan;
    try {
      plan = planRuntime({ repoRoot: args.repo, sourceSha: args.sourceSha });
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    console.log(JSON.stringify(plan.map((p) => p.archivePath)));
    return;
  }
  let result;
  try {
    result = packRuntime({ repoRoot: args.repo, outDir: args.out, sourceSha: args.sourceSha });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(JSON.stringify(result.info));
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("pack-runtime.mjs");
if (isMain) main();
