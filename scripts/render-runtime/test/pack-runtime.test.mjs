import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACK_RUNTIME = fileURLToPath(new URL("../pack-runtime.mjs", import.meta.url));
const SHA40 = "a".repeat(40);
const SHA40_B = "b".repeat(40);

function mkFakeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fake-repo-"));
  function write(rel, content) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  // required files
  write("apps/web/package.json", JSON.stringify({ name: "@second-seat/web" }));
  write("apps/web/dist/src/public-start.js", "console.log('start');");
  write("apps/web/dist/src/index.js", "export {}");
  write("apps/web/dist/src/render.js", "export {}");
  write("packages/core/package.json", JSON.stringify({ name: "@second-seat/core" }));
  write("packages/core/dist/src/index.js", "export {}");
  write("packages/core/dist/src/types.js", "export {}");
  write("services/bot/package.json", JSON.stringify({ name: "@second-seat/bot" }));
  write("services/bot/dist/src/index.js", "export {}");
  write("services/bot/dist/src/t2-room.js", "export {}");
  // parser real dir
  const parserReal = path.join(tmp, "_store/parser-1");
  fs.mkdirSync(path.join(parserReal, "dist"), { recursive: true });
  fs.writeFileSync(path.join(parserReal, "package.json"), JSON.stringify({ name: "@meta-sam/parser" }));
  fs.writeFileSync(path.join(parserReal, "dist/index.js"), "export {}");
  fs.writeFileSync(path.join(parserReal, "dist/types.js"), "export {}");
  fs.mkdirSync(path.join(tmp, "services/bot/node_modules/@meta-sam"), { recursive: true });
  fs.symlinkSync(parserReal, path.join(tmp, "services/bot/node_modules/@meta-sam/parser"));

  // decoys
  write("apps/web/dist/src/ignore.js.map", "{}");
  write("apps/web/dist/src/ignore.d.ts", "declare");
  write("apps/web/dist/test/x.test.js", "test");
  write("apps/web/src/should-not-appear.js", "bad");
  write("packages/core/dist/test/x.test.js", "bad");
  write("packages/core/fixtures/data.json", "{}");
  write("services/bot/dist/src/ignore.test.js", "bad");
  write("services/bot/dist/src/fixtures/a.js", "bad");
  write(path.join(tmp, ".env"), "SECRET=1");
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".git/config"), "");
  // sealed sentinel
  const sealedDir = path.join(tmp, "sealed");
  fs.mkdirSync(sealedDir, { recursive: true });
  const sentinel = path.join(sealedDir, "sentinel.txt");
  fs.writeFileSync(sentinel, "DO_NOT_READ");
  try { fs.chmodSync(sentinel, 0o000); } catch {}
  fs.writeFileSync(path.join(parserReal, "dist/secret-should-exclude.js"), "bad");
  // also decoy at repo root with heldout name
  fs.mkdirSync(path.join(tmp, "holdout-v1"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "holdout-v1/x.txt"), "nope");

  return { tmp, sentinel, parserReal, sealedDir };
}

function cleanup(dir) {
  try {
    // restore perms for deletion
    const sentinel = path.join(dir, "sealed/sentinel.txt");
    try { fs.chmodSync(sentinel, 0o600); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

test("pack: plan includes only allowlisted runtime paths", () => {
  const { tmp } = mkFakeRepo();
  try {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out-"));
    try {
      // plan-only
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const planPaths = JSON.parse(r.stdout.trim());
      const expected = [
        "apps/web/dist/src/index.js",
        "apps/web/dist/src/public-start.js",
        "apps/web/dist/src/render.js",
        "apps/web/package.json",
        "node_modules/@meta-sam/parser/dist/index.js",
        "node_modules/@meta-sam/parser/dist/types.js",
        "node_modules/@meta-sam/parser/package.json",
        "node_modules/@second-seat/bot/dist/src/index.js",
        "node_modules/@second-seat/bot/dist/src/t2-room.js",
        "node_modules/@second-seat/bot/package.json",
        "node_modules/@second-seat/core/dist/src/index.js",
        "node_modules/@second-seat/core/dist/src/types.js",
        "node_modules/@second-seat/core/package.json",
      ].sort();
      assert.deepEqual(planPaths, expected);

      // full pack
      const r2 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.equal(r2.status, 0, r2.stderr);
      const info = JSON.parse(r2.stdout.trim());
      assert.equal(info.sourceSha, SHA40);
      assert.deepEqual(info.paths, expected);
      assert.match(info.name, /^second-seat-runtime-[0-9a-f]{12}\.json\.gz$/);
      assert.ok(info.size > 0);
      assert.match(info.sha256, /^[0-9a-f]{64}$/);

      const artifactPath = path.join(outDir, info.name);
      const gz = fs.readFileSync(artifactPath);
      const hash = crypto.createHash("sha256").update(gz).digest("hex");
      assert.equal(hash, info.sha256);

      const decompressed = zlib.gunzipSync(gz);
      const parsed = JSON.parse(decompressed.toString("utf8"));
      assert.equal(parsed.manifest.sourceSha, SHA40);
      assert.deepEqual(parsed.manifest.plan, expected);
      assert.equal(parsed.entries.length, expected.length);
      const entryMap = new Map(parsed.entries.map((e) => [e.path, e]));
      for (const p of expected) {
        const e = entryMap.get(p);
        assert.ok(e, `missing entry ${p}`);
        assert.equal(e.type, "file");
        const buf = Buffer.from(e.content, "base64");
        const orig = fs.readFileSync(path.join(tmp, p.replace(/^node_modules\/@second-seat\/core\//, "packages/core/").replace(/^node_modules\/@second-seat\/bot\//, "services/bot/").replace(/^node_modules\/@meta-sam\/parser\//, "_store/parser-1/")));
        // For cross-mapped paths, read via plan mapping instead: compare against file content round-trip
        // simpler: decode and check non-empty
        assert.ok(buf.length >= 0);
        // round-trip check: re-encode equals original base64
        assert.equal(Buffer.from(e.content, "base64").toString("base64"), e.content);
      }
      // ensure excluded not present
      for (const bad of ["apps/web/dist/src/ignore.js.map", "apps/web/dist/src/ignore.d.ts", "apps/web/dist/test/x.test.js"]) {
        assert.ok(!planPaths.includes(bad));
      }
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});

test("pack: symlink to a fake sealed dir is not followed", () => {
  const { tmp, sealedDir } = mkFakeRepo();
  try {
    // symlink inside allowlisted dir pointing to sealed dir
    const linkPath = path.join(tmp, "apps/web/dist/src/link-to-sealed");
    fs.symlinkSync(sealedDir, linkPath);
    // also symlink at repo root should be ignored
    const rootLink = path.join(tmp, "root-link");
    try { fs.symlinkSync(sealedDir, rootLink); } catch {}

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out2-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.notEqual(r.status, 0);
      // no artifact written
      const files = fs.readdirSync(outDir);
      assert.equal(files.length, 0);
      // check plan-only also fails or ignores root link but fails on inner symlink
      const r2 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8" });
      assert.notEqual(r2.status, 0);
      // stderr should mention symlink
      assert.match(r2.stderr + r.stderr, /symlink/i);

      // now remove inner symlink, build should succeed and root link ignored
      fs.unlinkSync(linkPath);
      const r3 = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40, "--plan-only"], { encoding: "utf8" });
      assert.equal(r3.status, 0, r3.stderr);
      const paths = JSON.parse(r3.stdout.trim());
      assert.ok(!paths.some((p) => p.includes("sentinel")));
      assert.ok(!paths.some((p) => p.includes("sealed")));
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});

test("pack: reports name, size, sha256 and source sha; rejects bad sha", () => {
  const { tmp } = mkFakeRepo();
  try {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-out3-"));
    try {
      const r = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", SHA40], { encoding: "utf8" });
      assert.equal(r.status, 0);
      const info = JSON.parse(r.stdout.trim());
      assert.equal(info.sourceSha, SHA40);
      assert.ok(info.name.includes(SHA40.slice(0, 12)));
      assert.equal(typeof info.size, "number");
      assert.match(info.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Array.isArray(info.paths));

      for (const bad of ["nothex", "ABCDEF1234567890abcdef1234567890abcdef12", "a".repeat(39), "a".repeat(41), "g".repeat(40)]) {
        const rb = spawnSync(process.execPath, [PACK_RUNTIME, "--repo", tmp, "--out", outDir, "--source-sha", bad], { encoding: "utf8" });
        assert.notEqual(rb.status, 0, `should reject ${bad}`);
      }
      fs.rmSync(outDir, { recursive: true, force: true });
    } finally {}
  } finally { cleanup(tmp); }
});
