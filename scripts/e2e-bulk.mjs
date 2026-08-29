// Bulk end-to-end: 10 new subjects, 20 chapters, every part rendered.
// Runs a few chapters concurrently; each chapter is book -> pages -> render all parts.
const BASE = 'http://localhost:3100/api/handbooks';
const CONCURRENCY = Number(process.argv[2] ?? 3);

// A dropped connection mid-run used to abort a chapter that was minutes of AI work
// from finishing, so network-level failures get a few attempts.
const RETRY = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const json = async (url, init) => {
  let r;
  for (let attempt = 1; ; attempt++) {
    try { r = await fetch(url, init); break; }
    catch (err) {
      if (attempt >= RETRY) throw new Error(`${url} failed after ${RETRY} attempts: ${err}`);
      console.log(`  retry ${attempt}/${RETRY - 1} after ${String(err).slice(0, 60)}`);
      await sleep(1000 * attempt);
    }
  }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${r.status} ${(b.error ?? '').slice(0, 120)}`);
  return b;
};
const post = (url, body) =>
  json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const SUBJECTS = [
  { slug: 'javascript', name: 'JavaScript', emoji: '🟨', chapters: [
    { slug: 'event-loop', title: 'The Event Loop', topic: 'JavaScript event loop: call stack, task queue, microtasks, promises, starvation' },
    { slug: 'closures-scope', title: 'Closures & Scope', topic: 'JavaScript closures and scope: var/let/const, hoisting, TDZ, IIFE, module pattern' },
  ] },
  { slug: 'typescript', name: 'TypeScript', emoji: '🔷', chapters: [
    { slug: 'generics', title: 'Generics', topic: 'TypeScript generics: type parameters, constraints, inference, conditional types, variance' },
    { slug: 'narrowing', title: 'Type Narrowing', topic: 'TypeScript narrowing: typeof, instanceof, discriminated unions, type predicates, never' },
  ] },
  { slug: 'react', name: 'React', emoji: '⚛️', chapters: [
    { slug: 'hooks-rules', title: 'Hooks & Their Rules', topic: 'React hooks: useState, useEffect dependencies, cleanup, rules of hooks, custom hooks' },
    { slug: 'rendering', title: 'Rendering & Reconciliation', topic: 'React rendering: reconciliation, keys, memo, useMemo, useCallback, when re-renders happen' },
  ] },
  { slug: 'nodejs', name: 'Node.js', emoji: '🟩', chapters: [
    { slug: 'streams', title: 'Streams', topic: 'Node.js streams: readable, writable, transform, backpressure, pipeline, error handling' },
    { slug: 'async-patterns', title: 'Async Patterns', topic: 'Node.js async: callbacks, promises, async/await, concurrency limits, unhandled rejections' },
  ] },
  { slug: 'docker', name: 'Docker', emoji: '🐳', chapters: [
    { slug: 'images-layers', title: 'Images & Layers', topic: 'Docker images: layers, caching, multi-stage builds, image size, .dockerignore' },
    { slug: 'networking-volumes', title: 'Networking & Volumes', topic: 'Docker networking and volumes: bridge, host, ports, bind mounts, named volumes, permissions' },
  ] },
  { slug: 'kubernetes', name: 'Kubernetes', emoji: '☸️', chapters: [
    { slug: 'pods-deployments', title: 'Pods & Deployments', topic: 'Kubernetes pods and deployments: replicasets, rolling updates, probes, resource requests and limits' },
    { slug: 'services-ingress', title: 'Services & Ingress', topic: 'Kubernetes services and ingress: ClusterIP, NodePort, LoadBalancer, DNS, ingress rules, TLS' },
  ] },
  { slug: 'git', name: 'Git', emoji: '🌿', chapters: [
    { slug: 'rebase-merge', title: 'Rebase vs Merge', topic: 'Git rebase and merge: fast-forward, three-way merge, interactive rebase, conflicts, when to use each' },
    { slug: 'undo-recovery', title: 'Undo & Recovery', topic: 'Git undo: reset soft/mixed/hard, revert, restore, reflog, recovering lost commits, stash' },
  ] },
  { slug: 'linux', name: 'Linux', emoji: '🐧', chapters: [
    { slug: 'permissions', title: 'Permissions & Ownership', topic: 'Linux permissions: rwx bits, octal, chmod, chown, umask, setuid, sticky bit, ACLs' },
    { slug: 'processes-signals', title: 'Processes & Signals', topic: 'Linux processes and signals: fork, exec, PIDs, SIGTERM vs SIGKILL, zombies, job control' },
  ] },
  { slug: 'networking', name: 'Networking', emoji: '🌐', chapters: [
    { slug: 'tcp-handshake', title: 'TCP & Handshakes', topic: 'TCP: three-way handshake, sequence numbers, congestion control, TIME_WAIT, keepalive' },
    { slug: 'dns-tls', title: 'DNS & TLS', topic: 'DNS and TLS: resolution steps, records, caching, TTL, TLS handshake, certificates, SNI' },
  ] },
  { slug: 'security', name: 'Security', emoji: '🔐', chapters: [
    { slug: 'auth-sessions', title: 'Auth & Sessions', topic: 'Web auth: sessions vs JWT, cookie flags, CSRF, password hashing with bcrypt/argon2, rotation' },
    { slug: 'injection', title: 'Injection & Escaping', topic: 'Injection attacks: SQL injection, XSS, command injection, parameterised queries, output encoding' },
  ] },
];

const results = [];
const failures = [];

async function buildChapter(subject, ch) {
  const tag = `${subject.slug}/${ch.slug}`;
  try {
    await post(`${BASE}/${subject.slug}`, { slug: ch.slug, title: ch.title }).catch(() => {});

    const { book } = await post(`${BASE}/${subject.slug}/${ch.slug}/book`, {
      action: 'generate', mode: 'topic', topic: ch.topic,
    });
    const points = book.chapters.reduce((n, x) => n + x.points.length, 0);

    const plan = await post(`${BASE}/${subject.slug}/${ch.slug}/parts/1/plan`, {});

    // Render part 1, then every part spillover created, until none are left unrendered.
    const rendered = [];
    for (let part = 1; part <= 6; part++) {
      const meta = await json(`${BASE}/${subject.slug}/${ch.slug}`);
      if (!meta.parts.includes(part)) break;
      const r = await post(`${BASE}/${subject.slug}/${ch.slug}/parts/${part}/render`, {});
      const fills = r.results.map((x) => x.fillPct);
      rendered.push({
        part,
        pages: r.slides,
        fill: Math.round(fills.reduce((a, b) => a + b, 0) / Math.max(fills.length, 1)),
        overflow: Math.max(0, ...r.results.map((x) => x.overflowPx)),
      });
    }

    const row = { tag, points, authored: plan.slides.length, parts: rendered };
    results.push(row);
    console.log(`✓ ${tag}: ${points} pts, ${rendered.length} part(s) — ` +
      rendered.map((p) => `p${p.part}:${p.pages}pg@${p.fill}%`).join(' '));
  } catch (err) {
    failures.push({ tag, error: String(err).slice(0, 160) });
    console.log(`✗ ${tag}: ${String(err).slice(0, 160)}`);
  }
}

const queue = [];
for (const s of SUBJECTS) {
  await post(BASE, { slug: s.slug, name: s.name, emoji: s.emoji }).catch(() => {});
  for (const ch of s.chapters) queue.push([s, ch]);
}
console.log(`queued ${queue.length} chapters across ${SUBJECTS.length} subjects, concurrency ${CONCURRENCY}\n`);

let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < queue.length) {
      const [s, ch] = queue[cursor++];
      await buildChapter(s, ch);
    }
  })
);

const allParts = results.flatMap((r) => r.parts);
const fills = allParts.map((p) => p.fill);
console.log(`\n=== ${results.length}/${queue.length} chapters built, ${failures.length} failed ===`);
console.log(`parts rendered: ${allParts.length}, pages: ${allParts.reduce((n, p) => n + p.pages, 0)}`);
if (fills.length) {
  console.log(`fill: mean ${Math.round(fills.reduce((a, b) => a + b, 0) / fills.length)}%, min ${Math.min(...fills)}, max ${Math.max(...fills)}`);
}
console.log(`overflowing parts: ${allParts.filter((p) => p.overflow > 0).length}`);
for (const f of failures) console.log(`  FAILED ${f.tag}: ${f.error}`);
