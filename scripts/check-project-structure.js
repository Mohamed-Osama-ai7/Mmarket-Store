const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'Frontend');
const backend = path.join(root, 'Backend');
const errors = [];
const warnings = [];
const passed = [];

const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const walk = (directory) => {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(fullPath));
    else results.push(fullPath);
  }
  return results;
};
const readJson = (filePath) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) {
    errors.push(`Invalid JSON: ${path.relative(root, filePath)} (${error.message})`);
    return null;
  }
};
const resolveLocalImport = (sourceFile, importPath) => {
  if (!importPath.startsWith('.')) return true;
  const resolved = path.resolve(path.dirname(sourceFile), importPath);
  return ['.ts', '.tsx', '.js', '.mjs', '.json', ''].some((extension) => {
    const candidate = resolved + extension;
    return fs.existsSync(candidate) || (extension === '' && fs.existsSync(path.join(candidate, 'index.ts')));
  });
};

const requiredFiles = [
  'Frontend/package.json', 'Frontend/package-lock.json', 'Frontend/angular.json',
  'Frontend/proxy.conf.json', 'Frontend/src/app/app.routes.ts',
  'Frontend/src/app/core/services/auth.service.ts',
  'Frontend/src/app/core/services/product.service.ts',
  'Backend/package.json', 'Backend/package-lock.json', 'Backend/index.js', 'Backend/app.js',
  'Backend/.env.example', 'Backend/scripts/check-syntax.js', 'Backend/scripts/check-imports.js',
  'Backend/controller/product.controller.js',
  'Backend/service/order.service.js',
  'Backend/tests/guest-checkout-policy.test.js', 'Backend/tests/user-registration.test.js',
  'Backend/model/siteContent.model.js', 'Backend/controller/siteContent.controller.js',
  'Backend/route/siteContent.route.js', 'Backend/tests/site-content-structure.test.js',
  'Frontend/src/app/core/models/site-content.model.ts', 'Frontend/src/app/core/services/site-content.service.ts',
  'Frontend/src/app/layout/refunds/refunds.spec.ts',
  'Frontend/src/app/dashboard/content/content.ts', 'Frontend/src/app/layout/information/content-page/content-page.ts',
  'Frontend/src/app/layout/information/policy/policy.html', 'ARCHITECTURE.md',
  'README.md', 'DEPLOYMENT-GUIDE.md', 'SECURITY-AND-RUNBOOK.md', 'RELEASE-READINESS.md'
];
for (const file of requiredFiles) {
  if (!exists(file)) errors.push(`Missing required project file: ${file}`);
}
if (!errors.length) passed.push(`${requiredFiles.length} required project files are present`);

const frontendPackage = readJson(path.join(frontend, 'package.json'));
const frontendLock = readJson(path.join(frontend, 'package-lock.json'));
const backendPackage = readJson(path.join(backend, 'package.json'));
const backendLock = readJson(path.join(backend, 'package-lock.json'));
const angularConfig = readJson(path.join(frontend, 'angular.json'));
const proxyConfig = readJson(path.join(frontend, 'proxy.conf.json'));

const compareDependencyMaps = (name, manifest, lock) => {
  if (!manifest || !lock || !lock.packages || !lock.packages['']) return;
  const locked = lock.packages[''];
  for (const dependencyType of ['dependencies', 'devDependencies']) {
    const requested = manifest[dependencyType] || {};
    const recorded = locked[dependencyType] || {};
    for (const [dependency, version] of Object.entries(requested)) {
      if (recorded[dependency] !== version) {
        errors.push(`${name} lockfile mismatch: ${dependencyType}.${dependency} is ${version} in package.json and ${recorded[dependency] || 'missing'} in package-lock.json`);
      }
    }
    for (const dependency of Object.keys(recorded)) {
      if (!(dependency in requested)) errors.push(`${name} package-lock lists unrequested ${dependencyType} dependency: ${dependency}`);
    }
  }
};
compareDependencyMaps('Frontend', frontendPackage, frontendLock);
compareDependencyMaps('Backend', backendPackage, backendLock);
if (frontendPackage && angularConfig) {
  const project = angularConfig.projects?.mmarketStore;
  const styles = project?.architect?.build?.options?.styles || [];
  if (!styles.some((style) => /bootstrap\/dist\/css\/bootstrap\.min\.css|bootstrap-custom\.scss/.test(String(style)))) errors.push('Bootstrap CSS is not configured in Angular build options');
  if (!project?.architect?.serve?.options?.proxyConfig) errors.push('Angular dev-server proxy is not configured');
}
if (proxyConfig && (!proxyConfig['/api'] || !proxyConfig['/socket.io']?.ws)) errors.push('Proxy configuration must forward /api and WebSocket traffic at /socket.io');
if (!errors.some((error) => error.includes('Bootstrap CSS')) && angularConfig) passed.push('Angular build configuration includes Bootstrap and a dev proxy');

for (const environmentFile of ['Frontend/src/environments/env.ts', 'Frontend/src/environments/env.prod.ts']) {
  const fullPath = path.join(root, environmentFile);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    // Production configuration is intentionally runtime-configurable for Vercel + Railway,
    // while its safe local fallback must remain same-origin for Docker/Nginx and ng serve.
    const sameOriginApiFallback = /apiURL:\s*\(runtimeConfig\?\.apiURL\s*\|\|\s*['"]\/api\/v1\/['"]\)/.test(content);
    const sameOriginSocketFallback = /socketPath:\s*runtimeConfig\?\.socketPath\s*\|\|\s*['"]\/socket\.io['"]/.test(content)
      && /socketURL:\s*runtimeConfig\?\.socketURL\s*\|\|\s*['"]['"]/.test(content);
    if (!sameOriginApiFallback || !sameOriginSocketFallback) {
      errors.push(`${environmentFile} must provide safe same-origin API/Socket.IO defaults and allow public runtime overrides`);
    }
  }
}

// Guard critical storefront invariants against accidental regression. These are structural
// checks; runtime/unit/E2E tests are still required to prove the full workflows work.
const criticalSources = {
  orderRoutes: 'Backend/route/order.route.js',
  orderController: 'Backend/controller/order.controller.js',
  userController: 'Backend/controller/user.controller.js',
  userModel: 'Backend/model/user.model.js',
  checkoutTemplate: 'Frontend/src/app/layout/checkout/checkout.html',
  profileComponent: 'Frontend/src/app/layout/profile/profile.ts',
  socketServer: 'Backend/index.js',
  notificationPublisher: 'Backend/utilities/notificationPublisher.js',
  compose: 'docker-compose.yml',
  appConfig: 'Frontend/src/app/app.config.ts',
  siteContentRoutes: 'Backend/route/siteContent.route.js',
  siteContentController: 'Backend/controller/siteContent.controller.js',
  siteContentModel: 'Backend/model/siteContent.model.js',
  cmsDashboard: 'Frontend/src/app/dashboard/content/content.html',
  siteContentHome: 'Frontend/src/app/layout/home/home.ts',
  checkoutComponent: 'Frontend/src/app/layout/checkout/checkout.ts',
  refundComponent: 'Frontend/src/app/layout/refunds/refunds.ts',
  orderService: 'Frontend/src/app/core/services/order.service.ts',
  paymentService: 'Frontend/src/app/core/services/payment.service.ts',
  refundService: 'Frontend/src/app/core/services/refund.service.ts',
  orderHistoryComponent: 'Frontend/src/app/layout/orders/orders.ts'
};
const critical = Object.fromEntries(Object.entries(criticalSources).map(([key, file]) => [key, exists(file) ? fs.readFileSync(path.join(root, file), 'utf8') : '']));
const invariantChecks = [
  ['authenticated checkout route', /router\.post\(\s*["']\/checkout["']\s*,\s*authenticate\s*,\s*checkout\s*\)/s.test(critical.orderRoutes)],
  ['server-side guest checkout denial', /exports\.guestCheckout\s*=\s*async\s*\(req,\s*res\)\s*=>\s*\{\s*return res\.status\(401\)/s.test(critical.orderController)],
  ['persistent account creation', /await User\.create\(/.test(critical.userController) && /userSchema\.pre\(["']save["']/.test(critical.userModel)],
  ['password removed from signup response', /delete userData\.password/.test(critical.userController)],
  ['guest checkout UI offers authentication while keeping cart', /Sign up to continue/.test(critical.checkoutTemplate) && /Log in/.test(critical.checkoutTemplate) && /guest cart will stay saved/i.test(critical.checkoutTemplate)],
  ['profile derives history from authenticated orders', /getMyOrders\(\)/.test(critical.profileComponent) && /get orderCount/.test(critical.profileComponent) && /get totalSpent/.test(critical.profileComponent)],
  ['Socket.IO authenticates connections and routes notifications', /io\.use\(async \(socket, next\)/.test(critical.socketServer) && /user:\$\{String\(recipient\)\}/.test(critical.notificationPublisher)],
  ['Docker defines persistent MongoDB and application services', /(^|\n)\s*mongo_data:\s*$/m.test(critical.compose) && /backend:/.test(critical.compose) && /frontend:/.test(critical.compose)],
  ['Angular async UI compatibility is configured', (angularConfig?.projects?.mmarketStore?.architect?.build?.options?.polyfills || []).includes('zone.js') && /provideZoneChangeDetection\(\{\s*eventCoalescing:\s*true\s*\}\)/.test(critical.appConfig)],
  ['CMS admin APIs are protected by server-side authorization', /const requireAdmin = \[authenticate, authorize\(\"admin\"\)\]/.test(critical.siteContentRoutes) && /router\.put\(\"\/admin\", \.\.\.requireAdmin/.test(critical.siteContentRoutes)],
  ['CMS limits public page visibility to published content and sanitizes plain text', /page\.status === \"published\"/.test(critical.siteContentController) && /sanitizeHtml\(value, \{ allowedTags: \[\], allowedAttributes: \{\} \}\)/.test(critical.siteContentController)],
  ['CMS schemas cover site settings, navigation, homepage sections, and content pages', /homepageSectionSchema/.test(critical.siteContentModel) && /pages: \{ type: \[pageSchema\]/.test(critical.siteContentModel)],
  ['Public home page consumes database-backed CMS copy', /getPublicContent\(\)/.test(critical.siteContentHome) && /siteContent\?\.homepage/.test(critical.siteContentHome)],
  ['Checkout keeps idempotency keys in memory when sessionStorage is unavailable', /transientKeys = new Map<string, string>\(\)/.test(critical.checkoutComponent) && /this\.transientKeys\.get\(key\)/.test(critical.checkoutComponent)],
  ['Retrying the same refund form reuses its idempotency key', /requestFingerprint/.test(critical.refundComponent) && /fingerprint !== this\.requestFingerprint \|\| !this\.requestKey/.test(critical.refundComponent)],
  ['Idempotent checkout, COD payment, and refund writes have finite client wait limits', /timeout\(\{ first: 20000 \}\)/.test(critical.orderService) && /timeout\(\{ first: 20000 \}\)/.test(critical.paymentService) && /timeout\(\{ first: 20000 \}\)/.test(critical.refundService)],
  ['Order-cancellation timeout leaves a recoverable user message', /timeout\(\{ first: 15000 \}\)/.test(critical.orderService) && /Reload your orders to confirm the current status/.test(critical.orderHistoryComponent)]
];
for (const [label, passedCheck] of invariantChecks) {
  if (passedCheck) passed.push(`Critical invariant present: ${label}`);
  else errors.push(`Critical invariant missing or changed: ${label}`);
}

const tsFiles = walk(path.join(frontend, 'src')).filter((file) => file.endsWith('.ts'));
let importCount = 0;
let componentCount = 0;
for (const file of tsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const staticImports = source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g);
  for (const match of staticImports) {
    importCount += 1;
    if (!resolveLocalImport(file, match[1])) errors.push(`Missing local import: ${path.relative(root, file)} -> ${match[1]}`);
  }
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    importCount += 1;
    if (!resolveLocalImport(file, match[1])) errors.push(`Missing dynamic import: ${path.relative(root, file)} -> ${match[1]}`);
  }
  const templateMatch = source.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
  const styleMatch = source.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/);
  if (templateMatch || styleMatch) {
    componentCount += 1;
    if (!templateMatch || !fs.existsSync(path.resolve(path.dirname(file), templateMatch[1]))) errors.push(`Component template is missing: ${path.relative(root, file)}`);
    if (!styleMatch || !fs.existsSync(path.resolve(path.dirname(file), styleMatch[1]))) errors.push(`Component stylesheet is missing: ${path.relative(root, file)}`);
  }
}
if (!errors.some((error) => error.includes('Missing local import') || error.includes('Missing dynamic import') || error.includes('Component template') || error.includes('Component stylesheet'))) {
  passed.push(`${tsFiles.length} TypeScript source files have valid local imports and ${componentCount} components have template/style files`);
}

const allFiles = walk(root);
const forbiddenGenerated = allFiles.filter((file) => {
  const relative = path.relative(root, file).split(path.sep);
  const base = path.basename(file);
  return relative.some((part) => ['node_modules', '.angular', 'dist', 'out-tsc'].includes(part))
    || base.endsWith('.log') || base === 'mongod.cfg.backup';
});
if (forbiddenGenerated.length) errors.push(`Generated/runtime files found in bundle: ${forbiddenGenerated.map((file) => path.relative(root, file)).slice(0, 10).join(', ')}`);
const envFiles = allFiles.filter((file) => path.basename(file) === '.env');
if (envFiles.length) errors.push(`Local .env must not be included: ${envFiles.map((file) => path.relative(root, file)).join(', ')}`);
const badRuntimeFiles = ['Backend/uploads', 'Backend/backups', 'Backend/logs'].flatMap((relativeDirectory) => {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return walk(directory).filter((file) => path.basename(file) !== '.gitkeep');
});
if (badRuntimeFiles.length) errors.push(`Runtime data should not be bundled: ${badRuntimeFiles.map((file) => path.relative(root, file)).join(', ')}`);
if (!forbiddenGenerated.length && !envFiles.length && !badRuntimeFiles.length) passed.push('No node_modules/build cache/local .env/log/backup/upload data is bundled');

try {
  execFileSync(process.execPath, [path.join(backend, 'scripts/check-syntax.js')], { stdio: 'pipe' });
  passed.push('Backend JavaScript syntax check passes');
} catch (error) {
  errors.push(`Backend syntax check failed: ${(error.stdout || error.stderr || error.message).toString().trim()}`);
}

try {
  execFileSync(process.execPath, [path.join(backend, 'scripts/check-imports.js')], { stdio: 'pipe' });
  passed.push('Backend local relative imports resolve within the layer-first MVC layout');
} catch (error) {
  errors.push(`Backend local import check failed: ${(error.stdout || error.stderr || error.message).toString().trim()}`);
}

let typescript;
try {
  typescript = require(path.join(frontend, 'node_modules', 'typescript'));
} catch {
  try { typescript = require(require.resolve('typescript', { paths: [frontend, root] })); }
  catch { warnings.push('TypeScript package is not installed here; Angular compiler diagnostics require npm ci in Frontend/.'); }
}
if (typescript) {
  const syntaxProblems = [];
  for (const file of tsFiles) {
    const result = typescript.transpileModule(fs.readFileSync(file, 'utf8'), {
      reportDiagnostics: true,
      fileName: file,
      compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ES2022, experimentalDecorators: true }
    });
    for (const diagnostic of result.diagnostics || []) {
      if (diagnostic.category === typescript.DiagnosticCategory.Error) {
        syntaxProblems.push(`${path.relative(root, file)}: ${typescript.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      }
    }
  }
  if (syntaxProblems.length) errors.push(...syntaxProblems.map((problem) => `TypeScript syntax: ${problem}`));
  else passed.push(`TypeScript syntax parsed for ${tsFiles.length} files`);
}

console.log('Mmarket Store structure validation');
for (const item of passed) console.log(`PASS  ${item}`);
for (const item of warnings) console.log(`WARN  ${item}`);
for (const item of errors) console.error(`FAIL  ${item}`);
console.log(`Summary: ${passed.length} passed, ${warnings.length} warning(s), ${errors.length} failure(s).`);
process.exitCode = errors.length ? 1 : 0;
