const https = require('https');
const fs = require('fs');
const path = require('path');

// Читаем .env
const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)/);
  if (m) env[m[1]] = m[2];
});

const ADMIN_LOGIN = env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin-secret-2026';
const HOST = 'fulfillment-production-26aa.up.railway.app';

// Читаем старых партнёров
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const oldPartners = (db.users || []).filter(u => u.role === 'partner');
console.log(`Партнёров для импорта: ${oldPartners.length}`);

function fetchAPI(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = '***' + token;
    
    const req = https.request({
      hostname: HOST, method, path,
      headers
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Логинимся
  const login = await fetchAPI('POST', '/api/login', { login: ADMIN_LOGIN, password: ADMIN_PASSWORD });
  if (!login.ok) { console.error('Логин не удался:', login); return; }
  const token = login.token;
  console.log('Логин OK');

  let ok = 0, fail = 0;
  for (const p of oldPartners) {
    const body = {
      login: p.login || '',
      password: p.password || 'partner123',
      city: p.city || 'Москва',
      contact: p.contact || p.company || '',
      phone: p.phone || '',
      company: p.company || ''
    };
    try {
      const r = await fetchAPI('POST', '/api/admin/partners', body, token);
      if (r.ok) {
        console.log(`  ✅ ${p.company || '?'}`);
        ok++;
      } else {
        console.log(`  ⚠️ ${p.company}: ${r.error}`);
        fail++;
      }
    } catch(e) { console.log(`  ❌ ${p.company}: ${e.message}`); fail++; }
  }
  console.log(`\nИтог: ${ok} добавлено, ${fail} ошибок`);
}

main();
