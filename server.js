const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PORT     = process.env.PORT     || 3000;
const SECRET   = process.env.SESSION_SECRET || 'cmdb-change-me-in-production';

// ════ Helpers ══════════════════════════════════════════════════════════════
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(DATA_DIR);
ensureDir(path.join(DATA_DIR, 'users'));
ensureDir(path.join(DATA_DIR, 'sessions'));

function readJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch {}
  return fallback;
}
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ════ Crypto ══════════════════════════════════════════════════════════════
function hashPassword(pw, salt) {
  return crypto.pbkdf2Sync(pw, salt, 120000, 64, 'sha512').toString('hex');
}
function verifyPassword(pw, hash, salt) { return hashPassword(pw, salt) === hash; }

// ════ File paths ══════════════════════════════════════════════════════════
const USERS_FILE  = path.join(DATA_DIR, 'cmdb_users.json');
const PUBLIC_FILE = path.join(DATA_DIR, 'public.json');
const userFile    = u => path.join(DATA_DIR, 'users', `${u}.json`);

const EMPTY_NOTES = () => ({ folders:[], notes:[] });
const EMPTY_DB    = () => ({ data:[], tags:[], snippets:[], snipPkgs:[], notes:EMPTY_NOTES(), privateOverlays:{} });

const readUsers     = ()    => readJSON(USERS_FILE,  []);
const writeUsers    = u     => writeJSON(USERS_FILE, u);
const readPublic    = ()    => readJSON(PUBLIC_FILE, { data:[], tags:[], snippets:[], snipPkgs:[], notes:EMPTY_NOTES() });
const writePublic   = d     => writeJSON(PUBLIC_FILE, d);
const readUserData  = u     => readJSON(userFile(u), EMPTY_DB());
const writeUserData = (u,d) => writeJSON(userFile(u), d);

const SENSITIVE = ['gwuser','gwpass','sshJumpUser','sshJumpPass'];

// ════ Middleware ═══════════════════════════════════════════════════════════
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new FileStore({
    path: path.join(DATA_DIR, 'sessions'),
    ttl:  8 * 60 * 60,
    retries: 0,
  }),
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
}));

const auth = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ ok:false, error:'Não autenticado' });
  next();
};

// ════ Auth ═════════════════════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = readUsers();
  if (users.length === 0) return res.json({ ok:false, error:'Nenhum usuário', needsRegister:true });

  const user = users.find(u => u.username.toLowerCase() === (username||'').toLowerCase());
  if (!user)                                  return res.json({ ok:false, error:'Usuário não encontrado' });
  if (!verifyPassword(password, user.passwordHash, user.salt))
                                              return res.json({ ok:false, error:'Senha incorreta' });

  req.session.user     = { username: user.username, role: user.role };
  user.lastLogin       = new Date().toISOString();
  writeUsers(users);
  res.json({ ok:true, username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok:true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) return res.json({ ok:false });
  res.json({ ok:true, ...req.session.user });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body || {};
  const users = readUsers();
  if (users.length > 0 && req.session?.user?.role !== 'admin')
    return res.json({ ok:false, error:'Apenas admins podem criar usuários' });
  if (users.find(u => u.username.toLowerCase() === (username||'').toLowerCase()))
    return res.json({ ok:false, error:'Usuário já existe' });
  if (!username || username.length < 2) return res.json({ ok:false, error:'Nome inválido' });
  if (!password || password.length < 4)  return res.json({ ok:false, error:'Senha muito curta (mín. 4 caracteres)' });

  const salt = crypto.randomBytes(32).toString('hex');
  users.push({
    username, salt,
    passwordHash: hashPassword(password, salt),
    role: users.length === 0 ? 'admin' : (role || 'user'),
    created: new Date().toISOString(),
    lastLogin: null,
  });
  writeUsers(users);
  res.json({ ok:true });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const users = readUsers();
  const user  = users.find(u => u.username === req.session.user.username);
  if (!user)                                            return res.json({ ok:false, error:'Usuário não encontrado' });
  if (!verifyPassword(oldPassword, user.passwordHash, user.salt))
                                                        return res.json({ ok:false, error:'Senha atual incorreta' });
  if (!newPassword || newPassword.length < 4)          return res.json({ ok:false, error:'Nova senha muito curta' });
  user.salt         = crypto.randomBytes(32).toString('hex');
  user.passwordHash = hashPassword(newPassword, user.salt);
  writeUsers(users);
  res.json({ ok:true });
});

// ════ Users (admin) ════════════════════════════════════════════════════════
app.get('/api/users', auth, (req, res) => {
  const users = readUsers().map(u => ({
    username: u.username, role: u.role,
    created: u.created, lastLogin: u.lastLogin,
  }));
  res.json(users);
});

app.delete('/api/users/:username', auth, (req, res) => {
  if (req.session.user.role !== 'admin')             return res.json({ ok:false, error:'Sem permissão' });
  if (req.params.username === req.session.user.username)
                                                      return res.json({ ok:false, error:'Não pode excluir a si mesmo' });
  writeUsers(readUsers().filter(u => u.username !== req.params.username));
  res.json({ ok:true });
});

app.post('/api/users/:username/reset-password', auth, (req, res) => {
  if (req.session.user.role !== 'admin')             return res.json({ ok:false, error:'Sem permissão' });
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4)        return res.json({ ok:false, error:'Senha muito curta' });
  const users = readUsers();
  const user  = users.find(u => u.username === req.params.username);
  if (!user)                                          return res.json({ ok:false, error:'Usuário não encontrado' });
  user.salt         = crypto.randomBytes(32).toString('hex');
  user.passwordHash = hashPassword(newPassword, user.salt);
  writeUsers(users);
  res.json({ ok:true });
});

// ════ Config ══════════════════════════════════════════════════════════════
app.get('/api/config',     auth, (_req, res) => res.json({ ok:true, dataDir: DATA_DIR }));
app.post('/api/config',    auth, (_req, res) => res.json({ ok:true })); // no-op in Docker
app.get('/api/db/path',    auth, (req, res) => res.json({ path: path.join(DATA_DIR, 'users', req.session.user.username + '.json') }));

// ════ Data ════════════════════════════════════════════════════════════════
app.get('/api/db/load', auth, (req, res) => {
  const me   = req.session.user.username;
  const priv = readUserData(me);
  const pub  = readPublic();
  const ov   = priv.privateOverlays || {};

  const pubData  = (pub.data     ||[]).map(it => ({ ...it, _public:true, ...(ov[it._id]||{}) }));
  const pubSnips = (pub.snippets ||[]).map(s  => ({ ...s,  _public:true }));
  const pubFolders   = (pub.notes?.folders||[]).map(f => ({ ...f, _public:true,
    notes: (f.notes||[]).map(n => ({ ...n, _public:true, _owner:f._owner })) }));
  const pubRootNotes = (pub.notes?.notes  ||[]).map(n => ({ ...n, _public:true }));

  res.json({
    data:     [...(priv.data    ||[]), ...pubData  ],
    tags:     [...new Set([...(priv.tags    ||[]), ...(pub.tags    ||[])])],
    snippets: [...(priv.snippets||[]), ...pubSnips ],
    snipPkgs: [...new Set([...(priv.snipPkgs||[]), ...(pub.snipPkgs||[])])],
    notes: {
      folders: [...(priv.notes?.folders||[]), ...pubFolders   ],
      notes:   [...(priv.notes?.notes  ||[]), ...pubRootNotes ],
    },
  });
});

app.post('/api/db/save', auth, (req, res) => {
  const me = req.session.user.username;
  const db = req.body;

  const privateItems    = (db.data    ||[]).filter(it => !it._public);
  const publicItems     = (db.data    ||[]).filter(it =>  it._public && it._owner === me);
  const privateSnippets = (db.snippets||[]).filter(s  => !s._public);
  const publicSnippets  = (db.snippets||[]).filter(s  =>  s._public && s._owner === me);

  const privateOverlays = {};
  (db.data||[]).filter(it => it._public).forEach(it => {
    if (!it._id) return;
    const ov = {};
    SENSITIVE.forEach(f => { if (it[f]) ov[f] = it[f]; });
    if (Object.keys(ov).length) privateOverlays[it._id] = ov;
  });

  const sanitize = it => {
    const c = { ...it, _owner: me };
    SENSITIVE.forEach(f => delete c[f]);
    return c;
  };

  const allFolders   = db.notes?.folders || [];
  const allRootNotes = db.notes?.notes   || [];

  writeUserData(me, {
    data:     privateItems,
    tags:     db.tags     || [],
    snippets: privateSnippets,
    snipPkgs: db.snipPkgs || [],
    notes: {
      folders: allFolders.filter(f   => !f._public || (f._owner && f._owner !== me)),
      notes:   allRootNotes.filter(n => !n._public || (n._owner && n._owner !== me)),
    },
    privateOverlays,
  });

  const ep = readPublic();
  writePublic({
    data:     [...(ep.data    ||[]).filter(it => it._owner !== me), ...publicItems.map(sanitize)],
    tags:     [...new Set([...(ep.tags    ||[]), ...(db.tags    ||[])])],
    snippets: [...(ep.snippets||[]).filter(s  => s._owner  !== me), ...publicSnippets.map(sanitize)],
    snipPkgs: [...new Set([...(ep.snipPkgs||[]), ...(db.snipPkgs||[])])],
    notes: {
      folders: [
        ...(ep.notes?.folders||[]).filter(f => f._owner !== me),
        ...allFolders.filter(f => f._public && (!f._owner || f._owner === me)).map(f => ({...f, _owner:me})),
      ],
      notes: [
        ...(ep.notes?.notes||[]).filter(n => n._owner !== me),
        ...allRootNotes.filter(n => n._public && (!n._owner || n._owner === me)).map(n => ({...n, _owner:me})),
      ],
    },
  });

  res.json({ ok:true });
});

// ════ Agent download — serve arquivos embarcados ══════════════════════════
const AGENT_JS = fs.readFileSync(path.join(__dirname, 'public', 'agent.js'), 'utf-8');
const INSTALL_BAT = fs.readFileSync(path.join(__dirname, 'public', 'install.bat'), 'utf-8');

app.get('/agent/agent.js',     (_req, res) => { res.setHeader('Content-Type','application/javascript'); res.send(AGENT_JS); });
app.get('/agent/install.bat',  (_req, res) => { res.setHeader('Content-Type','application/octet-stream'); res.setHeader('Content-Disposition','attachment; filename="install.bat"'); res.send(INSTALL_BAT); });
app.get('/agent/package.json', (_req, res) => { res.json({ name:'cmdb-local-agent', version:'2.0.0', main:'agent.js', dependencies:{} }); });

// ════ Redirect root to app ════════════════════════════════════════════════
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'cmdb.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CMDB Web listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
