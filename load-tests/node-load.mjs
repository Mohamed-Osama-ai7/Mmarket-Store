// Dependency-free load test (Node >= 18). Run ONLY against local or staging, never the live shop.
//   node load-tests/node-load.js http://localhost:3000 /api/v1/product?page=1&pageSize=12 [concurrency=20] [seconds=15]
const [base, path = '/api/v1/health', c = '20', s = '15'] = process.argv.slice(2);
if (!base) { console.error('Usage: node node-load.js <baseUrl> <path> [concurrency] [seconds]'); process.exit(2); }
if (/vercel\.app|onrender\.com/i.test(base) && process.env.ALLOW_REMOTE_LOAD !== '1') {
  console.error('Refusing to load-test a hosted URL. Use a local/staging stack, or set ALLOW_REMOTE_LOAD=1 for staging.'); process.exit(2);
}
const concurrency = Number(c), deadline = Date.now() + Number(s) * 1000;
const latencies = []; const statuses = {}; let errors = 0;
const worker = async () => {
  while (Date.now() < deadline) {
    const t0 = performance.now();
    try { const r = await fetch(base.replace(/\/$/, '') + path); await r.arrayBuffer(); statuses[r.status] = (statuses[r.status] || 0) + 1; }
    catch { errors++; }
    latencies.push(performance.now() - t0);
  }
};
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const secs = (Date.now() - started) / 1000; latencies.sort((a, b) => a - b);
const q = p => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))].toFixed(1);
console.log(JSON.stringify({ path, concurrency, seconds: +secs.toFixed(1), requests: latencies.length, rps: +(latencies.length / secs).toFixed(1), statuses, networkErrors: errors, p50ms: +q(0.5), p95ms: +q(0.95), p99ms: +q(0.99) }, null, 2));
