// INV-65: the product skeleton (repo, CI, CLAUDE.md).
// These tests check the structure the task asks for. They use node:test with no dependencies, so the root
// `pnpm test` must run them, e.g. `"test": "vitest run && node --test e2e/"` (see the test for check 1d).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Agent notes: "pnpm monorepo: apps/web, apps/api, packages/domain, packages/db, packages/shared".
const WORKSPACES = ['apps/web', 'apps/api', 'packages/domain', 'packages/db', 'packages/shared'];

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

function allDeps(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

function pnpm(args, cwd = root, timeout = 180_000) {
  return execFileSync('pnpm', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

// ---------------------------------------------------------------------------------------------------------------
// Check 1: "PR към invoicely минава CI: типове, lint, тестове, проверка за тайни."
// Agent notes: CI runs `pnpm install --frozen-lockfile`, then `pnpm typecheck`, `pnpm lint`, `pnpm test` from the
// root; the root package.json must have these three scripts and the repo a pnpm-lock.yaml; pnpm in CI is 10.34.9;
// `pnpm test` ends by itself (e.g. `vitest run`), without watch mode.

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
  const script = rootScripts().test;
  assert.equal(typeof script, 'string', 'root script "test" is missing');
  // Agent notes: "pnpm test свършва сам (например vitest run), без watch mode"
  assert.doesNotMatch(script, /--watch\b|--watchAll\b/, 'the test script must not use watch mode');
  // A bare `vitest` (without `run`) watches when not in CI.
  for (const m of script.matchAll(/\bvitest\b(\s+\S+)?/g)) {
    assert.equal((m[1] ?? '').trim(), 'run', `"${m[0]}" starts vitest in watch mode; use "vitest run"`);
  }
});

test('check 1d: pnpm test runs the tests in e2e/ (these skeleton tests)', () => {
  const script = rootScripts().test;
  assert.equal(typeof script, 'string', 'root script "test" is missing');
  // Check 1 "тестове": the CI test step is `pnpm test`, so the root test script must reach e2e/.
  assert.match(script, /e2e/, 'the root test script does not run e2e/');
});

test('check 1e: if package.json pins packageManager, it is the pnpm CI uses (10.34.9)', () => {
  const pkg = readJson('package.json');
  if (pkg.packageManager === undefined) return;
  // Agent notes: "pnpm в CI е 10.34.9"
  assert.match(pkg.packageManager, /^pnpm@10\.34\.9(\+.*)?$/);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 2: "README казва как се пуска локално с една команда."

test('check 2: README names one pnpm command, a root script, that runs the app locally', () => {
  const readme = readText('README.md');
  const scripts = rootScripts();
  // The CI scripts and install do not start the app, so they do not count as "how to run it locally".
  const notRun = new Set(['typecheck', 'lint', 'test', 'install', 'i', 'build']);
  const named = [...readme.matchAll(/`(?:[^`\n]*&&\s*)?pnpm\s+(?:run\s+)?([\w:-]+)[^`\n]*`|^\s*pnpm\s+(?:run\s+)?([\w:-]+)/gm)]
    .map((m) => m[1] ?? m[2])
    .filter((name) => !notRun.has(name) && typeof scripts[name] === 'string');
  assert.ok(named.length > 0, 'README names no `pnpm <script>` that is a root script for running the app locally');
});

// ---------------------------------------------------------------------------------------------------------------
// Какво: "празно приложение (web и api), което се билдва" + Agent notes on the stack and the monorepo layout.

test('criterion stack 1: pnpm workspace has apps/web, apps/api, packages/domain, packages/db, packages/shared', () => {
  assert.ok(existsSync(join(root, 'pnpm-workspace.yaml')), 'pnpm-workspace.yaml is missing');
  const listed = JSON.parse(pnpm(['-r', 'ls', '--depth', '-1', '--json']));
  const paths = listed.map((p) => p.path.split('\\').join('/'));
  for (const ws of WORKSPACES) {
    // Agent notes: "pnpm monorepo: apps/web, apps/api, packages/domain, packages/db, packages/shared"
    assert.ok(
      paths.some((p) => p.endsWith(`/${ws}`)),
      `${ws} is not a workspace package (got: ${paths.join(', ')})`,
    );
  }
});

for (const ws of WORKSPACES) {
  test(`criterion stack 2: ${ws} has a package.json with a name`, () => {
    const pkg = readJson(`${ws}/package.json`);
    assert.equal(typeof pkg.name, 'string'); // Agent notes: monorepo layout
    assert.notEqual(pkg.name, '');
  });
}

test('criterion stack 3: apps/web is a React SPA built with Vite', () => {
  const deps = allDeps(readJson('apps/web/package.json'));
  // Agent notes: "Стек: React SPA (Vite)"
  for (const name of ['react', 'react-dom', 'vite']) {
    assert.ok(name in deps, `apps/web does not depend on ${name}`);
  }
});

test('criterion stack 4: apps/api is a NestJS app', () => {
  const deps = allDeps(readJson('apps/api/package.json'));
  // Agent notes: "Стек: ... NestJS"
  for (const name of ['@nestjs/core', '@nestjs/common']) {
    assert.ok(name in deps, `apps/api does not depend on ${name}`);
  }
});

test('criterion stack 5: packages/db uses Drizzle', () => {
  const deps = allDeps(readJson('packages/db/package.json'));
  // Agent notes: "Стек: ... Supabase Postgres, Drizzle"
  assert.ok('drizzle-orm' in deps, 'packages/db does not depend on drizzle-orm');
});

for (const ws of WORKSPACES) {
  test(`criterion stack 6: ${ws} compiles with strict TypeScript`, () => {
    assert.ok(existsSync(join(root, ws, 'tsconfig.json')), `${ws}/tsconfig.json is missing`);
    // `tsc --showConfig` resolves `extends`, so a shared base config counts.
    const config = JSON.parse(pnpm(['exec', 'tsc', '--showConfig', '-p', 'tsconfig.json'], join(root, ws), 60_000));
    // Agent notes: "Strict TypeScript."
    assert.equal(config.compilerOptions?.strict, true, `${ws}: compilerOptions.strict is not true`);
  });
}

for (const app of ['apps/web', 'apps/api']) {
  test(`criterion build: the empty ${app} builds`, () => {
    const pkg = readJson(`${app}/package.json`);
    // Какво: "празно приложение (web и api), което се билдва"
    assert.equal(typeof pkg.scripts?.build, 'string', `${app} has no build script`);
    pnpm(['--dir', app, 'run', 'build']); // throws when the build exits non-zero
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Agent notes: "CLAUDE.md: кратка карта на repo-то, командите и правилата."

test('criterion CLAUDE.md 1: CLAUDE.md maps the repo: every workspace path is named', () => {
  const text = readText('CLAUDE.md');
  for (const ws of WORKSPACES) {
    assert.ok(text.includes(ws), `CLAUDE.md does not name ${ws}`); // "карта на repo-то"
  }
});

test('criterion CLAUDE.md 2: CLAUDE.md names the commands pnpm typecheck, pnpm lint and pnpm test', () => {
  const text = readText('CLAUDE.md');
  for (const cmd of ['pnpm typecheck', 'pnpm lint', 'pnpm test']) {
    assert.ok(text.includes(cmd), `CLAUDE.md does not name "${cmd}"`); // "командите"
  }
});

test('criterion CLAUDE.md 3: CLAUDE.md states the rules: money in integer euro cents, fixtures/etalons locked', () => {
  const text = readText('CLAUDE.md');
  // "правилата" + Agent notes: "Пари само в цели евроцентове." and "fixtures/etalons/ са заключени"
  assert.match(text, /cent|цент/i, 'CLAUDE.md does not state the euro-cents rule');
  assert.ok(text.includes('fixtures/etalons'), 'CLAUDE.md does not state that fixtures/etalons is locked');
});
