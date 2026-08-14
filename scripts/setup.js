/**
 * First-time setup for new team members.
 *
 * Run from the project root:  npm run setup
 *
 * What it does:
 *   1. Copies .env.example → backend/.env  (skips if backend/.env already exists)
 *   2. Copies .env.example → frontend/.env.local  (skips if already exists)
 *   3. Generates the Prisma client
 *   4. Verifies the database connection
 *
 * No MongoDB installation needed — we use a shared Atlas cluster.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function log(msg) {
  console.log('\x1b[36m' + msg + '\x1b[0m');
}
function ok(msg) {
  console.log('\x1b[32m✔ ' + msg + '\x1b[0m');
}
function warn(msg) {
  console.log('\x1b[33m⚠ ' + msg + '\x1b[0m');
}
function fail(msg) {
  console.error('\x1b[31m✖ ' + msg + '\x1b[0m');
}

// ── 1. Copy .env files ──────────────────────────────────────────

const exampleEnv = path.join(root, '.env.example');
const backendEnv = path.join(root, 'backend', '.env');
const frontendEnv = path.join(root, 'frontend', '.env.local');

log('\n[1/3] Setting up environment files…');

if (!fs.existsSync(backendEnv)) {
  fs.copyFileSync(exampleEnv, backendEnv);
  ok('Created backend/.env from .env.example');
  warn(
    'ACTION REQUIRED: Open backend/.env and set DATABASE_URL to the shared Atlas connection string.',
  );
  warn('Ask a teammate for the URL, or see README.md for local MongoDB setup.');
} else {
  ok('backend/.env already exists — keeping it');
}

// For the frontend we only need the API URL.
if (!fs.existsSync(frontendEnv)) {
  fs.writeFileSync(frontendEnv, 'NEXT_PUBLIC_API_URL=http://localhost:3001/api\n');
  ok('Created frontend/.env.local');
} else {
  ok('frontend/.env.local already exists — keeping it');
}

// ── 2. Generate Prisma client ───────────────────────────────────

log('\n[2/3] Generating Prisma client…');
try {
  execSync('npx prisma generate --schema=backend/src/prisma/schema.prisma', {
    cwd: root,
    stdio: 'inherit',
  });
  ok('Prisma client generated');
} catch {
  fail('Prisma generate failed. Make sure you ran `npm install` first.');
  process.exit(1);
}

// ── 3. Verify database connection ──────────────────────────────

log('\n[3/3] Verifying database connection…');

// Read DATABASE_URL from the freshly-created backend/.env
let dbUrl = '';
try {
  const envContent = fs.readFileSync(backendEnv, 'utf8');
  const match = envContent.match(/^DATABASE_URL=(.+)$/m);
  if (match) dbUrl = match[1].trim();
} catch {
  warn('Could not read backend/.env to verify connection.');
}

if (!dbUrl) {
  warn('DATABASE_URL not found in backend/.env — skipping connection check.');
} else {
  const checkScript = `
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.argv[1], { serverSelectionTimeoutMS: 8000 });
    client.connect()
      .then(() => client.db().command({ ping: 1 }))
      .then(() => { console.log('OK'); process.exit(0); })
      .catch(e => { console.error(e.message); process.exit(1); });
  `;
  const tmpFile = path.join(root, '_db_check_tmp.js');
  fs.writeFileSync(tmpFile, checkScript);

  try {
    execSync(`node "${tmpFile}" "${dbUrl}"`, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    ok('Database connection verified');
  } catch (e) {
    warn('Could not connect to the database.');
    warn('Make sure you have network access (MongoDB Atlas requires internet).');
    warn('If you need a local DB instead, see the LOCAL MONGODB section in README.md');
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// ── Done ────────────────────────────────────────────────────────

console.log(`
\x1b[32m
✔ Setup complete! Start the app with:

    npm run dev:backend    (in one terminal)
    npm run dev:frontend   (in another terminal)

Or both at once:

    npm run dev
\x1b[0m`);
