// INV-65: the product skeleton (repo, CI and CLAUDE.md).
// One test (or more) per check in "Как проверявам"; the check number is the bullet's place in that list:
//   1 CI, 2 pnpm dev and GET /health, 3 folders, 4 module boundaries in pnpm lint, 5 owners.ts, 6 CLAUDE.md.
// The ownership test itself (check 5) is packages/db/owners.test.ts, run by vitest; this file checks that pnpm test
// reaches it. Tests in one file run one after another, so the lint probes (check 4, at the end) never overlap the
// builds and `pnpm dev` above them.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

// Node globals come from imports or globalThis, so the file lints clean without a Node globals setting.
const { fetch } = globalThis;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Check 3: "Папките са по ADR-011 и ADR-002: apps/web, apps/api (с src/modules/ и src/common/), packages/domain,
// packages/db, packages/shared."
const WORKSPACES = ['apps/web', 'apps/api', 'packages/domain', 'packages/db', 'packages/shared'];

// ADR-011, "Нивата и модулите": every module, its level, the tables it owns and its queues.
const MODULES = {
  workspaces: { level: 'L0', tables: ['users', 'workspaces', 'workspace_members', 'invitations', 'company_access'], queues: [] },
  audit: { level: 'L0', tables: ['audit_log'], queues: ['audit.partitions'] },
  files: { level: 'L0', tables: ['files'], queues: [] },
  accounts: { level: 'L0', tables: ['accounts', 'account_templates', 'categories', 'posting_rules', 'company_posting_rules', 'vat_treatments', 'parameters'], queues: [] },
  periods: { level: 'L0', tables: ['periods', 'submissions', 'fiscal_years', 'holidays', 'deadline_rules'], queues: [] },
  companies: { level: 'L0', tables: ['companies', 'vehicles', 'company_vat_regimes', 'company_transfers'], queues: [] },
  counterparties: { level: 'L1', tables: ['counterparties', 'counterparty_ibans', 'vies_checks'], queues: [] },
  documents: { level: 'L1', tables: ['documents', 'document_lines', 'document_kinds', 'products', 'ai_extractions', 'company_memory'], queues: ['documents.extract'] },
  invoicing: { level: 'L1', tables: ['number_sequences', 'issued_numbers'], queues: ['invoicing.pdf'] },
  posting: { level: 'L2', tables: ['journal_entries', 'journal_lines', 'manual_entries', 'manual_entry_lines'], queues: ['posting.batch-book'] },
  bank: { level: 'L2', tables: ['bank_accounts', 'import_mappings', 'bank_statements', 'bank_transactions', 'payments', 'settlements'], queues: ['bank.import'] },
  vat: { level: 'L2', tables: ['vat_returns', 'vat_refund_balances', 'vat_refund_uses', 'vat_credit_coefficients'], queues: ['vat.export'] },
  payroll: { level: 'L2', tables: ['employees', 'employment_contracts', 'payroll_items'], queues: [] },
  tasks: { level: 'L3', tables: ['deadlines', 'tasks', 'company_states'], queues: ['tasks.nightly', 'tasks.refresh'] },
  checks: { level: 'L3', tables: ['findings'], queues: ['checks.run', 'checks.ai-review', 'checks.dead-letter'] },
  reports: { level: 'L3', tables: [], queues: [] },
  onboarding: { level: 'L3', tables: ['onboarding_imports', 'import_consents'], queues: ['onboarding.import'] },
  dashboard: { level: 'L3', tables: [], queues: [] },
};

function readJson(rel) {
  const file = join(root, rel);
  assert.ok(existsSync(file), `${rel} is missing`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readText(rel) {
  const file = join(root, rel);
  assert.ok(existsSync(file), `${rel} is missing`);
  return readFileSync(file, 'utf8');
}

function rootScripts() {
  return readJson('package.json').scripts ?? {};
}

// A root script with the root scripts it calls (`pnpm <name>`, `pnpm run <name>`, `npm run <name>`) expanded.
function expandedScript(name, scripts = rootScripts(), seen = new Set()) {
  const body = scripts[name];
  if (typeof body !== 'string' || seen.has(name)) return '';
  seen.add(name);
  let text = body;
  for (const m of body.matchAll(/\b(?:pnpm|npm)\s+(?:run\s+)?([\w:.-]+)/g)) {
    text += `\n${expandedScript(m[1], scripts, seen)}`;
  }
  return text;
}

function allDeps(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

function pnpm(args, cwd = root, timeout = 180_000) {
  return execFileSync('pnpm', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Files git would commit under a path: tracked, plus untracked and not ignored (the runner commits those).
function committable(rel) {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', rel], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------
// Check 1: "PR-ът към invoicely минава CI: pnpm install --frozen-lockfile, pnpm typecheck, pnpm lint и pnpm test от
// корена, и проверката за тайни." Agent notes: the root package.json has these three scripts and pnpm-lock.yaml;
// pnpm in CI is 10.34.9; "pnpm test свършва сам (например vitest run), без watch mode".

test('check 1a: root package.json has the scripts typecheck, lint and test', () => {
  const scripts = rootScripts();
  for (const name of ['typecheck', 'lint', 'test']) {
    // Agent notes: "Скелетът трябва да има тези три скрипта в коренния package.json"
    assert.equal(typeof scripts[name], 'string', `root script "${name}" is missing`);
    assert.notEqual(scripts[name].trim(), '', `root script "${name}" is empty`);
  }
});

test('check 1b: the repo has a pnpm-lock.yaml at the root for pnpm install --frozen-lockfile', () => {
  // Agent notes: "... и pnpm-lock.yaml"
  assert.ok(existsSync(join(root, 'pnpm-lock.yaml')), 'pnpm-lock.yaml is missing');
});

test('check 1c: pnpm test ends by itself, without watch mode', () => {
  const script = expandedScript('test');
  assert.notEqual(script, '', 'root script "test" is missing');
  // Agent notes: "pnpm test свършва сам (например vitest run), без watch mode"
  assert.doesNotMatch(script, /--watch\b|--watchAll\b/, 'the test script must not use watch mode');
  // A bare `vitest` (without `run`) watches when not in CI.
  for (const m of script.matchAll(/\bvitest\b(\s+\S+)?/g)) {
    assert.equal((m[1] ?? '').trim(), 'run', `"${m[0]}" starts vitest in watch mode; use "vitest run"`);
  }
});

test('check 1d: pnpm test runs the tests in e2e/ (these skeleton tests)', () => {
  // Check 1 "pnpm test": the CI test step is `pnpm test`, so the root test script must reach e2e/.
  assert.match(expandedScript('test'), /e2e/, 'the root test script does not run e2e/');
});

test('check 1e: if package.json pins packageManager, it is the pnpm CI uses (10.34.9)', () => {
  const pkg = readJson('package.json');
  if (pkg.packageManager === undefined) return;
  // Agent notes: "pnpm в CI е 10.34.9"
  assert.match(pkg.packageManager, /^pnpm@10\.34\.9(\+.*)?$/);
});

test('check 1f: no .env file with secrets is committed (the secret scan stays green)', () => {
  // Check 1 "проверката за тайни"; ADR-002 т. 13: "Тайните са в env на Render и в GitHub secrets, никога в repo-то."
  const envFiles = committable('.')
    .filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f))
    .filter((f) => !/\.env\.example$/.test(f));
  assert.deepEqual(envFiles, [], `committable .env files: ${envFiles.join(', ')}`);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 2: "pnpm dev от корена пуска web и api. Web показва празна страница, а GET /health на api връща 200. README
// казва това с една команда."

test('check 2a: README tells how to run it locally with the one command pnpm dev, a root script', () => {
  const readme = readText('README.md');
  // Check 2: "pnpm dev от корена ... README казва това с една команда."
  assert.match(readme, /pnpm dev\b/, 'README does not name `pnpm dev`');
  assert.equal(typeof rootScripts().dev, 'string', 'root package.json has no "dev" script');
});

test('check 2b: pnpm dev from the root starts api with GET /health 200 and web with a page', { timeout: 150_000 }, async () => {
  // Port 3000 for the api: the NestJS default and the port in the repo's CLAUDE.md ("api (NestJS, port 3000)").
  // The web address is read from what Vite prints ("Local: http://localhost:5173/").
  const child = spawn('pnpm', ['dev'], {
    cwd: root,
    detached: true,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', BROWSER: 'none', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  let exited = false;
  child.on('exit', () => (exited = true));
  try {
    const deadline = Date.now() + 120_000;
    let health;
    while (Date.now() < deadline && !exited) {
      try {
        health = await fetch('http://localhost:3000/health');
        break;
      } catch {
        await sleep(1000);
      }
    }
    assert.ok(health, `the api did not answer on http://localhost:3000/health; pnpm dev printed:\n${out.slice(-3000)}`);
    assert.equal(health.status, 200, 'GET /health'); // check 2: "GET /health на api връща 200"

    let webUrl;
    while (Date.now() < deadline && !exited && webUrl === undefined) {
      const urls = [...out.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)\/?/g)].filter((m) => m[1] !== '3000');
      webUrl = urls[0]?.[0];
      if (webUrl === undefined) await sleep(500);
    }
    assert.ok(webUrl, `pnpm dev printed no web address; it printed:\n${out.slice(-3000)}`);
    const page = await fetch(webUrl);
    assert.equal(page.status, 200, `GET ${webUrl}`); // check 2: "Web показва празна страница"
    assert.match(page.headers.get('content-type') ?? '', /text\/html/, 'web does not serve an HTML page');
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Check 3: the folders by ADR-011 and ADR-002, plus Какво "празно приложение по одобрените ADR-и: web и api, които се
// билдват" and the stack in Agent notes ("React SPA (Vite), NestJS, Supabase Postgres, Drizzle. pnpm monorepo, strict
// TypeScript").

for (const dir of [...WORKSPACES, 'apps/api/src/modules', 'apps/api/src/common']) {
  test(`check 3a: ${dir} exists and is committed (not empty to git)`, () => {
    // Check 3: "apps/web, apps/api (с src/modules/ и src/common/), packages/domain, packages/db, packages/shared"
    assert.ok(existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory(), `${dir}/ is missing`);
    assert.ok(committable(dir).length > 0, `${dir}/ has no file git would commit, so CI would not see it`);
  });
}

test('check 3b: the pnpm workspace has apps/web, apps/api, packages/domain, packages/db, packages/shared', () => {
  assert.ok(existsSync(join(root, 'pnpm-workspace.yaml')), 'pnpm-workspace.yaml is missing');
  const listed = JSON.parse(pnpm(['-r', 'ls', '--depth', '-1', '--json']));
  const paths = listed.map((p) => p.path.split('\\').join('/'));
  for (const ws of WORKSPACES) {
    assert.ok(paths.some((p) => p.endsWith(`/${ws}`)), `${ws} is not a workspace package (got: ${paths.join(', ')})`);
  }
});

test('check 3c: apps/web is a React SPA built with Vite', () => {
  const deps = allDeps(readJson('apps/web/package.json'));
  for (const name of ['react', 'react-dom', 'vite']) {
    assert.ok(name in deps, `apps/web does not depend on ${name}`); // Agent notes: "React SPA (Vite)"
  }
});

test('check 3d: apps/api is a NestJS app', () => {
  const deps = allDeps(readJson('apps/api/package.json'));
  for (const name of ['@nestjs/core', '@nestjs/common']) {
    assert.ok(name in deps, `apps/api does not depend on ${name}`); // Agent notes: "NestJS"
  }
});

test('check 3e: packages/db uses Drizzle', () => {
  // Agent notes: "Drizzle"; check 5 needs Drizzle tables in packages/db.
  assert.ok('drizzle-orm' in allDeps(readJson('packages/db/package.json')), 'packages/db does not depend on drizzle-orm');
});

for (const ws of WORKSPACES) {
  test(`check 3f: ${ws} compiles with strict TypeScript`, () => {
    assert.ok(existsSync(join(root, ws, 'tsconfig.json')), `${ws}/tsconfig.json is missing`);
    // `tsc --showConfig` resolves `extends`, so a shared base config counts.
    const config = JSON.parse(pnpm(['exec', 'tsc', '--showConfig', '-p', 'tsconfig.json'], join(root, ws), 60_000));
    assert.equal(config.compilerOptions?.strict, true, `${ws}: compilerOptions.strict is not true`); // "strict TypeScript"
  });
}

for (const app of ['apps/web', 'apps/api']) {
  test(`check 3g: the empty ${app} builds`, () => {
    const pkg = readJson(`${app}/package.json`);
    // Какво: "web и api, които се билдват и пускат локално"
    assert.equal(typeof pkg.scripts?.build, 'string', `${app} has no build script`);
    pnpm(['--dir', app, 'run', 'build']); // throws when the build exits non-zero
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Check 5 (the part this file can see): "packages/db/owners.ts и тест на собствеността". The test is
// packages/db/owners.test.ts (vitest); CI runs only `pnpm test`, so it must reach it.

test('check 5a: packages/db/owners.ts and its ownership test exist', () => {
  assert.ok(existsSync(join(root, 'packages/db/owners.ts')), 'packages/db/owners.ts is missing'); // check 5
  assert.ok(existsSync(join(root, 'packages/db/owners.test.ts')), 'packages/db/owners.test.ts is missing');
});

test('check 5b: pnpm test runs vitest, which runs packages/db/owners.test.ts', () => {
  const rootTest = expandedScript('test');
  const dbTest = readJson('packages/db/package.json').scripts?.test ?? '';
  // Check 5 "тест на собствеността" must run in CI's `pnpm test`; ADR-002 т. 12: the test tool is Vitest.
  const viaRoot = /\bvitest\s+run\b/.test(rootTest);
  const viaPackage = /(-r|--recursive|--filter)\b[^\n]*\btest\b|\btest\b[^\n]*(-r|--recursive)\b/.test(rootTest) && /\bvitest\s+run\b/.test(dbTest);
  assert.ok(viaRoot || viaPackage, `pnpm test does not run vitest over packages/db (root test: "${rootTest.trim()}", db test: "${dbTest}")`);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 6: "CLAUDE.md в корена: картата на repo-то, командите, правилата от ADR-011 (нива, собственост, едно име за
// едно нещо) и заглавията на ADR-ите, от които идват. ADR-ите и Речник не се копират в repo-то."

test('check 6a: CLAUDE.md maps the repo: every workspace and apps/api/src/modules, apps/api/src/common', () => {
  const text = readText('CLAUDE.md');
  for (const p of [...WORKSPACES, 'modules', 'common']) {
    assert.ok(text.includes(p), `CLAUDE.md does not name ${p}`); // check 6 "картата на repo-то" + check 3 folders
  }
});

test('check 6b: CLAUDE.md names the commands pnpm dev, pnpm typecheck, pnpm lint and pnpm test', () => {
  const text = readText('CLAUDE.md');
  for (const cmd of ['pnpm dev', 'pnpm typecheck', 'pnpm lint', 'pnpm test']) {
    assert.ok(text.includes(cmd), `CLAUDE.md does not name "${cmd}"`); // check 6 "командите" (checks 1 and 2)
  }
});

test('check 6c: CLAUDE.md has the module map of ADR-011: each module with its level, tables and queues', () => {
  const text = readText('CLAUDE.md');
  // ADR-011 "Документация в repo-то": "картата на модулите: за всеки модул нивото, какво прави, таблиците, опашките и
  // модулите, които ползва".
  for (const level of ['L0', 'L1', 'L2', 'L3']) assert.ok(text.includes(level), `CLAUDE.md does not name level ${level}`);
  for (const [name, m] of Object.entries(MODULES)) {
    const line = text.split('\n').find((l) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`).test(l) && l.includes(m.level));
    assert.ok(line, `CLAUDE.md has no line with module ${name} and its level ${m.level}`);
    for (const t of m.tables) assert.match(text, new RegExp(`(^|[^\\w])${t}([^\\w]|$)`), `CLAUDE.md does not name table ${t} (${name})`);
    for (const q of m.queues) assert.ok(text.includes(q), `CLAUDE.md does not name queue ${q} (${name})`);
  }
});

test('check 6d: CLAUDE.md states the ADR-011 rules: levels, ownership, one name for one thing', () => {
  const text = readText('CLAUDE.md');
  // check 6: "правилата от ADR-011 (нива, собственост, едно име за едно нещо)"
  assert.match(text, /level|ниво|нива/i, 'CLAUDE.md does not state the levels rule');
  assert.match(text, /owner|собственост|собственик/i, 'CLAUDE.md does not state the ownership rule');
  assert.match(text, /one name|едно име/i, 'CLAUDE.md does not state "one name for one thing"');
  assert.ok(text.includes('owners.ts'), 'CLAUDE.md does not point to packages/db/owners.ts'); // ADR-011 "Тест на собствеността"
});

test('check 6e: CLAUDE.md names the titles of the ADRs the rules come from', () => {
  const text = readText('CLAUDE.md');
  // check 6 "заглавията на ADR-ите, от които идват": the rules from ADR-011, the folders from ADR-011 and ADR-002.
  assert.match(text, /ADR-011\W{0,5}Модули и собственост на данните/, 'CLAUDE.md does not name "ADR-011 Модули и собственост на данните"');
  assert.match(text, /ADR-002\W{0,5}Backend и API/, 'CLAUDE.md does not name "ADR-002 Backend и API"');
});

test('check 6f: the ADRs and the Речник are not copied into the repo', () => {
  // check 6: "ADR-ите и Речник не се копират в repo-то"
  const copies = [];
  for (const f of committable('.')) {
    if (!/\.(md|mdx|txt)$/i.test(f) || f.startsWith('fixtures/etalons/')) continue;
    const text = readFileSync(join(root, f), 'utf8');
    if (/^#\s*ADR-\d{3}\b/m.test(text) || /^#\s*Речник\s*$/m.test(text) || /^\*\*Статус:\*\* одобрен/m.test(text)) copies.push(f);
  }
  assert.deepEqual(copies, [], `files that copy an ADR or the Речник: ${copies.join(', ')}`);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 4: "pnpm lint пуска ESLint и dependency-cruiser с правилата от ADR-011: модул импортира друг само през неговия
// index.ts и само по нивата от таблицата, без цикли; drizzle-orm е позволен само в *.repository.ts, *.queries.ts и
// common/db. Тест показва, че забранен импорт между два пробни модула прави проверката червена."

test('check 4a: pnpm lint runs ESLint and dependency-cruiser', () => {
  const lint = expandedScript('lint');
  assert.match(lint, /\beslint\b/, 'pnpm lint does not run ESLint'); // check 4
  assert.match(lint, /\b(depcruise|dependency-cruiser)\b/, 'pnpm lint does not run dependency-cruiser'); // check 4
  assert.ok('dependency-cruiser' in allDeps(readJson('package.json')), 'dependency-cruiser is not a root devDependency');
});

const MOD = 'apps/api/src/modules';
const COMMON = 'apps/api/src/common';

// Probe importers. `token` is unique to the importer's file name, so the lint output names it only when the lint
// reports that file. Side-effect imports keep the probes free of type errors and unused names.
const PROBES = [
  // red: forbidden by ADR-011
  { id: 'r1', red: true, file: `${MOD}/documents/documents.probe-r1.ts`, imports: '../posting/index',
    why: 'documents (L1) imports posting (L2): ADR-011 "Зависимостта е само надолу"' },
  { id: 'r2', red: true, file: `${MOD}/posting/posting.probe-r2.ts`, imports: '../documents/documents.service',
    why: 'posting imports a file inside documents, not its index.ts: "само през неговия index.ts"' },
  { id: 'r3', red: true, file: `${MOD}/bank/bank.probe-r3.ts`, imports: '../vat/index',
    why: 'bank imports vat, same level L2, not in bank\'s "Ползва още" (posting)' },
  { id: 'r4', red: true, file: `${MOD}/tasks/tasks.probe-r4.ts`, imports: '../checks/index',
    why: 'tasks imports checks: ADR-011 "checks ползва tasks, а не обратно"' },
  { id: 'r5', red: true, file: `${MOD}/accounts/accounts.probe-r5.ts`, imports: '../companies/index',
    why: 'accounts imports companies, same level L0; only companies may use accounts' },
  { id: 'r6', red: true, file: `${MOD}/workspaces/workspaces.probe-r6.ts`, imports: '../files/index',
    why: 'workspaces imports files: ADR-011 "workspaces ползва само audit"' },
  { id: 'r7', red: true, file: `${MOD}/audit/audit.probe-r7.ts`, imports: '../workspaces/index',
    why: 'audit imports workspaces: ADR-011 "audit не ползва нищо"' },
  { id: 'r8', red: true, file: `${MOD}/counterparties/counterparties.probe-r8.ts`, imports: '../documents/index',
    why: 'counterparties imports documents, same level L1; only documents may use counterparties (no cycle)' },
  { id: 'r9', red: true, file: `${COMMON}/jobs/jobs.probe-r9.ts`, imports: '../../modules/documents/index',
    why: 'common imports a module: ADR-011 "Инфраструктурата ... не импортира модули"' },
  { id: 'r10', red: true, file: `${MOD}/documents/documents.probe-r10.service.ts`, imports: 'drizzle-orm',
    why: 'drizzle-orm in a *.service.ts: allowed only in *.repository.ts, *.queries.ts and common/db' },
  { id: 'r11', red: true, file: `${MOD}/documents/documents.probe-r11.controller.ts`, imports: 'drizzle-orm',
    why: 'drizzle-orm in a *.controller.ts: allowed only in *.repository.ts, *.queries.ts and common/db' },
  // green: allowed by ADR-011
  { id: 'g1', red: false, file: `${MOD}/posting/posting.probe-g1.ts`, imports: '../documents/index',
    why: 'posting (L2) imports documents (L1) through index.ts' },
  { id: 'g2', red: false, file: `${MOD}/bank/bank.probe-g2.ts`, imports: '../posting/index',
    why: 'bank uses posting: listed in "Ползва още"' },
  { id: 'g3', red: false, file: `${MOD}/vat/vat.probe-g3.ts`, imports: '../bank/index',
    why: 'vat uses bank: listed in "Ползва още"' },
  { id: 'g4', red: false, file: `${MOD}/checks/checks.probe-g4.ts`, imports: '../tasks/index',
    why: 'checks uses tasks: listed in "Ползва още"' },
  { id: 'g5', red: false, file: `${MOD}/dashboard/dashboard.probe-g5.ts`, imports: '../tasks/index',
    why: 'dashboard uses tasks: listed in "Ползва още"' },
  { id: 'g6', red: false, file: `${MOD}/companies/companies.probe-g6.ts`, imports: '../accounts/index',
    why: 'companies uses accounts: listed in "Ползва още"' },
  { id: 'g7', red: false, file: `${MOD}/workspaces/workspaces.probe-g7.ts`, imports: '../audit/index',
    why: 'workspaces uses audit: "workspaces ползва само audit"' },
  { id: 'g8', red: false, file: `${MOD}/files/files.probe-g8.ts`, imports: '../workspaces/index',
    why: 'files (L0) uses workspaces: "Всички други модули ползват workspaces"' },
  { id: 'g9', red: false, file: `${MOD}/invoicing/invoicing.probe-g9.ts`, imports: '../documents/index',
    why: 'invoicing uses documents: listed in "Ползва още"' },
  { id: 'g10', red: false, file: `${MOD}/documents/documents.probe-g10.ts`, imports: '../counterparties/index',
    why: 'documents uses counterparties: listed in "Ползва още"' },
  { id: 'g11', red: false, file: `${MOD}/reports/reports.probe-g11.ts`, imports: '../posting/index',
    why: 'reports (L3) uses posting (L2): a lower level' },
  { id: 'g12', red: false, file: `${MOD}/documents/documents.probe-g12.repository.ts`, imports: 'drizzle-orm',
    why: 'drizzle-orm in a *.repository.ts' },
  { id: 'g13', red: false, file: `${MOD}/documents/documents.probe-g13.queries.ts`, imports: 'drizzle-orm',
    why: 'drizzle-orm in a *.queries.ts' },
  { id: 'g14', red: false, file: `${COMMON}/db/db.probe-g14.ts`, imports: 'drizzle-orm',
    why: 'drizzle-orm in common/db' },
];

// Targets the probes import. Written only when missing, so an existing file is never touched.
const TARGETS = [
  ...['posting', 'documents', 'vat', 'checks', 'companies', 'files', 'workspaces', 'audit', 'tasks', 'bank', 'counterparties', 'accounts'].map(
    (m) => `${MOD}/${m}/index.ts`,
  ),
  `${MOD}/documents/documents.service.ts`,
];

const tokenOf = (p) => `.probe-${p.id}.`;

// The lines of the lint output that report a probe. Orphan warnings (a probe nobody imports) and warnings in general
// do not count: they neither make CI red nor say anything about the import.
function reportedLines(out, p) {
  return out
    .split('\n')
    .filter((l) => l.includes(tokenOf(p)))
    .filter((l) => !/orphan/i.test(l) && !/^\s*warn(ing)?\b/i.test(l));
}

describe('check 4: forbidden imports between probe modules make pnpm lint red', () => {
  const createdFiles = [];
  const createdDirs = [];
  let clean;
  let probed;

  function ensureDir(rel) {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const dir = join(root, ...parts.slice(0, i));
      if (!existsSync(dir)) {
        mkdirSync(dir);
        createdDirs.push(dir);
      }
    }
  }

  function writeNew(rel, content) {
    ensureDir(dirname(rel));
    const file = join(root, rel);
    if (existsSync(file)) return false;
    writeFileSync(file, content);
    createdFiles.push(file);
    return true;
  }

  function lint() {
    const r = spawnSync('pnpm', ['lint'], { cwd: root, encoding: 'utf8', timeout: 300_000, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
  }

  function cleanup() {
    for (const f of createdFiles.splice(0).reverse()) rmSync(f, { force: true });
    for (const d of createdDirs.splice(0).reverse()) {
      if (existsSync(d) && readdirSync(d).length === 0) rmdirSync(d);
    }
  }

  before(() => {
    clean = lint();
    for (const p of PROBES) {
      assert.ok(!existsSync(join(root, p.file)), `${p.file} already exists; the probe would overwrite it`);
    }
    for (const t of TARGETS) writeNew(t, 'export {};\n');
    for (const p of PROBES) writeNew(p.file, `// INV-65 lint probe ${p.id}: ${p.why}\nimport '${p.imports}';\n\nexport {};\n`);
    probed = lint();
  }, { timeout: 600_000 });

  after(cleanup);
  process.on('exit', cleanup);

  test('check 4b: pnpm lint passes on the skeleton without probes', () => {
    // check 1: CI runs `pnpm lint` and it must pass; this is also the control for the red cases below.
    assert.equal(clean.status, 0, `pnpm lint fails without probes:\n${clean.out.slice(-4000)}`);
  });

  test('check 4c: with forbidden probes in place, pnpm lint exits non-zero', () => {
    assert.notEqual(probed.status, 0, `pnpm lint passed with forbidden imports:\n${probed.out.slice(-4000)}`);
  });

  for (const p of PROBES.filter((x) => x.red)) {
    test(`check 4 ${p.id} red: ${p.why}`, () => {
      // check 4 + ADR-011 "Нивата и модулите" / "Как се проверява"
      assert.ok(reportedLines(probed.out, p).length > 0, `pnpm lint did not report ${p.file}:\n${probed.out.slice(-4000)}`);
    });
  }

  for (const p of PROBES.filter((x) => !x.red)) {
    test(`check 4 ${p.id} green: ${p.why}`, () => {
      // check 4 + ADR-011: allowed imports must not be reported
      assert.deepEqual(reportedLines(probed.out, p), [], `pnpm lint reported an allowed import in ${p.file}`);
    });
  }
});
