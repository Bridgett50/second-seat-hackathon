import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mjs", ".js"]);
const SELF = "meeting-room-imports.test.ts";
const FORBIDDEN = ["createTwinRoom", "runDemoEndToEnd"];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot >= 0 ? name.slice(dot) : "";
    if (SOURCE_EXT.has(ext) && name !== SELF) out.push(full);
  }
}

function staticImports(source: string): Array<{ clause: string; spec: string }> {
  const found: Array<{ clause: string; spec: string }> = [];
  const re = /(?:import|export)\s*([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    found.push({ clause: match[1] ?? "", spec: match[2] ?? "" });
  }
  return found;
}

function dynamicImports(source: string): string[] {
  const specs: string[] = [];
  const re = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match[1] !== undefined) specs.push(match[1]);
  }
  return specs;
}

function isCoreSpec(spec: string): boolean {
  return spec === "@second-seat/core" || spec.startsWith("@second-seat/core/");
}

describe("meeting room import guard", () => {
  it("MR-I1 apps/web never imports createTwinRoom or runDemoEndToEnd from @second-seat/core", () => {
    const files: string[] = [];
    walk(WEB_DIR, files);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { clause, spec } of staticImports(source)) {
        if (!isCoreSpec(spec)) continue;
        const star = /\*\s*as\s*([A-Za-z_$][\w$]*)/.exec(clause);
        if (star !== null) {
          const alias = star[1] ?? "";
          if (
            new RegExp(`\\b${alias}\\s*\\.\\s*createTwinRoom\\b`).test(source) ||
            new RegExp(`\\b${alias}\\s*\\.\\s*runDemoEndToEnd\\b`).test(source)
          ) {
            violations.push(`${file}: namespace import of ${spec} uses a twin entry`);
          }
          continue;
        }
        for (const name of FORBIDDEN) {
          if (new RegExp(`\\b${name}\\b`).test(clause)) {
            violations.push(`${file}: imports ${name} from ${spec}`);
          }
        }
      }
      for (const spec of dynamicImports(source)) {
        if (!isCoreSpec(spec)) continue;
        if (
          /\.createTwinRoom\b/.test(source) ||
          /\.runDemoEndToEnd\b/.test(source)
        ) {
          violations.push(`${file}: dynamic import of ${spec} uses a twin entry`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("MR-I2 the meeting room service imports the twin room from the bot wrapper", () => {
    const source = readFileSync(join(WEB_DIR, "src", "meetingRoom.ts"), "utf8");
    expect(source).toContain("@second-seat/bot/dist/src/t2-room.js");
    expect(source).not.toContain("@second-seat/core");
  });
});
