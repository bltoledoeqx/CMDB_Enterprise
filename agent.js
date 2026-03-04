/**
 * CMDB Local Agent
 * Roda em localhost:27420 na máquina Windows do usuário.
 * O browser chama este agente para abrir RDP e SSH localmente.
 *
 * Instalar como serviço: execute install.bat como Administrador
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { spawnSync, spawn, execFile } = require('child_process');

const PORT   = 27420;
const ORIGIN_PATTERN = /^https?:\/\/localhost(:\d+)?$|^https?:\/\/[\w.-]+(\:\d+)?$/;

// ════ RDP ════════════════════════════════════════════════════════════════
function openRDP({ host, port, user, domain, gateway, gatewayUser, gatewayPass, password }) {
  const rdpHost  = port && port !== '3389' ? `${host}:${port}` : host;
  const fullUser = domain ? `${domain}\\${user}` : user;
  const gwHost   = gateway     || null;
  const gwUser   = gatewayUser || user;
  const gwpass   = gatewayPass || password || '';

  try {
    if (gwHost && gwpass) {
      spawnSync('cmdkey.exe', [`/add:${gwHost}`,         `/user:${gwUser}`, `/pass:${gwpass}`], { windowsHide:true });
      spawnSync('cmdkey.exe', [`/add:TERMSRV/${gwHost}`, `/user:${gwUser}`, `/pass:${gwpass}`], { windowsHide:true });
    }
    if (password && user) {
      spawnSync('cmdkey.exe', [`/add:TERMSRV/${rdpHost}`, `/user:${fullUser}`, `/pass:${password}`], { windowsHide:true });
      if (port && port !== '3389')
        spawnSync('cmdkey.exe', [`/add:TERMSRV/${host}`,  `/user:${fullUser}`, `/pass:${password}`], { windowsHide:true });
    }
  } catch(e) { console.error('cmdkey error:', e.message); }

  const lines = [
    `full address:s:${rdpHost}`,
    `username:s:${fullUser}`,
    `prompt for credentials:i:${password ? '0' : '1'}`,
    'administrative session:i:0', 'authentication level:i:2',
    'enablecredsspsupport:i:1', 'negotiate security layer:i:1',
    'autoreconnection enabled:i:1', 'compression:i:1', 'bitmapcachepersistenable:i:1',
  ];
  if (gwHost) {
    lines.push(
      `gatewayhostname:s:${gwHost}`, 'gatewayusagemethod:i:1',
      'gatewayprofileusagemethod:i:1', 'gatewaycredentialssource:i:0',
      `gatewayusername:s:${gwUser}`, 'promptcredentialonce:i:1',
      'gatewaybrokeringtype:i:0', 'use redirection server name:i:0',
    );
  }

  const tmp = path.join(os.tmpdir(), `cmdb_${Date.now()}.rdp`);
  fs.writeFileSync(tmp, lines.join('\r\n') + '\r\n', 'utf-8');
  execFile('mstsc.exe', [tmp], { detached:true });
  setTimeout(() => { try { fs.unlinkSync(tmp); } catch {} }, 8000);
  return { ok:true };
}

// ════ SSH ═════════════════════════════════════════════════════════════════
function parseEndpoint(raw, fallbackPort) {
  const value = String(raw || '').trim();
  if (!value) return { host: '', port: fallbackPort };
  const m = value.match(/^\[?([^\]]+)\]?(?::(\d+))?$/);
  if (!m) return { host: value, port: fallbackPort };
  return { host: m[1], port: m[2] ? Number(m[2]) : fallbackPort };
}

function openSSH({ host, port, user, sshJump, sshJumpUser }) {
  const dest = parseEndpoint(host, Number(port) || 22);
  if (!dest.host) return { ok:false, error:'Host SSH não informado' };

  const destTarget = user ? `${user}@${dest.host}` : dest.host;
  let sshCmd = `ssh -tt -p ${dest.port} ${destTarget}`;

  if (sshJump) {
    const jump = parseEndpoint(sshJump, 22);
    if (!jump.host) return { ok:false, error:'Jump SSH inválido' };
    const jumpTarget = sshJumpUser ? `${sshJumpUser}@${jump.host}` : jump.host;
    sshCmd = `ssh -tt -J ${jumpTarget}:${jump.port} -p ${dest.port} ${destTarget}`;
  }

  const bat = [
    '@echo off',
    `set SSH_CMD=${sshCmd}`,
    'where wt.exe >nul 2>&1',
    'if %errorlevel%==0 (',
    '  start "" wt.exe new-tab -- %SSH_CMD%',
    ') else (',
    '  start "" cmd.exe /k %SSH_CMD%',
    ')',
    ''
  ].join('\r\n');

  const batFile = path.join(os.tmpdir(), `cmdb_ssh_${Date.now()}.bat`);
  fs.writeFileSync(batFile, bat, 'utf-8');
  spawn('cmd.exe', ['/c', batFile], { detached:true, windowsHide:true });
  setTimeout(() => { try { fs.unlinkSync(batFile); } catch {} }, 5000);
  return { ok:true, mode: sshJump ? 'jump' : 'direct' };
}

// ════ HTTP Server ══════════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  // CORS — permite chamadas de qualquer origem (o app fica num servidor interno)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok:true, version:'2.0' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok:false, error:'Method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:'Invalid JSON' }));
      return;
    }

    let result;
    try {
      if      (req.url === '/rdp') result = openRDP(data);
      else if (req.url === '/ssh') result = openSSH(data);
      else { result = { ok:false, error:'Unknown endpoint' }; }
    } catch(e) {
      result = { ok:false, error: e.message };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CMDB Local Agent running on http://127.0.0.1:${PORT}`);
  console.log('Ready to handle RDP and SSH requests from browser.');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Is the agent already running?`);
  } else {
    console.error('Server error:', e.message);
  }
  process.exit(1);
});
