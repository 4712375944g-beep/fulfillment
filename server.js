const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = '8910902974:AAGXpQxvrAGf194qFRPIrjF0Rd50dqxixdo';
const CHAT_ID = process.env.CHAT_ID || '336948942';
const DB_FILE = path.join(__dirname, 'data.json');

app.use(express.json());

// Cache-Control для всех статических файлов — никакого кеширования
app.use(function(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});


// Health check для Railway
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Ручная раздача статических файлов (надёжнее чем express.static)
var staticDir = path.join(__dirname, 'public');
app.get('*', function(req, res, next) {
  // Пропускаем API-запросы
  if (req.path.startsWith('/api/')) return next();
  
  var filePath = path.join(staticDir, req.path === '/' ? 'index.html' : req.path);
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return res.sendFile(filePath);
    }
  } catch(e) {}
  
  // Если файл не найден — отдаём index.html (SPA-style)
  var indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});

// ====== JSON-хранилище ======
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { orders: [], partners: [], nextId: 1, nextUserId: 1, users: [], tokens: {} }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Инициализация: создаём админа по умолчанию
function initDB() {
  const db = loadDB();
  if (!db.users) db.users = [];
  if (!db.tokens) db.tokens = {};

  const adminExists = db.users.find(u => u.role === 'admin');
  if (!adminExists) {
    db.users.push({
      id: 'admin',
      login: 'admin',
      password: 'admin-secret-2026',
      role: 'admin',
      created_at: new Date().toISOString(),
    });
    saveDB(db);
  }
}
initDB();

// ====== Аутентификация ======
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

// ====== Страницы ======
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/partner', (req, res) => res.sendFile(path.join(__dirname, 'public', 'partner.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

// ====== API: регистрация партнёра (email, статус pending) ======
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
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, parse_mode: 'HTML',
      text: `🏭 <b>Новый партнёр (ожидает подтверждения)</b>\n\n📋 ${esc(company)}\n📍 ${city}${zone ? ' — ' + zone : ''}\n👤 ${esc(contact)}\n📞 ${esc(phone)}\n📧 ${esc(email)}` }),
  }).catch(() => {});
  res.json({ ok: true });
});

// ====== API: регистрация клиента (авто-подтверждён) ======
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

// ====== API: админ — активировать партнёра ======
app.post('/api/admin/partners/:id/approve', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id && u.role === 'partner');
  if (!user) return res.status(404).json({ error: 'Партнёр не найден' });
  user.status = 'approved';
  // Автоматически +1 месяц если не указан срок
  if (!user.expires_at) {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    user.expires_at = d.toISOString().slice(0, 10);
  }
  saveDB(db);
  res.json({ ok: true, login: user.login, expires_at: user.expires_at });
});

// ====== API: админ — продлить партнёра ======
app.patch('/api/admin/partners/:id', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.params.id && u.role === 'partner');
  if (!user) return res.status(404).json({ error: 'Партнёр не найден' });
  const { months, expires_at } = req.body;
  if (expires_at) {
    user.expires_at = expires_at;
  } else if (months && months >= 1) {
    const base = user.expires_at && user.expires_at > new Date().toISOString().slice(0,10)
      ? new Date(user.expires_at) : new Date();
    base.setMonth(base.getMonth() + months);
    user.expires_at = base.toISOString().slice(0, 10);
  } else {
    return res.status(400).json({ error: 'Укажите дату или количество месяцев' });
  }
  saveDB(db);
  res.json({ ok: true, expires_at: user.expires_at });
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
  if (user.role === 'partner' && user.expires_at && user.expires_at < new Date().toISOString().slice(0,10)) {
    return res.status(403).json({ ok: false, error: 'Срок доступа истёк. Свяжитесь с администратором для продления.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = user.id;
  saveDB(db);

  res.json({
    ok: true,
    token,
    role: user.role,
    redirect: user.role === 'admin' ? '/admin' : '/partner',
    user: { login: user.login, city: user.city, zone: user.zone },
  });
});

// ====== API: проверка токена ======
app.get('/api/me', auth, (req, res) => {
  res.json({ login: req.user.login, role: req.user.role, city: req.user.city, zone: req.user.zone });
});

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

// ====== Данные городов ======
const CITIES = require('./cities.js');

// ====== API: список городов ======
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

// ====== API: приём заявки от клиента ======
app.post('/api/order', async (req, res) => {
  const { name, phone, link, city, zone, method } = req.body;
  if (!name || !phone || !link || !city) {
    return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
  }
  const cityInfo = CITIES[city];
  if (!cityInfo) return res.status(400).json({ ok: false, error: 'Город не найден' });

  const db = loadDB();
  const order = {
    id: db.nextId++,
    name, phone, link,
    city: cityInfo.name,
    zone: zone || '',
    method: method || 'FBO',
    status: 'new',
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  db.orders.push(order);
  saveDB(db);

  // Уведомление в Telegram
  const zoneStr = order.zone ? ' — ' + order.zone : '';
  const text = [
    '📦 <b>Новая заявка на фулфилмент</b>',
    '',
    `👤 <b>Имя:</b> ${esc(order.name)}`,
    `📞 <b>Телефон:</b> ${esc(order.phone)}`,
    `🔗 <b>Ссылка:</b> ${esc(order.link)}`,
    `📍 <b>Город/зона:</b> ${order.city}${zoneStr}\n📦 <b>Способ:</b> ${order.method || 'FBO'}`,
    '',
    `<a href="${req.protocol}://${req.get('host')}/admin">Открыть админку</a>`,
  ].join('\n');

  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  }).catch(() => {});

  res.json({ ok: true, id: order.id });
});

// ====== API: админ — заявки ======
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
  db.orders.forEach(o => csv.push(`${o.id},"${o.name}","${o.phone}","${o.link}","${o.city}","${o.zone||''}","${o.status}","${o.created_at}"`));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  res.send('\uFEFF' + csv.join('\n'));
});

// ====== API: админ — партнёры ======
app.get('/api/admin/partners', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  const partners = db.users.filter(u => u.role === 'partner').map(p => ({
    id: p.id, login: p.login, password: p.password, city: p.city, zone: p.zone,
    status: p.status || 'approved', company: p.company, contact: p.contact, phone: p.phone,
    created_at: p.created_at,
  }));
  res.json({ partners, cities: CITIES });
});

app.post('/api/admin/partners', auth, requireAdmin, (req, res) => {
  const { city, login, password } = req.body;
  if (!city) return res.status(400).json({ error: 'Город обязателен' });

  const db = loadDB();
  const partnerLogin = login || `partner-${db.nextUserId}`;
  const partnerPassword = password || crypto.randomBytes(4).toString('hex');

  const user = {
    id: String(db.nextUserId++),
    login: partnerLogin,
    password: partnerPassword,
    role: 'partner',
    city,
    zone: req.body.zone || '',
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  saveDB(db);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    ok: true,
    login: user.login,
    password: user.password,
    link: `${baseUrl}/login`,
    city: user.city,
    zone: user.zone,
  });
});

app.delete('/api/admin/partners/:id', auth, requireAdmin, (req, res) => {
  const db = loadDB();
  db.users = db.users.filter(u => !(u.id === req.params.id && u.role === 'partner'));
  saveDB(db);
  res.json({ ok: true });
});

// ====== API: партнёр — заявки ======
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
  const valid = ['accepted', 'in_progress', 'done'];
  if (!valid.includes(req.body.status)) return res.status(400).json({ error: 'Неверный статус' });

  const db = loadDB();
  const order = db.orders.find(o => o.id === +req.params.id && o.city === req.user.city && o.zone === req.user.zone);
  if (!order) return res.status(404).json({ error: 'Заявка не найдена' });
  order.status = req.body.status;
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Сервер: http://localhost:${PORT}`);
  console.log(`Логин: http://localhost:${PORT}/login`);
  console.log(`Админ: admin / admin-secret-2026`);
});

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ====== Telegram Webhook ======
app.post('/telegram-webhook', (req, res) => {
  const msg = req.body.message || req.body.edited_message;
  if (!msg || !msg.text) return res.sendStatus(200);
  
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  
  if (text === '/start' || text === '/start@Sell_full_bot') {
    fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🏭 *Фулфилмент — найдём склад для вашего товара*\n\nВыберите страну и город, оставьте заявку — мы подберём ближайший фулфилмент.\n\nНажмите кнопку ниже чтобы начать:',
        parse_mode: 'Markdown',
        reply_markup: JSON.stringify({
          inline_keyboard: [[{
            text: '🏭 Подобрать склад',
            web_app: { url: (req.protocol + '://' + req.get('host')) }
          }]]
        })
      }),
    }).catch(() => {});
  }
  
  res.sendStatus(200);
});

// ====== API: Маршруты фулфилментов ======

// Список всех маршрутов (видят все авторизованные)
app.get('/api/routes', auth, (req, res) => {
  const db = loadDB();
  if (!db.routes) db.routes = [];
  // Сортируем по дате — ближайшие сверху
  const routes = [...db.routes].sort((a, b) => a.date.localeCompare(b.date));
  res.json({ routes });
});

// Создать маршрут (только партнёр)
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
    id: db.nextRouteId++,
    type, // 'vezem' или 'otvezti'
    from, to, date,
    volume: volume || '',
    note: note || '',
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

// Удалить свой маршрут
app.delete('/api/routes/:id', auth, (req, res) => {
  const db = loadDB();
  if (!db.routes) db.routes = [];

  const idx = db.routes.findIndex(r => r.id === +req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Маршрут не найден' });

  const route = db.routes[idx];
  // Только создатель или админ может удалить
  if (route.partner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав на удаление' });
  }

  db.routes.splice(idx, 1);
  saveDB(db);
  res.json({ ok: true });
});
