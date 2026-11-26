// INV-67: staging on Render (web and api, region Frankfurt, deploy from main), by ADR-013 Хостинг, данни и операции.
// One test (or more) per check in "Как проверявам"; the check number is the bullet's place in that list:
//   1 render.yaml with two services, 2 api address and CORS from render.yaml, 3 Dockerfile, 4 .dockerignore,
//   5 tests from the files and `pnpm build`, 6 README "Staging".
// Agent notes add: no secrets in render.yaml now; when they come they are `sync: false`.
// render.yaml is parsed with the `yaml` package (or `js-yaml`), which must be a root devDependency.
// Tests in one file run one after another, so the builds never overlap the api started for check 2 and check 3.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, posix, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const { fetch } = globalThis;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Check 1: the service names, the region and the branch.
const WEB = 'invoicely-web';
const API = 'invoicely-api';
const REGION = 'frankfurt';
const BRANCH = 'main';

// Probe values passed through the env, so a test sees that the value comes from the env and not from the code.
const PROBE_API_URL = 'https://invoicely-api-probe67.onrender.com';
const PROBE_WEB_ORIGIN = 'https://invoicely-web-probe67.onrender.com';
const OTHER_ORIGIN = 'https://chuzhd-sait.example.bg';

function readText(rel) {
  const file = join(root, rel);
  assert.ok(existsSync(file), `${rel} is missing`);
  return readFileSync(file, 'utf8');
}

async function parseYaml(text) {
  for (const [name, parse] of [
    ['yaml', (m) => m.parse],
    ['js-yaml', (m) => m.load ?? m.default?.load],
  ]) {
    try {
      const mod = await import(name);
      return parse(mod.default && !mod.parse && !mod.load ? mod.default : mod)(text);
    } catch (e) {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    }
  }
  assert.fail('no YAML parser: add `yaml` as a root devDependency so the tests can read render.yaml');
}

let blueprintCache;
async function blueprint() {
  if (blueprintCache === undefined) {
    const text = readText('render.yaml'); // check 1: "В корена има render.yaml"
    blueprintCache = await parseYaml(text);
  }
  return blueprintCache;
}

async function service(name) {
  const bp = await blueprint();
  assert.ok(Array.isArray(bp?.services), 'render.yaml has no services list');
  const s = bp.services.find((x) => x?.name === name);
  assert.ok(s, `render.yaml has no service named ${name}`);
  return s;
}

const runtimeOf = (s) => s.runtime ?? s.env;
const envVarsOf = (s) => (Array.isArray(s.envVars) ? s.envVars : []);

// An env var of `from` whose value points to the service `to`: a literal address with its name, or fromService.
function envVarPointingTo(from, to) {
  return envVarsOf(from).find(
    (v) => (typeof v?.value === 'string' && v.value.includes(to)) || v?.fromService?.name === to,
  );
}

function pnpm(args, opts = {}) {
  return execFileSync('pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

async function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Check 1: "В корена има render.yaml (Render Blueprint) с две услуги. И двете са в регион frankfurt, от клона main, с
// автоматичен деплой при всяко сливане: invoicely-web: static site, който билдва apps/web и публикува apps/web/dist;
// път без файл връща index.html (SPA); invoicely-api: web service с runtime: docker, план free и healthCheckPath: /health."

test('check 1a: render.yaml at the root has exactly the two services invoicely-web and invoicely-api', async () => {
  const bp = await blueprint();
  assert.ok(Array.isArray(bp?.services), 'render.yaml has no services list');
  const names = bp.services.map((s) => s?.name).sort();
  assert.deepEqual(names, [API, WEB]); // check 1: "с две услуги", the names invoicely-web and invoicely-api
});

test('check 1b: invoicely-api is in region frankfurt', async () => {
  assert.equal((await service(API)).region, REGION); // check 1: "И двете са в регион frankfurt"; ADR-013 "Франкфурт"
});

// Yoan's answer in Linear (INV-67, corrected check 1): a Render static site has no region, it is served from the CDN;
// "invoicely-web" is without region and the frankfurt check applies only to "invoicely-api" (ADR-013).
test('check 1b: invoicely-web has no region (a static site is served from the Render CDN)', async () => {
  const s = await service(WEB);
  assert.equal(s.region, undefined, `invoicely-web sets region: ${s.region}`); // Yoan's answer: "invoicely-web е без регион"
});

for (const name of [WEB, API]) {
  test(`check 1c: ${name} deploys from branch main`, async () => {
    assert.equal((await service(name)).branch, BRANCH); // check 1: "от клона main"
  });

  test(`check 1d: ${name} deploys automatically on every merge to main`, async () => {
    const s = await service(name);
    // check 1: "с автоматичен деплой при всяко сливане"; Render: `autoDeploy: true` or `autoDeployTrigger: commit`.
    assert.ok(
      s.autoDeploy === true || s.autoDeployTrigger === 'commit',
      `${name}: neither autoDeploy: true nor autoDeployTrigger: commit (got autoDeploy=${s.autoDeploy}, autoDeployTrigger=${s.autoDeployTrigger})`,
    );
  });
}

test('check 1e: invoicely-web is a static site', async () => {
  const s = await service(WEB);
  assert.equal(s.type, 'web'); // Render Blueprint: a static site is type web ...
  assert.equal(runtimeOf(s), 'static'); // ... with runtime static; check 1: "static site"; ADR-013 "web: static site"
});

test('check 1f: invoicely-web builds apps/web with pnpm', async () => {
  const s = await service(WEB);
  const cmd = `${s.buildCommand ?? ''}`;
  assert.match(cmd, /\bpnpm\b/, `buildCommand does not use pnpm: "${cmd}"`); // CLAUDE.md: pnpm monorepo
  const inWebDir = typeof s.rootDir === 'string' && posix.normalize(s.rootDir) === 'apps/web';
  // check 1: "билдва apps/web"
  assert.ok(inWebDir || /apps\/web|@invoicely\/web/.test(cmd), `buildCommand does not build apps/web: "${cmd}"`);
});

test('check 1g: invoicely-web publishes apps/web/dist', async () => {
  const s = await service(WEB);
  assert.equal(typeof s.staticPublishPath, 'string', 'invoicely-web has no staticPublishPath');
  const published = posix.normalize(posix.join(s.rootDir ?? '.', s.staticPublishPath)).replace(/^\.\//, '').replace(/\/$/, '');
  assert.equal(published, 'apps/web/dist'); // check 1: "публикува apps/web/dist"
});

test('check 1h: invoicely-web rewrites a path without a file to /index.html (SPA)', async () => {
  const s = await service(WEB);
  const routes = Array.isArray(s.routes) ? s.routes : [];
  // check 1: "път без файл връща index.html (SPA)"; Render serves an existing file first and applies the rewrite otherwise.
  const spa = routes.find((r) => r?.type === 'rewrite' && r.source === '/*' && r.destination === '/index.html');
  assert.ok(spa, `no route { type: rewrite, source: /*, destination: /index.html } (got ${JSON.stringify(routes)})`);
});

test('check 1i: invoicely-api is a web service with runtime docker', async () => {
  const s = await service(API);
  assert.equal(s.type, 'web'); // check 1: "web service"
  assert.equal(runtimeOf(s), 'docker'); // check 1: "runtime: docker"
});

test('check 1j: invoicely-api is on plan free', async () => {
  assert.equal((await service(API)).plan, 'free'); // check 1: "план free"; Agent notes: "Планът на api засега е free"
});

test('check 1k: invoicely-api has healthCheckPath /health', async () => {
  assert.equal((await service(API)).healthCheckPath, '/health'); // check 1: "healthCheckPath: /health"
});

// Agent notes: "Сега в render.yaml няма тайни; когато дойдат, са sync: false и Йоан ги слага в Render."
test('agent notes: render.yaml holds no secret values; a secret env var is sync: false', async () => {
  const bp = await blueprint();
  const secretName = /SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY|SERVICE_ROLE|DATABASE_URL|_KEY$/i;
  const leaks = [];
  const groups = Array.isArray(bp?.envVarGroups) ? bp.envVarGroups : [];
  const all = [...(bp?.services ?? []), ...groups].flatMap((s) => envVarsOf(s).map((v) => ({ owner: s.name, v })));
  for (const { owner, v } of all) {
    if (typeof v?.value !== 'string') continue;
    if (secretName.test(v.key ?? '')) leaks.push(`${owner}.${v.key}: a literal value (should be sync: false)`);
    if (/eyJ[\w-]{10,}\.[\w-]{10,}|sk-ant-|postgres(ql)?:\/\/[^\s]*:[^\s@]+@/.test(v.value)) leaks.push(`${owner}.${v.key}: looks like a secret`);
  }
  assert.deepEqual(leaks, []);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 2: "Web взима адреса на api от render.yaml, не от адрес, вписан в кода. Api приема заявки от адреса на web
// (CORS), също от render.yaml."

test('check 2a: render.yaml gives invoicely-web the api address in a VITE_ env var', async () => {
  const v = envVarPointingTo(await service(WEB), API);
  assert.ok(v, 'invoicely-web has no env var whose value or fromService points to invoicely-api'); // check 2
  // Vite puts only VITE_* variables into the browser bundle at build time.
  assert.match(v.key ?? '', /^VITE_/, `the api address variable "${v.key}" is not VITE_*, so the SPA cannot read it`);
});

test('check 2b: render.yaml gives invoicely-api the web address for CORS', async () => {
  const v = envVarPointingTo(await service(API), WEB);
  // check 2: "Api приема заявки от адреса на web (CORS), също от render.yaml"
  assert.ok(v, 'invoicely-api has no env var whose value or fromService points to invoicely-web');
  assert.equal(typeof v.key, 'string');
});

test('check 2c: the code of web and api has no Render address written in it', () => {
  const places = ['apps/web/src', 'apps/web/index.html', 'apps/web/vite.config.ts', 'apps/api/src'];
  const hits = [];
  for (const rel of places) {
    const abs = join(root, rel);
    const files = existsSync(abs) && statSync(abs).isDirectory() ? filesUnder(abs) : existsSync(abs) ? [abs] : [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      // check 2: "не от адрес, вписан в кода"
      if (/onrender\.com|https?:\/\/invoicely-(web|api)\b/.test(text)) hits.push(f.slice(root.length + 1));
    }
  }
  assert.deepEqual(hits, [], `files with a Render address written in: ${hits.join(', ')}`);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 5: "Тестове проверяват горното от файловете. pnpm build от корена билдва web и api." Before the behaviour tests
// of checks 2 and 3, which need the build.

test('check 5: pnpm build from the root builds web (apps/web/dist/index.html) and api (apps/api/dist/main.js)', { timeout: 400_000 }, () => {
  const started = Date.now() - 2000;
  pnpm(['build'], { timeout: 400_000 }); // throws when the build exits non-zero
  for (const rel of ['apps/web/dist/index.html', 'apps/api/dist/main.js']) {
    const f = join(root, rel);
    // check 1 "публикува apps/web/dist"; ADR-013 api command "node dist/main.js"
    assert.ok(existsSync(f), `pnpm build did not produce ${rel}`);
    assert.ok(statSync(f).mtimeMs >= started, `${rel} was not rebuilt by pnpm build`);
  }
});

test('check 2d: the web build takes the api address from the env var render.yaml sets', { timeout: 300_000 }, async () => {
  const v = envVarPointingTo(await service(WEB), API);
  assert.ok(v?.key, 'invoicely-web has no env var for the api address');
  pnpm(['--dir', 'apps/web', 'run', 'build'], { env: { ...process.env, [v.key]: PROBE_API_URL } });
  const bundle = filesUnder(join(root, 'apps/web/dist'))
    .filter((f) => /\.(js|html)$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  // check 2: "Web взима адреса на api от render.yaml": the address given at build time is the one the SPA uses.
  assert.ok(bundle.includes(PROBE_API_URL), `apps/web/dist does not contain ${PROBE_API_URL} given in ${v.key}`);
});

// ---------------------------------------------------------------------------------------------------------------
// Checks 2 and 3 on the running api: `node dist/main.js` (ADR-013) in apps/api, on the port from PORT, with the CORS
// variable from render.yaml.

describe('the api started as in the image: node dist/main.js with PORT and the web address', () => {
  let child;
  let port;
  let out = '';
  let corsKey;

  async function startApi() {
    if (child) return;
    const v = envVarPointingTo(await service(API), WEB);
    assert.ok(v?.key, 'invoicely-api has no env var for the web address');
    corsKey = v.key;
    assert.ok(existsSync(join(root, 'apps/api/dist/main.js')), 'apps/api/dist/main.js is missing; pnpm build did not build the api');
    port = await freePort();
    assert.notEqual(port, 3000);
    child = spawn('node', ['dist/main.js'], {
      cwd: join(root, 'apps/api'),
      detached: true,
      env: { ...process.env, PORT: String(port), [corsKey]: PROBE_WEB_ORIGIN, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        await fetch(`http://127.0.0.1:${port}/health`);
        return;
      } catch {
        await sleep(500);
      }
    }
    assert.fail(`the api did not answer on the port from PORT (${port}); it printed:\n${out.slice(-3000)}`);
  }

  after(() => {
    if (!child) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  });

  test('check 3a: the api listens on the port from PORT and GET /health returns 200', { timeout: 90_000 }, async () => {
    await startApi();
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    // check 3: "пуска apps/api на порта от PORT, който дава Render"; check 1: "healthCheckPath: /health"
    assert.equal(r.status, 200);
  });

  test('check 2e: the api allows CORS from the web address given in the render.yaml variable', { timeout: 90_000 }, async () => {
    await startApi();
    const pre = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'OPTIONS',
      headers: { Origin: PROBE_WEB_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });
    // check 2: "Api приема заявки от адреса на web (CORS), също от render.yaml"
    assert.equal(pre.headers.get('access-control-allow-origin'), PROBE_WEB_ORIGIN, `preflight from ${PROBE_WEB_ORIGIN} (${corsKey})`);
    const get = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: PROBE_WEB_ORIGIN } });
    assert.equal(get.headers.get('access-control-allow-origin'), PROBE_WEB_ORIGIN, `GET from ${PROBE_WEB_ORIGIN}`);
  });

  test('check 2f: the api does not allow CORS from another origin', { timeout: 90_000 }, async () => {
    await startApi();
    const pre = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'OPTIONS',
      headers: { Origin: OTHER_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });
    const allowed = pre.headers.get('access-control-allow-origin');
    // check 2: CORS accepts the address of web, so not every origin
    assert.notEqual(allowed, '*', 'the api allows every origin');
    assert.notEqual(allowed, OTHER_ORIGIN, `the api allows ${OTHER_ORIGIN}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Check 3: "Dockerfile за api билдва от корена на monorepo-то с pnpm и пуска apps/api на порта от PORT, който дава Render.
// Командата за старт е отделна, защото същият image по-късно пуска и worker-а (ADR-013)."

// Instructions of a Dockerfile, with line continuations joined and comments dropped.
function dockerInstructions(text) {
  const joined = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
    .replace(/\\\r?\n/g, ' ');
  return joined
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\w+)\s+([\s\S]*)$/.exec(l);
      return m ? { op: m[1].toUpperCase(), args: m[2].trim() } : { op: l.toUpperCase(), args: '' };
    });
}

async function apiDocker() {
  const s = await service(API);
  const context = posix.normalize(s.dockerContext ?? '.').replace(/\/$/, '');
  const path = posix.normalize(s.dockerfilePath ?? './Dockerfile');
  return { context, path, ins: dockerInstructions(readText(path)) };
}

test('check 3b: the api image builds from the root of the monorepo (dockerContext is the root)', async () => {
  const { context } = await apiDocker(); // reads the Dockerfile render.yaml names (default ./Dockerfile)
  assert.equal(context, '.'); // check 3: "билдва от корена на monorepo-то"
});

test('check 3c: the Dockerfile uses Node 22 and pnpm 10.34.9', async () => {
  const { ins } = await apiDocker();
  const froms = ins.filter((i) => i.op === 'FROM').map((i) => i.args);
  assert.ok(froms.length > 0, 'the Dockerfile has no FROM');
  for (const f of froms) assert.match(f, /^(--platform=\S+\s+)?node:22\b/, `FROM ${f}`); // CLAUDE.md: Node 22
  const runs = ins.filter((i) => i.op === 'RUN').map((i) => i.args).join('\n');
  // check 3 "с pnpm"; CLAUDE.md: pnpm 10.34.9, pinned in package.json packageManager (corepack reads it)
  assert.match(runs, /corepack\s+(enable|prepare)|pnpm@10\.34\.9/, 'the Dockerfile does not set up pnpm through corepack or pnpm@10.34.9');
});

test('check 3d: the Dockerfile installs the workspace with pnpm install --frozen-lockfile from the root lockfile', async () => {
  const { ins } = await apiDocker();
  const copies = ins.filter((i) => i.op === 'COPY' || i.op === 'ADD').map((i) => i.args).join('\n');
  // check 3: "билдва от корена на monorepo-то с pnpm": the root lockfile and workspace file go into the image
  assert.ok(/(^|\n)(--\S+\s+)*\.\/?\s+\S+/.test(copies) || (/pnpm-lock\.yaml/.test(copies) && /pnpm-workspace\.yaml/.test(copies)),
    'the Dockerfile copies neither the whole root nor pnpm-lock.yaml and pnpm-workspace.yaml');
  const runs = ins.filter((i) => i.op === 'RUN').map((i) => i.args);
  assert.ok(runs.some((r) => /\bpnpm\b[^\n]*\binstall\b[^\n]*--frozen-lockfile/.test(r)), 'no RUN pnpm install --frozen-lockfile');
});

test('check 3e: the Dockerfile builds apps/api with pnpm', async () => {
  const { ins } = await apiDocker();
  const runs = ins.filter((i) => i.op === 'RUN').map((i) => i.args);
  // check 3: "билдва ... с pnpm"
  assert.ok(
    runs.some((r) => /\bpnpm\b/.test(r) && /\bbuild\b/.test(r) && /@invoicely\/api|apps\/api|\bpnpm\s+(-r\s+|run\s+)?build\b/.test(r)),
    `no RUN that builds apps/api with pnpm (RUN lines: ${runs.join(' | ')})`,
  );
});

test('check 3f: the start command node dist/main.js of apps/api is a separate CMD, not baked into ENTRYPOINT', async () => {
  const { ins } = await apiDocker();
  const cmds = ins.filter((i) => i.op === 'CMD');
  assert.ok(cmds.length > 0, 'the Dockerfile has no CMD'); // check 3: "Командата за старт е отделна"
  const cmdIndex = ins.lastIndexOf(cmds[cmds.length - 1]);
  const cmd = cmds[cmds.length - 1].args;
  let words;
  try {
    words = JSON.parse(cmd);
  } catch {
    words = cmd.split(/\s+/);
  }
  const workdir = ins.slice(0, cmdIndex).filter((i) => i.op === 'WORKDIR').map((i) => i.args).pop() ?? '';
  const inApiDir = /(^|\/)apps\/api\/?$/.test(workdir);
  // ADR-013: "api: Docker образ, команда node dist/main.js"; check 3 "пуска apps/api"
  assert.equal(words[0], 'node', `CMD ${cmd}`);
  assert.ok(
    words.includes('apps/api/dist/main.js') || (inApiDir && words.includes('dist/main.js')),
    `CMD ${cmd} (WORKDIR ${workdir || 'none'}) does not run apps/api/dist/main.js`,
  );
  // ADR-013: the worker runs the same image with `node dist/worker.js`, so the entrypoint must not fix the api.
  const entry = ins.filter((i) => i.op === 'ENTRYPOINT').map((i) => i.args).join(' ');
  assert.doesNotMatch(entry, /main\.js|apps\/api|\bstart\b/, `ENTRYPOINT ${entry} fixes the api start`);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 4: ".dockerignore не пуска в image-а node_modules, .git, .env* и .claude/."
// Docker reads .dockerignore at the root of the build context (the repo root, check 3b). Matching follows Docker: a
// path is out when the last pattern that matches it or one of its parent folders is not a `!` exception.

function dockerignorePatterns() {
  return readText('.dockerignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function globToRegex(p) {
  const clean = p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/^\.\//, '');
  let rx = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '*' && clean[i + 1] === '*') {
      if (clean[i + 2] === '/') {
        rx += '(?:.*/)?';
        i += 2;
      } else {
        rx += '.*';
        i += 1;
      }
    } else if (c === '*') rx += '[^/]*';
    else if (c === '?') rx += '[^/]';
    else rx += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${rx}$`);
}

function ignored(path, patterns) {
  const parts = path.split('/');
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let out = false;
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    const rx = globToRegex(neg ? raw.slice(1) : raw);
    if (prefixes.some((p) => rx.test(p))) out = !neg;
  }
  return out;
}

const KEPT_OUT = {
  node_modules: ['node_modules/.pnpm/lock.yaml', 'apps/api/node_modules/@nestjs/core/package.json', 'apps/web/node_modules/vite/package.json', 'packages/domain/node_modules/x/index.js'],
  '.git': ['.git/HEAD', '.git'],
  '.env*': ['.env', '.env.local', '.env.staging', 'apps/api/.env', 'apps/api/.env.local'],
  '.claude/': ['.claude/settings.json', '.claude/worktrees/inv-68/package.json'],
};

for (const [what, paths] of Object.entries(KEPT_OUT)) {
  test(`check 4: .dockerignore keeps ${what} out of the image`, () => {
    const patterns = dockerignorePatterns();
    const leaked = paths.filter((p) => !ignored(p, patterns));
    // check 4: ".dockerignore не пуска в image-а node_modules, .git, .env* и .claude/"; nested node_modules and .env
    // of the workspaces would reach the image too.
    assert.deepEqual(leaked, [], `these paths would go into the image: ${leaked.join(', ')}`);
  });
}

test('check 4: .dockerignore keeps in what the build from the root needs', () => {
  const patterns = dockerignorePatterns();
  const needed = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'apps/api/package.json',
    'apps/api/tsconfig.build.json', 'apps/api/src/main.ts', 'packages/shared/package.json', 'packages/domain/package.json',
    'packages/db/package.json'];
  const dropped = needed.filter((p) => ignored(p, patterns));
  // check 3: the image "билдва от корена на monorepo-то с pnpm", so these must reach it.
  assert.deepEqual(dropped, [], `.dockerignore drops files the build needs: ${dropped.join(', ')}`);
});

// ---------------------------------------------------------------------------------------------------------------
// Check 6: "README има раздел "Staging": адресите и как става нов деплой."

function stagingSection() {
  const lines = readText('README.md').split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s+Staging\b/i.test(l));
  assert.ok(start >= 0, 'README has no "Staging" heading'); // check 6
  const level = /^#+/.exec(lines[start])[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = /^(#{1,6})\s/.exec(l);
    return m && m[1].length <= level;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

test('check 6a: README "Staging" gives the web and api addresses', () => {
  const text = stagingSection();
  // check 6: "адресите"; Render names the onrender.com address after the service (check 1).
  assert.match(text, /https:\/\/invoicely-web[\w-]*\.onrender\.com/, 'the Staging section has no web address');
  assert.match(text, /https:\/\/invoicely-api[\w-]*\.onrender\.com/, 'the Staging section has no api address');
});

test('check 6b: README "Staging" says a new deploy comes from a merge to main', () => {
  const text = stagingSection();
  // check 6: "как става нов деплой"; Какво: "Всяко сливане в main се вижда на staging"
  assert.match(text, /\bmain\b/, 'the Staging section does not name main');
  assert.match(text, /слива|merge/i, 'the Staging section does not say that a merge deploys');
});

test('check 6c: the api address in README is the one render.yaml gives web, when render.yaml writes it out', async () => {
  const v = envVarPointingTo(await service(WEB), API);
  assert.ok(v, 'invoicely-web has no env var for the api address');
  if (typeof v.value !== 'string') return; // fromService: Render fills it, there is no literal to compare
  const host = new URL(v.value).host;
  // check 2 and check 6: one api address, in render.yaml and in README
  assert.ok(stagingSection().includes(host), `README "Staging" does not name the api host ${host} from render.yaml`);
});

// ---------------------------------------------------------------------------------------------------------------
// INV-74: the real api address on staging. Render gave the api https://invoicely-api-maco.onrender.com, because
// invoicely-api.onrender.com belongs to another service. One test (or more) per check in "Как проверявам":
//   1 VITE_API_URL of web and WEB_ORIGIN of api in render.yaml, 2 README "Staging", 3 one api address in both.
// The third check also asks that the staging tests in this file pass; that is the whole file, run by `pnpm test`.

const STAGING_API_URL = 'https://invoicely-api-maco.onrender.com'; // INV-74 check 1 and check 2
const STAGING_WEB_URL = 'https://invoicely-web.onrender.com'; // INV-74 check 1 and Agent notes: web is Live there
const FOREIGN_API_URL = 'https://invoicely-api.onrender.com'; // INV-74 Какво: "invoicely-api.onrender.com е на чужда услуга"

function envVarValue(s, key) {
  const v = envVarsOf(s).find((x) => x?.key === key);
  assert.ok(v, `${s.name} has no env var ${key}`);
  return v.value;
}

// Every api address (https://invoicely-api*.onrender.com) written in a text, as distinct origins.
function apiOriginsIn(text) {
  const urls = text.match(/https:\/\/invoicely-api[\w-]*\.onrender\.com/g) ?? [];
  return [...new Set(urls.map((u) => new URL(u).origin))];
}

test('INV-74 check 1a: render.yaml sets VITE_API_URL of invoicely-web to https://invoicely-api-maco.onrender.com', async () => {
  // INV-74 check 1: "В render.yaml VITE_API_URL на invoicely-web е https://invoicely-api-maco.onrender.com"
  assert.equal(envVarValue(await service(WEB), 'VITE_API_URL'), 'https://invoicely-api-maco.onrender.com');
});

test('INV-74 check 1b: render.yaml keeps WEB_ORIGIN of invoicely-api at https://invoicely-web.onrender.com', async () => {
  // INV-74 check 1: "WEB_ORIGIN на api остава https://invoicely-web.onrender.com"
  assert.equal(envVarValue(await service(API), 'WEB_ORIGIN'), 'https://invoicely-web.onrender.com');
});

test('INV-74 check 1c: render.yaml no longer names the foreign service https://invoicely-api.onrender.com', () => {
  // INV-74 Какво: "Сега бъндълът на web сочи към чуждата услуга"
  assert.ok(!readText('render.yaml').includes(FOREIGN_API_URL), `render.yaml still names ${FOREIGN_API_URL}`);
});

test('INV-74 check 2: README "Staging" gives the api address https://invoicely-api-maco.onrender.com, not the foreign one', () => {
  const text = stagingSection();
  // INV-74 check 2: "В README.md, раздел Staging, адресът на api е https://invoicely-api-maco.onrender.com"
  assert.ok(text.includes(STAGING_API_URL), `the Staging section does not name ${STAGING_API_URL}`);
  assert.ok(!text.includes(FOREIGN_API_URL), `the Staging section still names the foreign service ${FOREIGN_API_URL}`);
  // Agent notes: "web на https://invoicely-web.onrender.com"; the web address stays in the section
  assert.ok(text.includes(STAGING_WEB_URL), `the Staging section does not name the web address ${STAGING_WEB_URL}`);
});

test('INV-74 check 3: the api address is one and the same in render.yaml and in README "Staging"', async () => {
  const fromYaml = envVarValue(await service(WEB), 'VITE_API_URL');
  // INV-74 check 3: "адресът на api в render.yaml и в README е един и същ", so render.yaml writes it out (not fromService)
  assert.equal(typeof fromYaml, 'string', 'VITE_API_URL of invoicely-web has no literal value to compare with README');
  const yamlOrigins = apiOriginsIn(readText('render.yaml'));
  const readmeOrigins = apiOriginsIn(stagingSection());
  assert.deepEqual(yamlOrigins, [new URL(fromYaml).origin], `render.yaml names more than one api address: ${yamlOrigins.join(', ')}`);
  assert.deepEqual(readmeOrigins, yamlOrigins, 'README "Staging" and render.yaml name different api addresses');
});
