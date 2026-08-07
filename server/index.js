import http from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';

/* ================= config ================= */
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// Comma-separated list of sites allowed to call this API, e.g.
// "https://hughmackey-lsl.github.io". Use "*" only for local testing.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Google sign-in. Students authenticate in the browser; the ID token they send
// is verified here against Google's public keys — a browser claim of identity
// is never trusted on its own.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'nyu.edu')
  .split(',').map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
// Instructors who may reset a board by signing in, as an alternative to sharing
// ADMIN_TOKEN around.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const MAX_BODY = 8 * 1024;       // ID tokens are ~1KB, so this is roomier than before
const MAX_LIMIT = 200;
const QUARTERS = 4;              // upper bound on CFO stars, mirrors the game
const MONEY_CAP = 1_000_000;     // sanity bound, not a game rule

const oauth = new OAuth2Client(GOOGLE_CLIENT_ID);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's internal hostname (*.railway.internal) speaks plaintext on a
  // private network. Set DATABASE_SSL=true if you point this at a public URL.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5
});

/* ================= schema ================= */
async function migrate(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id         bigserial PRIMARY KEY,
      board      text        NOT NULL,
      google_sub text        NOT NULL,
      email      text        NOT NULL,
      name       text        NOT NULL,
      ni         integer     NOT NULL,
      cash       integer     NOT NULL,
      stars      smallint    NOT NULL DEFAULT 0,
      bust       boolean     NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  // Identity is the Google account, not the typed name: one row per student per
  // board, no matter what display name they enter.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS scores_board_sub ON scores (board, google_sub)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS scores_board_rank ON scores (board, bust, ni DESC)`);
  // The pre-auth schema keyed on the typed name. Harmless if it was never
  // deployed; dropped here so an early test database upgrades cleanly.
  await pool.query(`DROP INDEX IF EXISTS scores_board_name_key`);
}

/* ================= helpers ================= */
function cors(req, res){
  const origin = req.headers.origin;
  if(!origin) return;
  if(ALLOWED_ORIGINS.includes('*')){
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if(ALLOWED_ORIGINS.includes(origin)){
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function send(res, status, body){
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if(size > MAX_BODY){ reject(new HttpError(413, 'Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if(!chunks.length) return resolve({});
      try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch{ reject(new HttpError(400, 'Body is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

class HttpError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}

// Very small in-memory limiter. One Railway instance, one classroom — this is
// enough to stop an accidental loop, not a determined attacker.
//
// Buckets are keyed per route as well as per IP: a whole class usually shares
// one campus NAT address, so a single combined counter would let students rate
// limit each other (and would apply the strictest route's ceiling to all
// traffic). Limits are deliberately loose for the same reason.
const hits = new Map();
function rateLimit(ip, bucket, max, windowMs){
  const key = ip + '|' + bucket;
  const now = Date.now();
  const rec = hits.get(key);
  if(!rec || now > rec.reset){ hits.set(key, { n: 1, reset: now + windowMs }); return; }
  if(++rec.n > max) throw new HttpError(429, 'Too many requests — slow down and try again shortly.');
}
setInterval(() => {
  const now = Date.now();
  for(const [ip, rec] of hits) if(now > rec.reset) hits.delete(ip);
}, 60_000).unref();

function clientIp(req){
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}

/* ================= auth ================= */
/* Turns a verified Google token payload into a student, or throws.
   Exported so the domain rules can be tested directly with synthetic payloads —
   signature checking is google-auth-library's job and is tested there. */
export function accountFromPayload(payload, allowedDomains){
  if(!payload || !payload.email) throw new HttpError(403, 'That Google account has no email address.');
  if(payload.email_verified === false) throw new HttpError(403, 'That Google account has an unverified email address.');

  const email = String(payload.email).toLowerCase();

  // `hd` is the Google Workspace hosted domain, set by Google itself and not by
  // the account holder. Requiring it is what makes this a school-account check
  // rather than an address-suffix check: a personal account has no `hd` at all,
  // so it cannot slip through by presenting an address that merely ends in the
  // right domain.
  const hd = String(payload.hd || '').toLowerCase();
  if(!hd){
    throw new HttpError(403,
      `That looks like a personal Google account. Sign in with your school account (${allowedDomains.map(d => '@' + d).join(' or ')}).`);
  }
  if(!allowedDomains.includes(hd)){
    throw new HttpError(403,
      `Accounts on @${hd} are not in this class. Sign in with your school account (${allowedDomains.map(d => '@' + d).join(' or ')}).`);
  }

  return {
    sub: String(payload.sub),
    email,
    googleName: String(payload.name || payload.given_name || '').trim()
  };
}

/* Verifies the Google ID token and confirms the account belongs to an allowed
   school domain. Returns the caller's stable Google id, email and display name.
   The token is signed by Google, so a student cannot forge a classmate's
   identity by editing the request. */
async function requireStudent(req){
  if(!GOOGLE_CLIENT_ID){
    throw new HttpError(503, 'Sign-in is not configured on the server (GOOGLE_CLIENT_ID is missing).');
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if(!token) throw new HttpError(401, 'Sign in with your school Google account.');

  let payload;
  try{
    // Verifies signature against Google's published keys, plus issuer,
    // audience and expiry. Throws on anything it does not like.
    const ticket = await oauth.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  }catch{
    throw new HttpError(401, 'Your sign-in has expired or is not valid. Sign in again.');
  }

  return accountFromPayload(payload, ALLOWED_EMAIL_DOMAINS);
}

/* ================= validation ================= */
function parseBoard(raw){
  const board = String(raw ?? 'default').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(board)){
    throw new HttpError(400, 'board must be 1-32 characters: letters, numbers, dot, dash, underscore.');
  }
  return board;
}

function parseInt_(raw, field, { min, max }){
  const n = typeof raw === 'number' ? raw : Number(raw);
  if(!Number.isFinite(n) || !Number.isInteger(n)){
    throw new HttpError(400, `${field} must be a whole number.`);
  }
  if(n < min || n > max) throw new HttpError(400, `${field} is out of range.`);
  return n;
}

function parseName(raw, fallback){
  // Strip control characters, collapse whitespace. The page HTML-escapes on
  // render; this is about keeping the stored value sane, not about output.
  let name = String(raw ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if(!name) name = String(fallback || '').replace(/\s+/g, ' ').trim();
  if(name.length < 1) throw new HttpError(400, 'name is required.');
  return name.slice(0, 24);
}

/* ================= routes ================= */
async function getScores(url, student){
  const board = parseBoard(url.searchParams.get('board'));
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 100
    : Math.min(MAX_LIMIT, Math.max(1, parseInt_(limitRaw, 'limit', { min: 1, max: MAX_LIMIT })));
  const { rows } = await pool.query(
    `SELECT name, ni, cash, stars, bust, (google_sub = $2) AS you
       FROM scores
      WHERE board = $1
      ORDER BY bust ASC, ni DESC, cash DESC, updated_at ASC
      LIMIT $3`,
    [board, student.sub, limit]
  );
  // Deliberately no email or google_sub in the response: students should not be
  // able to harvest their classmates' addresses from the leaderboard.
  return { board, scores: rows };
}

async function postScore(body, student){
  const board = parseBoard(body.board);
  const name  = parseName(body.name, student.googleName);
  const ni    = parseInt_(body.ni,    'ni',    { min: -MONEY_CAP, max: MONEY_CAP });
  const cash  = parseInt_(body.cash,  'cash',  { min: -MONEY_CAP, max: MONEY_CAP });
  const stars = parseInt_(body.stars ?? 0, 'stars', { min: 0, max: QUARTERS });
  const bust  = Boolean(body.bust);

  // Upsert on the Google account, but only overwrite when the new run is
  // genuinely better: solvent beats bust, then higher net income. A student who
  // replays and does worse keeps their best result on the board.
  const { rows } = await pool.query(
    `INSERT INTO scores (board, google_sub, email, name, ni, cash, stars, bust)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (board, google_sub) DO UPDATE
       SET name  = EXCLUDED.name,
           email = EXCLUDED.email,
           ni    = EXCLUDED.ni,
           cash  = EXCLUDED.cash,
           stars = EXCLUDED.stars,
           bust  = EXCLUDED.bust,
           updated_at = now()
     WHERE (EXCLUDED.bust::int, -EXCLUDED.ni) < (scores.bust::int, -scores.ni)
     RETURNING name, ni, cash, stars, bust`,
    [board, student.sub, student.email, name, ni, cash, stars, bust]
  );
  // Empty rows means the WHERE clause rejected the update: an existing, better
  // score stands. That is a success from the caller's point of view.
  return { board, saved: rows[0] ?? null, kept_existing: rows.length === 0 };
}

async function deleteBoard(req, url){
  const board = parseBoard(url.searchParams.get('board'));

  // Either a signed-in instructor on the ADMIN_EMAILS list, or the shared
  // ADMIN_TOKEN. The email route avoids passing a secret around a classroom.
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  let allowed = false;
  if(ADMIN_TOKEN && presented && safeEqual(presented, ADMIN_TOKEN)) allowed = true;
  if(!allowed && ADMIN_EMAILS.length){
    try{
      const student = await requireStudent(req);
      if(ADMIN_EMAILS.includes(student.email)) allowed = true;
    }catch{ /* fall through to the generic refusal below */ }
  }
  if(!allowed){
    if(!ADMIN_TOKEN && !ADMIN_EMAILS.length){
      throw new HttpError(503, 'Reset is disabled: set ADMIN_TOKEN or ADMIN_EMAILS on the server.');
    }
    throw new HttpError(403, 'Only an instructor can reset the class board.');
  }

  const { rowCount } = await pool.query('DELETE FROM scores WHERE board = $1', [board]);
  return { board, deleted: rowCount };
}

function safeEqual(a, b){
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ================= server ================= */
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if(req.method === 'OPTIONS'){ res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = clientIp(req);

  try{
    if(url.pathname === '/api/health' && req.method === 'GET'){
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true, auth: Boolean(GOOGLE_CLIENT_ID), domains: ALLOWED_EMAIL_DOMAINS });
    }
    if(url.pathname === '/api/scores'){
      if(req.method === 'GET'){
        rateLimit(ip, 'get', 600, 60_000);
        return send(res, 200, await getScores(url, await requireStudent(req)));
      }
      if(req.method === 'POST'){
        rateLimit(ip, 'post', 240, 60_000);
        const student = await requireStudent(req);
        return send(res, 200, await postScore(await readBody(req), student));
      }
      if(req.method === 'DELETE'){
        rateLimit(ip, 'delete', 20, 60_000);
        return send(res, 200, await deleteBoard(req, url));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    return send(res, 404, { error: 'Not found' });
  }catch(err){
    if(err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error('[error]', err);
    return send(res, 500, { error: 'Internal server error' });
  }
});

// Only boot when run directly, so tests can import accountFromPayload without
// starting a listener or touching the database.
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  migrate()
    .then(() => server.listen(PORT, () => {
      console.log(`leaderboard api listening on :${PORT}`);
      if(!GOOGLE_CLIENT_ID) console.warn('[warn] GOOGLE_CLIENT_ID is not set — every score request will be refused.');
      else console.log(`[auth] google sign-in enabled for: ${ALLOWED_EMAIL_DOMAINS.join(', ')}`);
    }))
    .catch(err => { console.error('[fatal] migration failed', err); process.exit(1); });

  for(const sig of ['SIGTERM', 'SIGINT']){
    process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
  }
}
