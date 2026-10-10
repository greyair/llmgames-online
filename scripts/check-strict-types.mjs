import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = ["apps", "packages", "examples"];

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

const ignoredDirectories = new Set(["dist", "node_modules", ".astro", ".turbo", ".wrangler"]);

const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const forbidden = [
  {
    label: "blanket Record<string, unknown/any>",
    pattern: /Record\s*<\s*(?:String|string)\s*,\s*(?:unknown|any)\s*>/,
  },
  {
    label: "catch-all [key: string]: unknown",
    pattern: /\[\s*key\s*:\s*string\s*\]\s*:\s*unknown/,
  },
  {
    label: "explicit any",
    pattern: /(?:\:\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\s*\[\s*\])/,
  },
  {
    label: "double assertion through unknown",
    pattern: /\bas\s+unknown\s+as\b/,
  },
  {
    label: "TypeScript suppression",
    pattern: /@ts-(?:ignore|expect-error)/,
  },
];

function sourceFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);

    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name)) && !testFile.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const root of roots) {
  for (const file of sourceFiles(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      for (const rule of forbidden) {
        if (rule.pattern.test(line)) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1}: ${rule.label}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Strict production type check failed:\n" + violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Strict production type check passed");
}
