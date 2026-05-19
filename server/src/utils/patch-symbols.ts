/**
 * Best-effort symbol extraction from a unified diff patch.
 *
 * Looks for ADDED/REMOVED lines that introduce or delete top-level
 * symbol declarations (functions, classes, methods, constants).
 * Returns `{ added: ['authMiddleware', 'class UserService', ...] }`
 * for the Knowledge Graph diff page.
 *
 * Why regex and not tree-sitter? We could re-parse the file pre/post,
 * but:
 *   - Patches are usually small; regex is O(lines)
 *   - We don't need precision; we need "what stands out as new"
 *   - Tree-sitter doesn't run on a partial patch (it needs full files)
 *
 * Trade-off accepted: a regex match might miss multi-line declarations
 * or weirdly-formatted code. That's OK — the symbol panel is a hint,
 * not an audit. False negatives are fine; false positives are filtered
 * out by requiring the symbol to look like a real identifier.
 */

interface SymbolDelta {
  added: string[];
  removed: string[];
}

// One regex per language pattern. Each captures the symbol name in group 1.
// The leading "+" / "-" is asserted by the caller (we get the line content
// without the prefix).
const SYMBOL_PATTERNS: Array<{
  pattern: RegExp;
  /** Optional formatting (e.g. prefix "class " for classes) */
  prefix?: string;
  /** Restrict by file extension if non-empty */
  exts?: string[];
}> = [
  // ── TypeScript / JavaScript ──
  { pattern: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, prefix: "function " },
  { pattern: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, prefix: "function " },
  { pattern: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, prefix: "class " },
  { pattern: /^\s*class\s+([A-Za-z_$][\w$]*)/, prefix: "class " },
  { pattern: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/, prefix: "interface " },
  { pattern: /^\s*interface\s+([A-Za-z_$][\w$]*)/, prefix: "interface " },
  { pattern: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/, prefix: "type " },
  { pattern: /^\s*type\s+([A-Za-z_$][\w$]*)\s*=/, prefix: "type " },
  { pattern: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, prefix: "const " },
  { pattern: /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/, prefix: "enum " },

  // ── Python ──
  { pattern: /^\s*def\s+([A-Za-z_][\w]*)/, prefix: "def ", exts: ["py"] },
  { pattern: /^\s*async\s+def\s+([A-Za-z_][\w]*)/, prefix: "async def ", exts: ["py"] },
  { pattern: /^\s*class\s+([A-Za-z_][\w]*)/, prefix: "class ", exts: ["py"] },

  // ── Go ──
  { pattern: /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)/, prefix: "func ", exts: ["go"] },
  { pattern: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/, prefix: "type ", exts: ["go"] },

  // ── Rust ──
  { pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/, prefix: "fn ", exts: ["rs"] },
  { pattern: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/, prefix: "struct ", exts: ["rs"] },
  { pattern: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/, prefix: "enum ", exts: ["rs"] },
  { pattern: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/, prefix: "trait ", exts: ["rs"] },

  // ── Java / Kotlin / C# (rough) ──
  { pattern: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([A-Za-z_][\w]*)/, prefix: "class " },
  { pattern: /^\s*(?:public|private|protected|internal)\s+interface\s+([A-Za-z_][\w]*)/, prefix: "interface " },
  { pattern: /^\s*fun\s+([A-Za-z_][\w]*)/, prefix: "fun ", exts: ["kt", "kts"] },
];

// Hard noise filter: don't surface tiny common names that would clutter
// the panel. The user wants "new auth handler appeared", not "the letter
// 'a' appeared as a variable".
const MIN_NAME_LENGTH = 3;
const NOISE_NAMES = new Set([
  "constructor", "render", "init", "main", "get", "set", "ctx", "req", "res", "err",
  "log", "fmt", "fn", "tmp", "val", "ret", "obj",
]);

export function extractSymbolsFromPatch(
  filename: string,
  patch: string,
): SymbolDelta {
  if (!patch) return { added: [], removed: [] };

  const ext = (filename.split(".").pop() || "").toLowerCase();
  const added: string[] = [];
  const removed: string[] = [];
  const seen = { added: new Set<string>(), removed: new Set<string>() };

  for (const rawLine of patch.split("\n")) {
    // Skip hunk headers and context lines
    if (rawLine.startsWith("@@") || rawLine.startsWith("+++") || rawLine.startsWith("---")) {
      continue;
    }
    if (!rawLine.startsWith("+") && !rawLine.startsWith("-")) continue;

    const isAdd = rawLine.startsWith("+");
    const content = rawLine.slice(1);
    const bucket = isAdd ? added : removed;
    const bucketSeen = isAdd ? seen.added : seen.removed;

    for (const { pattern, prefix, exts } of SYMBOL_PATTERNS) {
      if (exts && exts.length > 0 && !exts.includes(ext)) continue;
      const m = content.match(pattern);
      if (m && m[1]) {
        const name = m[1];
        if (name.length < MIN_NAME_LENGTH) continue;
        if (NOISE_NAMES.has(name.toLowerCase())) continue;
        const label = (prefix ? prefix : "") + name;
        if (!bucketSeen.has(label)) {
          bucketSeen.add(label);
          bucket.push(label);
        }
        // Stop after first match per line (a "class Foo" line shouldn't
        // also match a generic identifier pattern)
        break;
      }
    }
  }

  return { added, removed };
}
