const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '8910902974:AAGXpQxvrAGf194qFRPIrjF0Rd50dqxixdo';
const CHAT_ID = process.env.CHAT_ID || '336948942';
// Если есть папка /data (Railway Volume) — храним там, иначе локально
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'data.json');
console.log('📁 База данных:', DB_FILE);

// === Middleware ===
app.use(express.json());

// CORS
app.use((_, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
app.options('*', (_, res) => res.sendStatus(204));

// === Helpers ===
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { orders: [], partners: [], nextId: 1, nextUserId: 1, users: [], tokens: {} }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function initDB() {
  const db = loadDB();
  if (!db.users) db.users = [];
  if (!db.tokens) db.tokens = {};
  // Всегда гарантируем: админ есть, пароль правильный
  const admin = db.users.find(u => u.role === 'admin');
  if (!admin) {
    db.users.push({
      id: 'admin', login: 'admin', password: 'admin-secret-2026',
      role: 'admin', status: 'approved', created_at: new Date().toISOString(),
    });
    saveDB(db);
    console.log('✅ Админ создан');
  } else {
    // Всегда перезаписываем пароль админа при старте
    admin.password = 'admin-secret-2026';
    if (!admin.status) admin.status = 'approved';
    admin.login = 'admin';
    admin.role = 'admin';
    saveDB(db);
    console.log('🔧 Админ восстановлен');
  }
  // Счётчики
  if (!db.nextId) db.nextId = 1;
  if (!db.nextUserId) db.nextUserId = 1;

  // Всегда создаём тестового партнёра для Дениса
  if (!db.users.find(u => u.login === 'denis@test.com')) {
    db.users.push({
      id: String(db.nextUserId++), login: 'denis@test.com', password: 'test1234',
      role: 'partner', city: 'Москва', zone: 'Север', company: 'Денис',
      contact: 'Денис', phone: '+79000000000',
      methods: 'FBO,FBS', marketplaces: 'WB,Ozon',
      status: 'approved', created_at: new Date().toISOString(),
    });
    saveDB(db);
    console.log('✅ Партнёр denis@test.com создан');
  }

  // Импортируем партнёров из seed-файла (только если их нет)
  try {
    var seed = require('./partners-seed.json');
    var imported = 0;
    seed.forEach(function(p) {
      if (!db.users.find(function(u) { return u.login === p.login; })) {
        db.users.push({
          id: String(db.nextUserId++),
          login: p.login,
          password: p.password || crypto.randomBytes(6).toString('hex'),
          role: 'partner',
          city: p.city || '',
          zone: p.zone || '',
          company: p.company || '',
          contact: p.contact || '',
          phone: p.phone || '',
          methods: p.methods || '',
          marketplaces: p.marketplaces || '',
          status: 'approved',
          created_at: new Date().toISOString(),
        });
        imported++;
      }
    });
    if (imported > 0) { saveDB(db); console.log(`📥 Импортировано партнёров из seed: ${imported}`); }
  } catch(e) { console.log('⚠️ seed-файл не найден, пропускаем импорт'); }
}
// ====== Аварийное создание партнёра (временный эндпоинт) ======
// Диагностика: показать всех пользователей
app.get('/api/dump', (req, res) => {
  const db = loadDB();
  res.json({ users: db.users.map(u => ({ id: u.id, login: u.login, role: u.role, status: u.status, city: u.city, password: u.password ? '***' : 'EMPTY' })), total: db.users.length });
});

// Починить партнёра по email (удалить старого + создать approved)
app.post('/api/fix-partner', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'Укажите email' });
  const db = loadDB();
  // Удаляем все записи с этим email
  var removed = 0;
  db.users = db.users.filter(function(u) {
    if (u.login === email) { removed++; return false; }
    return true;
  });
  // Создаём заново
  if (!db.nextUserId) db.nextUserId = 1;
  var newPass = crypto.randomBytes(4).toString('hex');
  db.users.push({
    id: String(db.nextUserId++), login: email, password: newPass,
    role: 'partner', city: 'Москва', zone: '', company: 'Партнёр',
    contact: '', phone: '', methods: 'FBO,FBS', marketplaces: 'WB,Ozon',
    status: 'approved', created_at: new Date().toISOString(),
  });
  saveDB(db);
  res.json({ ok: true, email: email, password: newPass, removed: removed });
});

app.post('/api/fix-denis', (req, res) => {
  const db = loadDB();
  // Удаляем старого если есть
  db.users = db.users.filter(u => u.login !== 'denis@test.com');
  // Создаём заново
  if (!db.nextUserId) db.nextUserId = 1;
  db.users.push({
    id: String(db.nextUserId++), login: 'denis@test.com', password: 'test1234',
    role: 'partner', city: 'Москва', zone: 'Север', company: 'Денис',
    contact: 'Денис', phone: '+79000000000',
    methods: 'FBO,FBS', marketplaces: 'WB,Ozon',
    status: 'approved', created_at: new Date().toISOString(),
  });
  saveDB(db);
  res.json({ ok: true, login: 'denis@test.com', password: 'test1234' });
});

initDB();

// === Auth ===
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  const db = loadDB();
  const userId = db.tokens[token];
  if (!userId) return res.status(401).json({ error: 'Неверный токен' });
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для админа' });
  next();
}

// === Telegram helpers ===
function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// === Health ===
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ====== API: регистрация партнёра ======
app.post('/api/register', (req, res) => {
  const { email, password, company, city, zone, contact, phone, description, methods, marketplaces, tg_user_id } = req.body;
  if (!email || !password || !company || !city || !contact || !phone) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }
  if (password.length < 4) return res.status(400).json({ ok: false, error: 'Пароль от 4 символов' });

  const db = loadDB();
  if (db.users.find(u => u.login === email)) {
    return res.status(400).json({ ok: false, error: 'Этот email уже зарегистрирован' });
  }

  const methodsStr = Array.isArray(methods) ? methods.join(',') : (methods || '');
  const mktStr = Array.isArray(marketplaces) ? marketplaces.join(',') : (marketplaces || '');

  const user = {
    id: String(db.nextUserId++), login: email, password, role: 'partner',
    city, zone: zone || '', company, contact, phone,
    methods: methodsStr, marketplaces: mktStr,
    description: description || '', status: 'pending',
    created_at: new Date().toISOString(),
    chat_id: tg_user_id ? String(tg_user_id) : undefined,
  };
  db.users.push(user);
  saveDB(db);

  const methodsShow = methodsStr ? '\n📦 ' + methodsStr : '';
  const mktShow = mktStr ? '\n🏪 ' + mktStr : '';

  tg('sendMessage', {
    chat_id: CHAT_ID, parse_mode: 'HTML',
    text: `🏭 <b>Новый партнёр (ожидает подтверждения)</b>\n\n📋 ${esc(company)}\n📍 ${city}${zone ? ' — ' + zone : ''}\n👤 ${esc(contact)}\n📞 ${esc(phone)}\n📧 ${esc(email)}${methodsShow}${mktShow}`,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Дать доступ', callback_data: `apr:${user.id}` },
        { text: '❌ Отказать', callback_data: `rej:${user.id}` },
      ]],
    },
  });

  res.json({ ok: true });
});

// ====== API: регистрация клиента ======
app.post('/api/register-client', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  if (password.length < 4) return res.status(400).json({ ok: false, error: 'Пароль от 4 символов' });

  const db = loadDB();
  if (db.users.find(u => u.login === email)) return res.status(400).json({ ok: false, error: 'Email занят' });

  const user = { id: String(db.nextUserId++), login: email, password, role: 'client', company: name, status: 'approved', created_at: new Date().toISOString() };
  db.users.push(user);

  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDB(db);

  res.json({ ok: true, token, role: 'client', redirect: '/', user: { name, email } });
});

// ====== API: вход ======
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ ok: false, error: 'Логин и пароль обязательны' });

  const db = loadDB();
  const user = db.users.find(u => u.login === login && u.password === password);
  if (!user) return res.status(401).json({ ok: false, error: 'Неверный email или пароль' });
  if (user.role === 'partner' && user.status === 'pending') {
    return res.status(403).json({ ok: false, error: 'Аккаунт ожидает активации. Напишите администратору.' });
  }
  if (user.role === 'partner' && user.expires_at && user.expires_at < new Date().toISOString().slice(0, 10)) {
    return res.status(403).json({ ok: false, error: 'Срок доступа истёк. Свяжитесь с администратором для продления.' });
  }

  // Авто-привязка Telegram ID (если логин через Mini App)
  const tgUserId = req.body.tg_user_id;
  const tgUsername = req.body.tg_username;
  if (user.role === 'partner' && tgUserId) {
    user.chat_id = String(tgUserId);
    if (tgUsername) user.tg_username = tgUsername;
  }

  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDB(db);

  res.json({
    ok: true, token, role: user.role,
    redirect: user.role === 'admin' ? '/admin' : '/partner',
    user: { login: user.login, city: user.city, zone: user.zone },
  });
});

// ====== API: проверка токена ======
app.get('/api/me', auth, (req, res) => {
  res.json({ id: req.user.id, login: req.user.login, role: req.user.role, city: req.user.city, zone: req.user.zone });
});

// ====== API: панель приборов ======
app.get('/api/admin/health-check', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const partners = db.users.filter(u => u.role === 'partner');
  const pending = partners.filter(p => p.status === 'pending').length;
  const approved = partners.filter(p => p.status === 'approved').length;
  const orders = db.orders || [];
  const orderStatuses = { total: orders.length };
  ['new','accepted','in_progress','done','cancelled'].forEach(s => {
    orderStatuses[s] = orders.filter(o => o.status === s).length;
  });
  
  res.json({
    ok: true,
    uptime: process.uptime(),
    components: {
      mini_app: { status: 'ok', label: 'Mini App' },
      cities_api: { status: 'ok', label: 'Города API', count: Object.keys(CITIES).length },
      bot_polling: { status: pollErrors < 5 ? 'ok' : 'error', label: 'Бот (polling)', lastError: lastPollError },
      database: { status: 'ok', label: 'База данных' },
      orders: { status: 'ok', label: 'Заявки', ...orderStatuses },
      partners: { status: pending > 0 ? 'warn' : 'ok', label: 'Партнёры', total: partners.length, approved, pending },
    },
  });
});

let pollErrors = 0;
let lastPollError = null;

// ====== API: выход ======
app.post('/api/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body.token || '';
  if (token) {
    const db = loadDB();
    delete db.tokens[token];
    saveDB(db);
  }
  res.json({ ok: true });
});

// ====== Города ======
const CITIES = require('./cities.js');

app.get('/api/cities', (req, res) => {
  const search = (req.query.q || '').toLowerCase();
  const country = req.query.country || '';
  let entries = Object.entries(CITIES).map(([key, c]) => ({
    key, name: c.name, coords: c.coords,
    zones: c.zones || null, country: c.country,
  }));
  if (country) entries = entries.filter(c => c.country === country);
  if (search) entries = entries.filter(c => c.name.toLowerCase().includes(search));
  entries.sort((a, b) => {
    if (a.country === 'Россия' && b.country !== 'Россия') return -1;
    if (a.country !== 'Россия' && b.country === 'Россия') return 1;
    return a.name.localeCompare(b.name, 'ru');
  });
  res.json(entries);
});

// ====== API: заявка клиента ======
app.post('/api/order', (req, res) => {
  const { name, phone, link, city, zone, methods, marketplaces } = req.body;
  if (!name || !phone || !link || !city || !methods) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }
  const cityInfo = CITIES[city];
  if (!cityInfo) return res.status(400).json({ ok: false, error: 'Город не найден' });

  const db = loadDB();
  const order = {
    id: db.nextId++, name, phone, link,
    city: cityInfo.name, zone: zone || '', method: Array.isArray(methods) ? methods[0] : (methods || 'FBO'),
    status: 'new',
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  db.orders.push(order);
  saveDB(db);

  const zoneStr = order.zone ? ' — ' + order.zone : '';
  const host = req.get('host');
  const proto = req.protocol || 'https';

  tg('sendMessage', {
    chat_id: CHAT_ID, parse_mode: 'HTML',
    text: [
      '📦 <b>Новая заявка на фулфилмент</b>',
      '',
      `👤 <b>Имя:</b> ${esc(order.name)}`,
      `📞 <b>Телефон:</b> ${esc(order.phone)}`,
      `🔗 <b>Ссылка:</b> ${esc(order.link)}`,
      `📍 <b>Город/зона:</b> ${order.city}${zoneStr}`,
      `📦 <b>Способ:</b> ${order.method || 'FBO'}`,
      '',
      `<a href="${proto}://${host}/admin">Открыть админку</a>`,
    ].join('\n'),
  });

  res.json({ ok: true, id: order.id });

  // Рассылаем уведомления партнёрам по городу
  const cityPartners = db.users.filter(u =>
    u.role === 'partner' && u.status === 'approved' &&
    u.city === cityInfo.name && u.chat_id
  );
  cityPartners.forEach(p => {
    tg('sendMessage', {
      chat_id: p.chat_id, parse_mode: 'HTML',
      text: `🔔 <b>Новая заявка в ${esc(cityInfo.name)}</b>\n\n👤 ${esc(order.name)}\n📞 ${esc(order.phone)}\n🔗 ${esc(order.link)}\n📦 ${order.method || 'FBO'}`,
    });
  });
});

// ====== Admin: заявки ======
app.get('/api/admin/orders', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  let orders = [...db.orders];
  if (req.query.status) orders = orders.filter(o => o.status === req.query.status);
  if (req.query.city) orders = orders.filter(o => o.city === req.query.city);
  orders.sort((a, b) => b.id - a.id);
  orders = orders.slice(0, 200);
  res.json({ orders, cities: Object.values(CITIES).map(c => c.name) });
});

app.patch('/api/admin/orders/:id', auth, requireAdmin, (req, res) => {
  const valid = ['new', 'accepted', 'in_progress', 'done', 'cancelled'];
  if (!valid.includes(req.body.status)) return res.status(400).json({ error: 'Неверный статус' });
  const db = loadDB();
  const order = db.orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: 'Заявка не найдена' });
  order.status = req.body.status;
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/admin/stats', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const stats = { total: db.orders.length, new: 0, accepted: 0, in_progress: 0, done: 0, cancelled: 0 };
  db.orders.forEach(o => { stats[o.status] = (stats[o.status] || 0) + 1; });
  res.json({ stats });
});

app.get('/api/admin/export', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const csv = ['id,имя,телефон,ссылка,город,зона,статус,дата'];
  db.orders.forEach(o => csv.push(`${o.id},"${o.name}","${o.phone}","${o.link}","${o.city}","${o.zone || ''}","${o.status}","${o.created_at}"`));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename=orders.csv');
  res.send('\uFEFF' + csv.join('\n'));
});

// ====== Admin: партнёры ======
app.get('/api/admin/partners', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const partners = db.users.filter(u => u.role === 'partner').map(p => ({
    id: p.id, login: p.login, password: p.password, city: p.city, zone: p.zone,
    status: p.status || 'approved', company: p.company, contact: p.contact, phone: p.phone,
    created_at: p.created_at, expires_at: p.expires_at,
    chat_id: p.chat_id || null,
    tg_username: p.tg_username || null,
  }));
  const withChat = partners.filter(p => p.chat_id).length;
  res.json({ partners, cities: CITIES, stats: { total: partners.length, with_chat: withChat, without_chat: partners.length - withChat } });
});

// ====== Admin: клиенты (селлеры) ======
app.get('/api/admin/clients', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const clients = db.users.filter(u => u.role === 'client').map(c => ({
    id: c.id, login: c.login, name: c.company || c.name || '',
    created_at: c.created_at || '',
    chat_id: c.chat_id || null,
    tg_username: c.tg_username || null,
  }));
  const withChat = clients.filter(c => c.chat_id).length;
  res.json({ clients, stats: { total: clients.length, with_chat: withChat, without_chat: clients.length - withChat } });
});

// ====== Экспорт: клиенты с Telegram (CSV) ======
app.get('/api/admin/clients/export', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const clients = db.users.filter(u => u.role === 'client');
  const rows = [['Email','Имя','Telegram ID','Telegram Username','Дата регистрации']];
  clients.forEach(c => {
    rows.push([
      c.login || '',
      c.company || c.name || '',
      c.chat_id || '',
      (c.tg_username ? '@' + c.tg_username : ''),
      (c.created_at || '').slice(0, 10),
    ]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename=clients.csv');
  res.send(csv);
});

// ====== Экспорт: партнёры с Telegram (CSV) ======
app.get('/api/admin/partners/export', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const partners = db.users.filter(u => u.role === 'partner');
  const rows = [['Email','Город','Зона','Компания','Telegram ID','Telegram Username','Статус','Дата']];
  partners.forEach(p => {
    rows.push([
      p.login || '',
      p.city || '',
      p.zone || '',
      p.company || '',
      p.chat_id || '',
      (p.tg_username ? '@' + p.tg_username : ''),
      p.status || 'approved',
      (p.created_at || '').slice(0, 10),
    ]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename=partners.csv');
  res.send(csv);
});

app.post('/api/admin/partners', auth, requireAdmin, (req, res) => {
  if (!req.body.city) return res.status(400).json({ error: 'Город обязателен' });
  const db = loadDB();
  const user = {
    id: String(db.nextUserId++),
    login: req.body.login || `partner-${db.nextUserId}`,
    password: req.body.password || crypto.randomBytes(4).toString('hex'),
    role: 'partner', city: req.body.city,
    zone: req.body.zone || '', status: 'approved',
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  saveDB(db);

  const host = req.get('host');
  const proto = req.protocol || 'https';
  res.json({
    ok: true, login: user.login, password: user.password,
    link: `${proto}://${host}/login`,
    city: user.city, zone: user.zone,
  });
});

app.delete('/api/admin/partners/:id', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  db.users = db.users.filter(u => !(u.id === req.params.id && u.role === 'partner'));
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/partners/:id/approve', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id && u.role === 'partner');
  if (!user) return res.status(404).json({ error: 'Партнёр не найден' });
  user.status = 'approved';
  if (!user.expires_at) {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    user.expires_at = d.toISOString().slice(0, 10);
  }
  saveDB(db);
  res.json({ ok: true, login: user.login, expires_at: user.expires_at });
});

app.patch('/api/admin/partners/:id', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id && u.role === 'partner');
  if (!user) return res.status(404).json({ error: 'Партнёр не найден' });

  const { months, expires_at } = req.body;
  if (expires_at) {
    user.expires_at = expires_at;
  } else if (months && months >= 1) {
    const base = user.expires_at && user.expires_at > new Date().toISOString().slice(0, 10)
      ? new Date(user.expires_at) : new Date();
    base.setMonth(base.getMonth() + months);
    user.expires_at = base.toISOString().slice(0, 10);
  } else {
    return res.status(400).json({ error: 'Укажите дату или количество месяцев' });
  }
  saveDB(db);
  res.json({ ok: true, expires_at: user.expires_at });
});

// ====== Partner: заявки ======
app.get('/api/partner/orders', auth, (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
  const db = loadDB();
  const userMethods = req.user.methods ? req.user.methods.split(',') : [];
  const userMkt = req.user.marketplaces ? req.user.marketplaces.split(',') : [];
  const orders = db.orders
    .filter(o => {
      if (o.city !== req.user.city) return false;
      if (userMethods.length && !userMethods.some(function(m){return (o.methods||'').split(',').includes(m)})) return false;
      if (userMkt.length && !userMkt.some(function(m){return (o.marketplaces||'').split(',').includes(m)})) return false;
      return true;
    })
    .sort((a, b) => b.id - a.id)
    .slice(0, 100);
  res.json({ orders, partner: { city: req.user.city, methods: req.user.methods, marketplaces: req.user.marketplaces } });
});

app.patch('/api/partner/orders/:id', auth, (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
  if (!['accepted', 'in_progress', 'done'].includes(req.body.status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  const db = loadDB();
  const order = db.orders.find(o => o.id === +req.params.id && o.city === req.user.city && o.zone === req.user.zone);
  if (!order) return res.status(404).json({ error: 'Заявка не найдена' });
  order.status = req.body.status;
  saveDB(db);
  res.json({ ok: true });
});

// ====== Маршруты (попутные перевозки) ======
// GET — все маршруты, у которых дата ещё не прошла
app.get('/api/routes', auth, (req, res) => {
  const db = loadDB();
  if (!db.routes) db.routes = [];
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Показываем только маршруты с датой >= сегодня
  const routes = [...db.routes]
    .filter(r => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  res.json({ routes });
});

// POST — создать маршрут
app.post('/api/routes', auth, (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
  const { from_city, to_city, date, marketplaces, pallets, boxes, contact_tg, contact_phone, direction } = req.body;

  if (!from_city || !to_city || !date) {
    return res.status(400).json({ error: 'Город отправления, город назначения и дата обязательны' });
  }
  if (!direction || !['везет','ищет'].includes(direction)) {
    return res.status(400).json({ error: 'Выберите: везу или ищу перевозку' });
  }

  // Хотя бы один тип груза должен быть указан
  const palletsNum = parseInt(pallets) || 0;
  const boxesNum = parseInt(boxes) || 0;
  if (palletsNum + boxesNum === 0) {
    return res.status(400).json({ error: 'Укажите количество поддонов или коробов' });
  }

  const db = loadDB();
  if (!db.routes) db.routes = [];
  if (!db.nextRouteId) db.nextRouteId = 1;

  const route = {
    id: db.nextRouteId++,
    from_city,          // город отправления
    to_city,            // город назначения
    date,               // дата поездки
    marketplaces: Array.isArray(marketplaces) ? marketplaces : (marketplaces ? [marketplaces] : []),
    pallets: palletsNum,  // кол-во поддонов
    boxes: boxesNum,       // кол-во коробов
    direction,           // "везет" — сам на машине, "ищет" — хочет отправить груз
    contact_tg: (contact_tg || '').replace('@', '').trim(),
    contact_phone: (contact_phone || '').trim(),
    partner_id: req.user.id,
    partner_name: req.user.company || req.user.login,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  db.routes.push(route);
  saveDB(db);
  res.json({ ok: true, route });
});

// DELETE — удалить свой маршрут (или админ может любой)
app.delete('/api/routes/:id', auth, (req, res) => {
  const db = loadDB();
  if (!db.routes) db.routes = [];
  const idx = db.routes.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Маршрут не найден' });
  const route = db.routes[idx];
  if (route.partner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав на удаление' });
  }
  db.routes.splice(idx, 1);
  saveDB(db);
  res.json({ ok: true });
});

// ====== Telegram Webhook ======
const pendingCustomDate = {};
const pendingBind = {}; // ожидание email для привязки партнёра

app.post('/telegram-webhook', (req, res) => {
  // Callback Query
  const cb = req.body.callback_query;
  if (cb) {
    const msg = cb.message;
    if (!msg) return res.sendStatus(200); // безопасно: нет сообщения = нечего редактировать

    const chatId = msg.chat.id;
    const msgId = msg.message_id;

    // Убираем часики
    tg('answerCallbackQuery', { callback_query_id: cb.id });

    // ✅ Дать доступ → выбор срока
    if (cb.data.startsWith('apr:')) {
      const userId = cb.data.slice(4);
      tg('editMessageText', {
        chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        text: msg.text + '\n\n📅 <b>На какой срок дать доступ?</b>',
        reply_markup: {
          inline_keyboard: [
            [{ text: '1 месяц', callback_data: `dt:${userId}:1` }, { text: '2 месяца', callback_data: `dt:${userId}:2` }],
            [{ text: '3 месяца', callback_data: `dt:${userId}:3` }, { text: '6 месяцев', callback_data: `dt:${userId}:6` }],
            [{ text: '📆 Своя дата', callback_data: `dt:${userId}:custom` }],
          ],
        },
      });
    }

    // ❌ Отказать
    else if (cb.data.startsWith('rej:')) {
      const userId = cb.data.slice(4);
      const db = loadDB();
      const user = db.users.find(u => u.id === userId && u.role === 'partner');
      if (user) {
        user.status = 'rejected';
        saveDB(db);
      }
      tg('editMessageText', {
        chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        text: msg.text + '\n\n❌ <b>Отказано</b>',
      });
    }

    // Дата: предустановленная
    else if (cb.data.startsWith('dt:') && !cb.data.endsWith(':custom')) {
      const parts = cb.data.slice(3).split(':');
      const userId = parts[0];
      const months = parseInt(parts[1]);
      const db = loadDB();
      const user = db.users.find(u => u.id === userId && u.role === 'partner');
      if (user) {
        const d = new Date(); d.setMonth(d.getMonth() + months);
        user.status = 'approved';
        user.expires_at = d.toISOString().slice(0, 10);
        saveDB(db);
        tg('editMessageText', {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          text: msg.text + `\n\n✅ <b>Доступ выдан!</b>\n📅 До: ${user.expires_at}`,
        });
      }
      delete pendingCustomDate[chatId];
    }

    // Дата: своя
    else if (cb.data.endsWith(':custom')) {
      const userId = cb.data.slice(3).split(':')[0];
      pendingCustomDate[chatId] = userId;
      tg('editMessageText', {
        chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        text: msg.text + '\n\n📆 <b>Введите дату в формате ГГГГ-ММ-ДД</b>\n<i>Например: 2026-10-29</i>',
      });
    }

    return res.sendStatus(200);
  }

  // Обычное сообщение
  const m = req.body.message || req.body.edited_message;
  if (!m || !m.text) return res.sendStatus(200);

  const chatId = m.chat.id;
  const text = m.text.trim();

  // Ждём дату от админа
  if (pendingCustomDate[chatId]) {
    const userId = pendingCustomDate[chatId];
    const match = text.match(/^\d{4}-\d{2}-\d{2}$/);
    if (match) {
      const db = loadDB();
      const user = db.users.find(u => u.id === userId && u.role === 'partner');
      if (user) {
        user.status = 'approved';
        user.expires_at = match[0];
        saveDB(db);
        tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ <b>Доступ выдан!</b>\n📅 До: ${match[0]}` });
      }
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Неверный формат. Введите дату как ГГГГ-ММ-ДД (например: 2026-10-29)' });
    }
    delete pendingCustomDate[chatId];
    return res.sendStatus(200);
  }

  // /start
  if (text === '/start' || text === '/start@Sell_full_bot') {
    const host = req.get('host');
    const proto = req.protocol || 'https';
    tg('sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: '🏭 *Фулфилмент — найдём склад для вашего товара*\n\nВыберите страну и город, оставьте заявку — мы подберём ближайший фулфилмент.\n\nНажмите кнопку ниже чтобы начать:',
      reply_markup: {
        inline_keyboard: [[{ text: '🏭 Подобрать склад', web_app: { url: `${proto}://${host}/app-v2.html?v=3` } }]],
      },
    });
  }

  res.sendStatus(200);
});

// ====== Статические страницы ======
// Запрещаем кэширование для Mini App (Telegram агрессивно кэширует)
app.use('/app-v2.html', (_, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use('/app-v2.js', (_, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/partner', (_, res) => res.sendFile(path.join(__dirname, 'public', 'partner.html')));
app.get('/login', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (_, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

// ====== Static files + SPA fallback (ПОСЛЕ всех API роутов) ======
const staticDir = path.join(__dirname, 'public');
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const filePath = path.join(staticDir, req.path === '/' ? 'index.html' : req.path);
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return res.sendFile(filePath);
    }
  } catch (_) {}
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  next();
});

// ====== Error handler ======
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

app.listen(PORT, () => {
  console.log(`Сервер: http://localhost:${PORT}`);
  console.log(`Админ: admin / admin-secret-2026`);
  console.log(`Режим бота: polling (POST заблокирован Railway)`);
  startPolling();
});

// ====== Polling mode (вместо вебхука — Railway блокирует POST) ======
let lastUpdateId = 0;

async function startPolling() {
  console.log('Polling started...');
  while (true) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
      const d = await r.json();
      if (d.ok && d.result.length) {
        for (const u of d.result) {
          lastUpdateId = u.update_id;
          handleUpdate(u);
        }
      }
    } catch (e) { pollErrors++; lastPollError = e.message; console.error('Poll error:', e.message); }
    await new Promise(r => setTimeout(r, 500));
  }
}

function handleUpdate(u) {
  // Callback query (inline buttons)
  if (u.callback_query) return handleCallbackQuery(u.callback_query);
  // Message
  const m = u.message || u.edited_message;
  if (!m || !m.text) return;
  handleMessage(m);
}

function handleCallbackQuery(cb) {
  const msg = cb.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const msgId = msg.message_id;

  tg('answerCallbackQuery', { callback_query_id: cb.id });

  if (cb.data.startsWith('apr:')) {
    const userId = cb.data.slice(4);
    tg('editMessageText', {
      chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
      text: (msg.text || '') + '\n\n📅 <b>На какой срок дать доступ?</b>',
      reply_markup: JSON.stringify({
        inline_keyboard: [
          [{ text: '1 месяц', callback_data: 'dt:' + userId + ':1' }, { text: '2 месяца', callback_data: 'dt:' + userId + ':2' }],
          [{ text: '3 месяца', callback_data: 'dt:' + userId + ':3' }, { text: '6 месяцев', callback_data: 'dt:' + userId + ':6' }],
          [{ text: '📆 Своя дата', callback_data: 'dt:' + userId + ':custom' }],
        ],
      }),
    });
  }
  else if (cb.data.startsWith('rej:')) {
    const userId = cb.data.slice(4);
    const db = loadDB();
    const user = db.users.find(u => u.id === userId && u.role === 'partner');
    if (user) { user.status = 'rejected'; saveDB(db); }
    tg('editMessageText', {
      chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
      text: (msg.text || '') + '\n\n❌ <b>Отказано</b>',
    });
  }
  else if (cb.data.startsWith('dt:') && !cb.data.endsWith(':custom')) {
    const parts = cb.data.slice(3).split(':');
    const userId = parts[0];
    const months = parseInt(parts[1]);
    const db = loadDB();
    const user = db.users.find(u => u.id === userId && u.role === 'partner');
    if (user) {
      const d = new Date(); d.setMonth(d.getMonth() + months);
      user.status = 'approved';
      user.expires_at = d.toISOString().slice(0, 10);
      saveDB(db);
      var host = process.env.RAILWAY_PUBLIC_DOMAIN || 'fulfillment-production-26aa.up.railway.app';
      var approvalText = (msg.text || '') + '\n\n✅ <b>Доступ выдан!</b>\n📅 До: ' + user.expires_at +
        '\n\n🔑 <b>Данные для входа:</b>\nЛогин: <code>' + esc(user.login) + '</code>\nПароль: <code>' + esc(user.password) + '</code>' +
        '\n\n🔗 Кабинет: ' + host + '/partner' +
        '\n\n📋 <i>Передайте партнёру логин/пароль. Попросите его написать /start в @Sell_full_bot для получения уведомлений о заявках.</i>';
      tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: approvalText });
      // Если у партнёра есть chat_id — отправляем ему приветствие
      if (user.chat_id) {
        tg('sendMessage', { chat_id: user.chat_id, parse_mode: 'HTML', text:
          '🎉 <b>Регистрация подтверждена!</b>\n\n' +
          '🔑 <b>Логин:</b> <code>' + esc(user.login) + '</code>\n' +
          '🔒 <b>Пароль:</b> <code>' + esc(user.password) + '</code>\n\n' +
          '🔗 Кабинет партнёра: ' + host + '/partner\n\n' +
          '📋 Здесь вы будете видеть заявки клиентов и управлять маршрутами. Уведомления о новых заявках будут приходить сюда же.'
        });
      }
    }
    delete pendingCustomDate[chatId];
  }
else if (cb.data.endsWith(':custom')) {
    const userId = cb.data.slice(3).split(':')[0];
    pendingCustomDate[chatId] = userId;
    tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
      text: (msg.text || '') + '\n\n📆 <b>Введите дату в формате ГГГГ-ММ-ДД</b>\n<i>Например: 2026-10-29</i>' });
  }
  else if (cb.data === 'partner_orders') {
    var dbPo = loadDB();
    var partner = dbPo.users.find(function(u) { return u.chat_id === String(chatId) && u.role === 'partner'; });
    if (!partner) { tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Аккаунт не найден', show_alert: true }); return; }
    var orders = (dbPo.orders || []).filter(function(o) { return o.city === partner.city && (!partner.zone || o.zone === partner.zone); });
    if (orders.length === 0) { tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Нет заявок в вашем городе', show_alert: true }); }
    else { var sm = { new: '🆕', in_progress: '🔄', done: '✅', cancelled: '❌' }; var ls = orders.slice(-5).map(function(o) { return (sm[o.status]||'📦')+' #'+o.id+' — '+o.name+' | '+(o.method||'FBO')+' | '+o.created_at; }); tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📦 <b>Заявки в '+partner.city+'</b>\n\n'+ls.join('\n') }); }
  }
  else if (cb.data === 'client_orders') {
    var dbCo = loadDB();
    var client = dbCo.users.find(function(u) { return u.chat_id === String(chatId) && u.role === 'client'; });
    if (!client) { tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Аккаунт не найден', show_alert: true }); return; }
    var co = (dbCo.orders || []).filter(function(o) { return o.phone === client.phone || o.phone === client.login; });
    if (co.length === 0) { tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'У вас нет заявок', show_alert: true }); }
    else { var sc = { new: '🆕', in_progress: '🔄', done: '✅', cancelled: '❌' }; var ps = co.slice(-5).map(function(o) { return (sc[o.status]||'📦')+' #'+o.id+' '+o.city+' | '+(o.method||'FBO')+' | '+o.created_at; }); tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📋 <b>Ваши заявки</b>\n\n'+ps.join('\n') }); }
  }
}

function handleMessage(m) {
  const chatId = m.chat.id;
  const tgUsername = (m.from && m.from.username) ? m.from.username : null;
  const text = m.text.trim();

  // Ждём дату от админа
  if (pendingCustomDate[chatId]) {
    const userId = pendingCustomDate[chatId];
    const match = text.match(/^\d{4}-\d{2}-\d{2}$/);
    if (match) {
      const db = loadDB();
      const user = db.users.find(u => u.id === userId && u.role === 'partner');
      if (user) {
        user.status = 'approved';
        user.expires_at = match[0];
        saveDB(db);
        tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ <b>Доступ выдан!</b>\n📅 До: ' + match[0] });
      }
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Неверный формат. Введите дату как ГГГГ-ММ-ДД (например: 2026-10-29)' });
    }
    delete pendingCustomDate[chatId];
    return;
  }

  // Привязка партнёра: ждём email после /bind
  if (pendingBind[chatId]) {
    delete pendingBind[chatId];
    var emailMatch = text.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
    if (emailMatch) {
      var db = loadDB();
      var partner = db.users.find(function(u) { return u.role === 'partner' && u.login === emailMatch[0]; });
      if (partner) {
        partner.chat_id = String(chatId);
        if (tgUsername) partner.tg_username = tgUsername;
        saveDB(db);
        tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ <b>Готово!</b> Теперь вы будете получать уведомления о новых заявках в вашем городе.' });
      } else {
        tg('sendMessage', { chat_id: chatId, text: '⚠️ Партнёр с таким email не найден. Убедитесь что вы зарегистрированы и вводите тот же email что при регистрации.' });
      }
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Неверный формат email. Попробуйте ещё раз: /bind' });
    }
    return;
  }

  // /bind — привязать Telegram к аккаунту партнёра
  if (text === '/bind' || text === '/bind@Sell_full_bot') {
    pendingBind[chatId] = true;
    tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📧 <b>Введите ваш email</b> (тот что использовали при регистрации).\n\nЭто привяжет Telegram к вашему аккаунту, и вы будете получать уведомления о новых заявках в вашем городе.' });
    return;
  }

  // /reset — восстановить пароль
  var resetMatch = text.match(/^\/reset(?:@Sell_full_bot)?\s+(.+)$/);
  if (resetMatch) {
    var resetEmail = resetMatch[1].trim();
    var dbReset = loadDB();
    var partnerReset = dbReset.users.find(function(u) { return u.role === 'partner' && u.login === resetEmail; });
    if (partnerReset) {
      partnerReset.password = crypto.randomBytes(4).toString('hex');
      saveDB(dbReset);
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🔑 <b>Новый пароль:</b> <code>' + partnerReset.password + '</code>\n\nИспользуйте его для входа в кабинет партнёра.' });
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Партнёр с таким email не найден.' });
    }
    return;
  }

  // /reset без email — подсказка
  if (text === '/reset' || text === '/reset@Sell_full_bot') {
    tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '🔑 <b>Восстановление пароля</b>\n\nНапишите: <code>/reset email@example.com</code>' });
    return;
  }

  // /status — только для владельца
  if ((text === '/status' || text === '/status@Sell_full_bot') && String(chatId) === CHAT_ID) {
    const db = loadDB();
    const partners = db.users.filter(u => u.role === 'partner');
    const pending = partners.filter(p => p.status === 'pending').length;
    const approved = partners.filter(p => p.status === 'approved').length;
    const orders = (db.orders || []).length;
    const newOrders = (db.orders || []).filter(o => o.status === 'new').length;
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);

    tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: [
      '📊 <b>Панель приборов</b>', '',
      '🟢 Mini App — работает',
      '🟢 Города API — ' + Object.keys(CITIES).length + ' городов',
      (pollErrors < 5 ? '🟢' : '🔴') + ' Бот polling — ' + (pollErrors < 5 ? 'OK' : pollErrors + ' ошибок'),
      '🟢 База данных — читается/пишется', '',
      '<b>Заявки:</b> ' + orders + ' (' + newOrders + ' новых)',
      '<b>Партнёры:</b> ' + partners.length + ' (' + approved + ' акт., ' + pending + ' pending)', '',
      '<b>Uptime:</b> ' + h + 'ч ' + m + 'м',
    ].join('\n') });
  }

  // /broadcast — рассылка админа
  if (text.startsWith('/broadcast') && String(chatId) === CHAT_ID) {
    var isPartners = text.startsWith('/broadcast_partners');
    var isClients = text.startsWith('/broadcast_clients');
    var cmdName = isPartners ? '/broadcast_partners' : (isClients ? '/broadcast_clients' : '/broadcast');
    if (!isPartners && !isClients && !text.startsWith('/broadcast ')) {
      tg('sendMessage', { chat_id: chatId, text: '📢 Команды рассылки:\n/broadcast Текст — всем\n/broadcast_partners Текст — фулфилментам\n/broadcast_clients Текст — селлерам' });
      return;
    }
    var broadcastMsg = text.slice(cmdName.length).trim();
    if (!broadcastMsg) { tg('sendMessage', { chat_id: chatId, text: '⚠️ Напишите: ' + cmdName + ' Текст' }); return; }
    var dbBC = loadDB();
    var targets = dbBC.users.filter(function(u) {
      if (!u.chat_id) return false;
      if (isPartners) return u.role === 'partner';
      if (isClients) return u.role === 'client';
      return u.role === 'partner' || u.role === 'client';
    });
    if (targets.length === 0) { tg('sendMessage', { chat_id: chatId, text: '⚠️ Нет получателей с активированным ботом' }); return; }
    var label = isPartners ? 'фулфилментам' : (isClients ? 'селлерам' : 'пользователям');
    var sent = 0;
    targets.forEach(function(u) {
      tg('sendMessage', { chat_id: u.chat_id, parse_mode: 'HTML', text: '📢 <b>SellFull</b>\n\n' + broadcastMsg });
      sent++;
    });
    tg('sendMessage', { chat_id: chatId, text: '✅ Отправлено ' + label + ': ' + sent + '/' + targets.length });
    return;
  }

// /mystats — статистика заявок
  if (text === '/mystats' || text === '/mystats@Sell_full_bot') {
    var dbStats = loadDB();
    var userStats = dbStats.users.find(function(u) { return u.chat_id === String(chatId); });
    if (!userStats) { tg('sendMessage', { chat_id: chatId, text: '⚠️ Ваш аккаунт не привязан. Используйте /bind' }); return; }
    if (userStats.role === 'partner') {
      var partnerOrders = (dbStats.orders || []).filter(function(o) { return o.city === userStats.city && (!userStats.zone || o.zone === userStats.zone); });
      var statusCount = { new: 0, in_progress: 0, done: 0, cancelled: 0 };
      partnerOrders.forEach(function(o) { statusCount[o.status] = (statusCount[o.status] || 0) + 1; });
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: [
        '📊 <b>Статистика фулфилмента</b>', '', '📍 ' + (userStats.city || '?') + (userStats.zone ? ' — ' + userStats.zone : ''), '',
        '📦 Всего заявок: ' + partnerOrders.length, '🆕 Новых: ' + (statusCount.new || 0),
        '🔄 В работе: ' + (statusCount.in_progress || 0), '✅ Выполнено: ' + (statusCount.done || 0),
        '❌ Отменено: ' + (statusCount.cancelled || 0),
      ].join('\n') });
    } else if (userStats.role === 'client') {
      var clientOrders = (dbStats.orders || []).filter(function(o) { return o.phone === userStats.phone || o.phone === userStats.login; });
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '📋 <b>Ваши заявки</b>\n\n📦 Всего: ' + clientOrders.length + '\n' + (clientOrders.length === 0 ? 'Нет заявок' : '') });
      if (clientOrders.length > 0) {
        clientOrders.slice(-5).forEach(function(o) {
          var se = { new: '🆕', in_progress: '🔄', done: '✅', cancelled: '❌' };
          tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: [se[o.status] || '📦', '📍 ' + o.city + (o.zone ? ' — ' + o.zone : ''), '📦 ' + (o.method || 'FBO'), '📅 ' + o.created_at].join('  |  ') });
        });
      }
    }
    return;
  }

    // Авто-распознавание email: если пользователь прислал email без команды — предлагаем /bind
  var autoEmailMatch = text.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
  if (autoEmailMatch) {
    var dbAuto = loadDB();
    var autoPartner = dbAuto.users.find(function(u) { return u.role === 'partner' && u.login === autoEmailMatch[0]; });
    if (autoPartner && !autoPartner.chat_id) {
      // Нашли партнёра без привязки — привязываем автоматически
      autoPartner.chat_id = String(chatId);
      if (tgUsername) autoPartner.tg_username = tgUsername;
      saveDB(dbAuto);
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ <b>Готово!</b> Ваш аккаунт <code>' + autoEmailMatch[0] + '</code> привязан к Telegram.\n\nТеперь вы будете получать уведомления о новых заявках в вашем городе.' });
      return;
    }
    if (autoPartner && autoPartner.chat_id) {
      // Уже привязан
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: 'ℹ️ Этот email уже привязан к Telegram.\n\nИспользуйте /start чтобы открыть подбор складов.' });
      return;
    }
    // Email не найден — предлагаем регистрацию
    var hostAuto = process.env.RAILWAY_PUBLIC_DOMAIN || 'fulfillment-production-26aa.up.railway.app';
    tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '⚠️ Партнёр с email <code>' + autoEmailMatch[0] + '</code> не найден.\n\nЕсли вы ещё не регистрировались — перейдите по ссылке ниже и заполните форму. После одобрения заявки отправьте боту команду /bind для привязки Telegram.', reply_markup: JSON.stringify({ inline_keyboard: [[{ text: '📝 Зарегистрироваться как фулфилмент', web_app: { url: 'https://' + hostAuto + '/register?v=4' } }]] }) });
    return;
  }

  // /start и кнопка "Склады"
if (text === '/start' || text === '/start@Sell_full_bot' || text === 'Склады') {
    var host = process.env.RAILWAY_PUBLIC_DOMAIN || 'fulfillment-production-26aa.up.railway.app';
    var dbStart = loadDB();
    var existingPartner = dbStart.users.find(function(u) { return u.chat_id === String(chatId) && u.role === 'partner'; });
    var existingClient = dbStart.users.find(function(u) { return u.chat_id === String(chatId) && u.role === 'client'; });
    if (existingPartner) {
      tg('sendMessage', { chat_id: chatId, parse_mode: 'Markdown',
        text: '🏭 *Панель фулфилмента*\n\nГород: ' + (existingPartner.city || '?') + (existingPartner.zone ? ' — ' + existingPartner.zone : '') + '\nСтатус: ✅ Активен' + (existingPartner.expires_at ? ' (до ' + existingPartner.expires_at + ')' : ''),
        reply_markup: JSON.stringify({ inline_keyboard: [
          [{ text: '📦 Мои заявки', callback_data: 'partner_orders' }],
          [{ text: '🏭 Подобрать склад', web_app: { url: 'https://' + host + '/app-v2.html?v=3' } }],
          [{ text: '🔗 Кабинет партнёра', web_app: { url: 'https://' + host + '/partner?v=4' } }],
        ]})});
    } else if (existingClient) {
      tg('sendMessage', { chat_id: chatId, parse_mode: 'Markdown',
        text: '🛒 *Панель селлера*\n\nОставьте заявку — мы подберём ближайший фулфилмент.\n\n/mystats — посмотреть свои заявки',
        reply_markup: JSON.stringify({ inline_keyboard: [
          [{ text: '🏭 Подобрать склад', web_app: { url: 'https://' + host + '/app-v2.html?v=3' } }],
          [{ text: '📋 Мои заявки', callback_data: 'client_orders' }],
        ]})});
    } else {
      tg('sendMessage', { chat_id: chatId, parse_mode: 'Markdown',
        text: '🏭 *Фулфилмент — найдём склад для вашего товара*\n\nВыберите страну и город, оставьте заявку — мы подберём ближайший фулфилмент.\n\n*Для партнёров:*\n/bind — привязать Telegram к аккаунту\n/reset — восстановить пароль',
        reply_markup: JSON.stringify({ inline_keyboard: [
          [{ text: '🏭 Подобрать склад', web_app: { url: 'https://' + host + '/app-v2.html?v=3' } }],
          [{ text: '📝 Регистрация фулфилмента', web_app: { url: 'https://' + host + '/register?v=4' } }],
        ]})});
    }}
}
// deploy trigger 2026-08-01T12:23:58Z
// redeploy trigger 1785593533
