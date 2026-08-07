import http from 'node:http';
import pg from 'pg';

/* ================= config ================= */
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// Comma-separated list of sites allowed to call this API, e.g.
// "https://hughmackey-lsl.github.io". Use "*" only for local testing.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MAX_BODY = 4 * 1024;       // a score payload is ~100 bytes; this is generous
const MAX_LIMIT = 200;
const QUARTERS = 4;              // upper bound on CFO stars, mirrors the game
const MONEY_CAP = 1_000_000;     // sanity bound, not a game rule

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
      name       text        NOT NULL,
      name_key   text        NOT NULL,
      ni         integer     NOT NULL,
      cash       integer     NOT NULL,
      stars      smallint    NOT NULL DEFAULT 0,
      bust       boolean     NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS scores_board_name_key ON scores (board, name_key)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS scores_board_rank ON scores (board, bust, ni DESC)`);
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

function parseName(raw){
  // Strip control characters, collapse whitespace. The page HTML-escapes on
  // render; this is about keeping the stored value sane, not about output.
  const name = String(raw ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if(name.length < 1) throw new HttpError(400, 'name is required.');
  if(name.length > 24) throw new HttpError(400, 'name must be 24 characters or fewer.');
  return name;
}

/* ================= routes ================= */
async function getScores(url){
  const board = parseBoard(url.searchParams.get('board'));
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 100
    : Math.min(MAX_LIMIT, Math.max(1, parseInt_(limitRaw, 'limit', { min: 1, max: MAX_LIMIT })));
  const { rows } = await pool.query(
    `SELECT name, ni, cash, stars, bust
       FROM scores
      WHERE board = $1
      ORDER BY bust ASC, ni DESC, cash DESC, updated_at ASC
      LIMIT $2`,
    [board, limit]
  );
  return { board, scores: rows };
}

async function postScore(body){
  const board = parseBoard(body.board);
  const name  = parseName(body.name);
  const ni    = parseInt_(body.ni,    'ni',    { min: -MONEY_CAP, max: MONEY_CAP });
  const cash  = parseInt_(body.cash,  'cash',  { min: -MONEY_CAP, max: MONEY_CAP });
  const stars = parseInt_(body.stars ?? 0, 'stars', { min: 0, max: QUARTERS });
  const bust  = Boolean(body.bust);

  // Upsert, but only overwrite when the new run is genuinely better: solvent
  // beats bust, then higher net income. A student who replays and does worse
  // keeps their best result on the board.
  const { rows } = await pool.query(
    `INSERT INTO scores (board, name, name_key, ni, cash, stars, bust)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (board, name_key) DO UPDATE
       SET name = EXCLUDED.name,
           ni    = EXCLUDED.ni,
           cash  = EXCLUDED.cash,
           stars = EXCLUDED.stars,
           bust  = EXCLUDED.bust,
           updated_at = now()
     WHERE (EXCLUDED.bust::int, -EXCLUDED.ni) < (scores.bust::int, -scores.ni)
     RETURNING name, ni, cash, stars, bust`,
    [board, name, name.toLowerCase(), ni, cash, stars, bust]
  );
  // Empty rows means the WHERE clause rejected the update: an existing, better
  // score stands. That is a success from the caller's point of view.
  return { board, saved: rows[0] ?? null, kept_existing: rows.length === 0 };
}

async function deleteBoard(req, url){
  if(!ADMIN_TOKEN) throw new HttpError(503, 'Reset is disabled: ADMIN_TOKEN is not configured on the server.');
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if(!safeEqual(token, ADMIN_TOKEN)) throw new HttpError(401, 'Invalid admin token.');
  const board = parseBoard(url.searchParams.get('board'));
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
      return send(res, 200, { ok: true });
    }
    if(url.pathname === '/api/scores'){
      if(req.method === 'GET'){
        rateLimit(ip, 'get', 600, 60_000);
        return send(res, 200, await getScores(url));
      }
      if(req.method === 'POST'){
        rateLimit(ip, 'post', 240, 60_000);
        return send(res, 200, await postScore(await readBody(req)));
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

migrate()
  .then(() => server.listen(PORT, () => console.log(`leaderboard api listening on :${PORT}`)))
  .catch(err => { console.error('[fatal] migration failed', err); process.exit(1); });

for(const sig of ['SIGTERM', 'SIGINT']){
  process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
}
