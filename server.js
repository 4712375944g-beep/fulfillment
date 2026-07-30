const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '8910902974:AAGXpQxvrAGf194qFRPIrjF0Rd50dqxixdo';
const CHAT_ID = process.env.CHAT_ID || '336948942';
const DB_FILE = path.join(__dirname, 'data.json');

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
  if (!db.users.find(u => u.role === 'admin')) {
    db.users.push({
      id: 'admin', login: 'admin', password: 'admin-secret-2026',
      role: 'admin', created_at: new Date().toISOString(),
    });
    saveDB(db);
  }
}
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
  const { email, password, company, city, zone, contact, phone, description } = req.body;
  if (!email || !password || !company || !city || !contact || !phone) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }
  if (password.length < 4) return res.status(400).json({ ok: false, error: 'Пароль от 4 символов' });

  const db = loadDB();
  if (db.users.find(u => u.login === email)) {
    return res.status(400).json({ ok: false, error: 'Этот email уже зарегистрирован' });
  }

  const user = {
    id: String(db.nextUserId++), login: email, password, role: 'partner',
    city, zone: zone || '', company, contact, phone,
    description: description || '', status: 'pending',
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  saveDB(db);

  tg('sendMessage', {
    chat_id: CHAT_ID, parse_mode: 'HTML',
    text: `🏭 <b>Новый партнёр (ожидает подтверждения)</b>\n\n📋 ${esc(company)}\n📍 ${city}${zone ? ' — ' + zone : ''}\n👤 ${esc(contact)}\n📞 ${esc(phone)}\n📧 ${esc(email)}`,
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
  res.json({ login: req.user.login, role: req.user.role, city: req.user.city, zone: req.user.zone });
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
  const { name, phone, link, city, zone, method } = req.body;
  if (!name || !phone || !link || !city) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }
  const cityInfo = CITIES[city];
  if (!cityInfo) return res.status(400).json({ ok: false, error: 'Город не найден' });

  const db = loadDB();
  const order = {
    id: db.nextId++, name, phone, link,
    city: cityInfo.name, zone: zone || '', method: method || 'FBO',
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
  }));
  res.json({ partners, cities: CITIES });
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
  const orders = db.orders
    .filter(o => o.city === req.user.city && o.zone === req.user.zone)
    .sort((a, b) => b.id - a.id)
    .slice(0, 100);
  res.json({ orders, partner: { city: req.user.city, zone: req.user.zone } });
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

// ====== Маршруты ======
app.get('/api/routes', auth, (req, res) => {
  const db = loadDB();
  if (!db.routes) db.routes = [];
  const routes = [...db.routes].sort((a, b) => a.date.localeCompare(b.date));
  res.json({ routes });
});

app.post('/api/routes', auth, (req, res) => {
  if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
  const { type, from, to, date, volume, note } = req.body;
  if (!type || !from || !to || !date) {
    return res.status(400).json({ error: 'Тип, откуда, куда и дата обязательны' });
  }
  const db = loadDB();
  if (!db.routes) db.routes = [];
  if (!db.nextRouteId) db.nextRouteId = 1;

  const route = {
    id: db.nextRouteId++, type, from, to, date,
    volume: volume || '', note: note || '',
    partner_id: req.user.id,
    partner_name: req.user.company || req.user.login,
    partner_contact: req.user.contact || '',
    partner_phone: req.user.phone || '',
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  db.routes.push(route);
  saveDB(db);
  res.json({ ok: true, route });
});

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
        inline_keyboard: [[{ text: '🏭 Подобрать склад', web_app: { url: `${proto}://${host}` } }]],
      },
    });
  }

  res.sendStatus(200);
});

// ====== Статические страницы ======
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
      tg('editMessageText', {
        chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        text: (msg.text || '') + '\n\n✅ <b>Доступ выдан!</b>\n📅 До: ' + user.expires_at,
      });
    }
    delete pendingCustomDate[chatId];
  }
  else if (cb.data.endsWith(':custom')) {
    const userId = cb.data.slice(3).split(':')[0];
    pendingCustomDate[chatId] = userId;
    tg('editMessageText', {
      chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
      text: (msg.text || '') + '\n\n📆 <b>Введите дату в формате ГГГГ-ММ-ДД</b>\n<i>Например: 2026-10-29</i>',
    });
  }
}

function handleMessage(m) {
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
        tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ <b>Доступ выдан!</b>\n📅 До: ' + match[0] });
      }
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Неверный формат. Введите дату как ГГГГ-ММ-ДД (например: 2026-10-29)' });
    }
    delete pendingCustomDate[chatId];
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

  // /start и кнопка "Склады"
  if (text === '/start' || text === '/start@Sell_full_bot' || text === 'Склады') {
    const host = process.env.RAILWAY_PUBLIC_DOMAIN || 'fulfillment-production-26aa.up.railway.app';
    tg('sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: '🏭 *Фулфилмент — найдём склад для вашего товара*\n\nВыберите страну и город, оставьте заявку — мы подберём ближайший фулфилмент.\n\nНажмите кнопку ниже чтобы начать:',
      reply_markup: JSON.stringify({
        inline_keyboard: [[{ text: '🏭 Подобрать склад', web_app: { url: 'https://' + host + '/app-v2.html' } }]],
      }),
    });
  }
}
