#!/usr/bin/env node
/**
 * Sprint 21 — Auto-generate the SOD (Segregation of Duties) matrix from
 * @Roles decorators in NestJS controllers (closes audit finding D4-06).
 *
 * Walks `apps/api/src/**\/*.controller.ts`, parses out each handler's path
 * (from @Get / @Post / @Patch / @Delete / @Put + @Controller prefix) and
 * the @Roles(...) decorator above it, then emits a markdown table mapping
 * roles to the handlers they're permitted to call.
 *
 * Why static parsing instead of runtime reflection: doesn't require booting
 * the Nest app; can run in CI on every commit; deterministic output for
 * easy diffing in PR reviews.
 *
 * Usage:
 *   node scripts/gen-sod-matrix.js                 → writes docs/SOD_MATRIX.md
 *   node scripts/gen-sod-matrix.js --print         → stdout (no write)
 *   node scripts/gen-sod-matrix.js --check         → exits 1 if docs/SOD_MATRIX.md
 *                                                    drifts from generated content
 *                                                    (use as a CI gate)
 *
 * Output: docs/SOD_MATRIX.md (canonical, version-controlled).
 */
const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const SRC_DIR   = path.join(ROOT, 'apps/api/src');
const OUT_FILE  = path.join(ROOT, 'docs/SOD_MATRIX.md');

// ─── 1. Discover controller files ─────────────────────────────────────────

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      walk(full, acc);
    } else if (ent.isFile() && full.endsWith('.controller.ts') && !full.endsWith('.spec.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

// ─── 2. Parse each controller ──────────────────────────────────────────────

const HTTP_VERBS = ['Get', 'Post', 'Patch', 'Put', 'Delete'];

/**
 * For one controller file:
 *   - Find @Controller('prefix') — could be empty/no-prefix
 *   - Track the "class-level @Roles(...)" that applies as a default
 *   - For each method, find the @Roles + the HTTP-verb decorator pair
 * Returns: [{ prefix, method, route, roles }]
 */
function parseController(file) {
  const text = fs.readFileSync(file, 'utf8');
  const handlers = [];

  // Class-level @Controller path
  const ctrlMatch = text.match(/@Controller\(['"]([^'"]*)['"]\)/);
  const prefix = ctrlMatch ? ctrlMatch[1] : '';

  // Class-level @Roles default (applied to handlers without their own @Roles)
  // We capture only the top-most @Roles before the class declaration line.
  let classRoles = null;
  const classDeclIdx = text.search(/^export class \w+(?:Controller)?\b/m);
  if (classDeclIdx > 0) {
    const before = text.slice(0, classDeclIdx);
    // Scan backwards for the last @Roles before the class
    const matches = [...before.matchAll(/@Roles\(([^)]+)\)/g)];
    if (matches.length) {
      classRoles = parseRoles(matches[matches.length - 1][1]);
    }
  }

  // Split by class methods. Heuristic: every line that contains a verb
  // decorator (@Get/@Post/etc.) followed within ~15 lines by a method.
  // We walk line-by-line so we can track the @Roles decorator that PRECEDES
  // each verb decorator.
  const lines = text.split(/\r?\n/);
  let pendingRoles = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // @Roles(...) — may span multiple lines if the roles list is long
    const rolesStart = line.match(/^@Roles\((.*)$/);
    if (rolesStart) {
      // Greedy multi-line capture until we hit the closing ')'
      let captured = rolesStart[1];
      let depth = (captured.match(/\(/g) || []).length - (captured.match(/\)/g) || []).length;
      let j = i;
      while (depth > 0 && j < lines.length - 1) {
        j++;
        captured += ' ' + lines[j].trim();
        depth += (lines[j].match(/\(/g) || []).length;
        depth -= (lines[j].match(/\)/g) || []).length;
      }
      // captured now contains the args text including the closing ')'
      const argText = captured.replace(/\)[^)]*$/, '');
      pendingRoles = parseRoles(argText);
      i = j; // skip ahead past the multi-line decorator
      continue;
    }

    // HTTP verb decorator
    const verbMatch = line.match(/^@(Get|Post|Patch|Put|Delete)\((?:['"]([^'"]*)['"]|\)?)?/);
    if (verbMatch) {
      const method = verbMatch[1].toUpperCase();
      const sub    = verbMatch[2] || '';
      const route  = path.posix.join('/', prefix, sub).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      handlers.push({
        method,
        route,
        roles: pendingRoles ?? classRoles ?? null,
        controller: path.relative(ROOT, file),
      });
      pendingRoles = null;
      continue;
    }

    // If we see a method declaration without a preceding verb decorator
    // we don't care — only verb-decorated methods are routes. But clear
    // pendingRoles when we hit a non-decorator non-blank line so a stray
    // @Roles doesn't bleed into the next handler.
    if (line && !line.startsWith('@') && !line.startsWith('//') && !line.startsWith('*')) {
      pendingRoles = null;
    }
  }

  return handlers;
}

function parseRoles(argText) {
  // argText looks like: `'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT'`
  // Or with whitespace: `\n    'A',\n    'B',\n  `
  return [...argText.matchAll(/['"]([A-Z_]+)['"]/g)].map((m) => m[1]);
}

// ─── 3. Build the matrix ───────────────────────────────────────────────────

const controllers = walk(SRC_DIR);
const allHandlers = controllers.flatMap(parseController).filter((h) => h.roles); // ignore routes without @Roles

// Unique role universe (sorted) + unique route universe
const ROLES  = [...new Set(allHandlers.flatMap((h) => h.roles))].sort();
const ROUTES = [...new Set(allHandlers.map((h) => `${h.method} ${h.route}`))].sort();

// Build the access map: { role: Set<route> }
const accessMap = new Map(ROLES.map((r) => [r, new Set()]));
for (const h of allHandlers) {
  for (const role of h.roles) {
    accessMap.get(role).add(`${h.method} ${h.route}`);
  }
}

// ─── 4. Render markdown ────────────────────────────────────────────────────

function render() {
  const lines = [];
  lines.push('# SOD Matrix — Auto-generated');
  lines.push('');
  lines.push(`> Generated by \`scripts/gen-sod-matrix.js\` from \`@Roles(...)\` decorators in the NestJS controllers.`);
  lines.push(`> ${ROUTES.length} guarded routes × ${ROLES.length} roles.`);
  lines.push(`> Last generated: ${new Date().toISOString().slice(0, 10)}.`);
  lines.push('');
  lines.push('Legend: ✓ = role is permitted to call this route. Blank = not permitted.');
  lines.push('');

  // For readability: group routes by their controller path prefix
  const groups = new Map();
  for (const r of ROUTES) {
    const [, , prefix] = r.match(/^([A-Z]+) \/?([^/]*)/) ?? [];
    const key = prefix || '_root';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const groupNames = [...groups.keys()].sort();

  for (const group of groupNames) {
    lines.push(`## /${group === '_root' ? '' : group}`);
    lines.push('');
    // Compact table per group
    const groupRoutes = groups.get(group);
    lines.push(`| Route | ${ROLES.join(' | ')} |`);
    lines.push(`|---|${ROLES.map(() => '---').join('|')}|`);
    for (const route of groupRoutes) {
      const cells = ROLES.map((role) => accessMap.get(role).has(route) ? '✓' : '');
      // Escape pipes in route paths just in case
      const safeRoute = route.replace(/\|/g, '\\|');
      lines.push(`| \`${safeRoute}\` | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── 5. Entrypoint ─────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const md     = render();

if (args.includes('--print')) {
  process.stdout.write(md);
  process.exit(0);
}

if (args.includes('--check')) {
  // CI gate: fail if the on-disk file drifts from the generated content.
  if (!fs.existsSync(OUT_FILE)) {
    console.error(`docs/SOD_MATRIX.md does not exist. Run: node scripts/gen-sod-matrix.js`);
    process.exit(1);
  }
  const existing = fs.readFileSync(OUT_FILE, 'utf8').replace(/\r\n/g, '\n');
  const generated = md.replace(/\r\n/g, '\n');
  // Tolerate the "Last generated:" line difference — strip it from both
  const normaliseDate = (s) => s.replace(/^> Last generated: \d{4}-\d{2}-\d{2}\.$/m, '> Last generated: <today>');
  if (normaliseDate(existing) !== normaliseDate(generated)) {
    console.error('docs/SOD_MATRIX.md is stale. Re-run: node scripts/gen-sod-matrix.js');
    process.exit(1);
  }
  console.log('SOD matrix is up to date.');
  process.exit(0);
}

fs.writeFileSync(OUT_FILE, md);
console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} — ${ROUTES.length} routes × ${ROLES.length} roles.`);
