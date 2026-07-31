const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '8910902974:AAGXpQxvrAGf194qFRPIrjF0Rd50dqxixdo';
const CHAT_ID = process.env.CHAT_ID || '336948942';
const CITIES = require('./cities.js');
const db = require('./db.js');

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

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// === Auth ===
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || '';
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    const row = await db.queryOne(
      `SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = $1`,
      [token]
    );
    if (!row) return res.status(401).json({ error: 'Неверный токен' });
    req.user = row;
    next();
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
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
app.get('/health', async (_, res) => {
  const dbOk = await db.healthCheck();
  res.json({ status: dbOk ? 'ok' : 'degraded', uptime: process.uptime(), db: dbOk ? 'connected' : 'disconnected' });
});

// Диагностика подключения к базе (только для отладки)
app.get('/api/db-diag', async (_, res) => {
  const info = {
    has_url: !!process.env.DATABASE_URL,
    url_preview: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/\/.*?@/, '//***:***@').replace(/\?.*/, '?...') : 'MISSING',
    ssl_enabled: !!process.env.DATABASE_URL,
  };
  try {
    await db.query('SELECT 1 as test');
    info.connected = true;
  } catch (e) {
    info.connected = false;
    info.error = e.message;
    info.code = e.code;
  }
  res.json(info);
});

// ====== API: регистрация партнёра ======
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, company, city, zone, contact, phone, description, methods, marketplaces } = req.body;
    if (!email || !password || !company || !city || !contact || !phone) {
      return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
    }
    if (password.length < 4) return res.status(400).json({ ok: false, error: 'Пароль от 4 символов' });

    const existing = await db.queryOne(`SELECT id FROM users WHERE login = $1`, [email]);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'Этот email уже зарегистрирован' });
    }

    const methodsStr = Array.isArray(methods) ? methods.join(',') : (methods || '');
    const mktStr = Array.isArray(marketplaces) ? marketplaces.join(',') : (marketplaces || '');

    const user = await db.queryOne(
      `INSERT INTO users (login, password, role, city, zone, company, contact, phone, methods, marketplaces, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [email, password, 'partner', city, zone || '', company, contact, phone, methodsStr, mktStr, description || '', 'pending']
    );

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
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ====== API: регистрация клиента ======
app.post('/api/register-client', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
    if (password.length < 4) return res.status(400).json({ ok: false, error: 'Пароль от 4 символов' });

    const existing = await db.queryOne(`SELECT id FROM users WHERE login = $1`, [email]);
    if (existing) return res.status(400).json({ ok: false, error: 'Email занят' });

    const user = await db.queryOne(
      `INSERT INTO users (login, password, role, company, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [email, password, 'client', name, 'approved']
    );

    const token = crypto.randomBytes(24).toString('hex');
    await db.execute(`INSERT INTO tokens (token, user_id) VALUES ($1,$2)`, [token, user.id]);

    res.json({ ok: true, token, role: 'client', redirect: '/', user: { name, email } });
  } catch (e) {
    console.error('Register client error:', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ====== API: вход ======
app.post('/api/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ ok: false, error: 'Логин и пароль обязательны' });

    const user = await db.queryOne(
      `SELECT * FROM users WHERE login = $1 AND password = $2`,
      [login, password]
    );
    if (!user) return res.status(401).json({ ok: false, error: 'Неверный email или пароль' });
    if (user.role === 'partner' && user.status === 'pending') {
      return res.status(403).json({ ok: false, error: 'Аккаунт ожидает активации. Напишите администратору.' });
    }
    if (user.role === 'partner' && user.expires_at && user.expires_at < new Date().toISOString().slice(0, 10)) {
      return res.status(403).json({ ok: false, error: 'Срок доступа истёк. Свяжитесь с администратором для продления.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    await db.execute(`INSERT INTO tokens (token, user_id) VALUES ($1,$2)`, [token, user.id]);

    res.json({
      ok: true, token, role: user.role,
      redirect: user.role === 'admin' ? '/admin' : '/partner',
      user: { login: user.login, city: user.city, zone: user.zone },
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ====== API: проверка токена ======
app.get('/api/me', auth, (req, res) => {
  res.json({ login: req.user.login, role: req.user.role, city: req.user.city, zone: req.user.zone });
});

// ====== API: панель приборов ======
app.get('/api/admin/health-check', auth, requireAdmin, async (req, res) => {
  try {
    const partners = await db.query(`SELECT * FROM users WHERE role = 'partner'`);
    const pending = partners.filter(p => p.status === 'pending').length;
    const approved = partners.filter(p => p.status === 'approved').length;

    const orderRows = await db.query(`SELECT status, COUNT(*) as cnt FROM orders GROUP BY status`);
    const orderStatuses = { total: 0 };
    orderRows.forEach(r => { orderStatuses[r.status] = parseInt(r.cnt); orderStatuses.total += parseInt(r.cnt); });

    res.json({
      ok: true,
      uptime: process.uptime(),
      components: {
        mini_app: { status: 'ok', label: 'Mini App' },
        cities_api: { status: 'ok', label: 'Города API', count: Object.keys(CITIES).length },
        bot_polling: { status: pollErrors < 5 ? 'ok' : 'error', label: 'Бот (polling)', lastError: lastPollError },
        database: { status: 'ok', label: 'PostgreSQL' },
        orders: { status: 'ok', label: 'Заявки', ...orderStatuses },
        partners: { status: pending > 0 ? 'warn' : 'ok', label: 'Партнёры', total: partners.length, approved, pending },
      },
    });
  } catch (e) {
    console.error('Health check error:', e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

let pollErrors = 0;
let lastPollError = null;

// ====== API: выход ======
app.post('/api/logout', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.body.token || '';
    if (token) await db.execute(`DELETE FROM tokens WHERE token = $1`, [token]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true }); // всё равно выходим
  }
});

// ====== Города ======
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
app.post('/api/order', async (req, res) => {
  try {
    const { name, phone, link, city, zone, methods, marketplaces } = req.body;
    if (!name || !phone || !link || !city || !methods) {
      return res.status(400).json({ ok: false, error: 'Все поля обязательны' });
    }
    const cityInfo = CITIES[city];
    if (!cityInfo) return res.status(400).json({ ok: false, error: 'Город не найден' });

    const methodsStr = Array.isArray(methods) ? methods.join(',') : (methods || '');
    const mktStr = Array.isArray(marketplaces) ? marketplaces.join(',') : (marketplaces || '');

    const order = await db.queryOne(
      `INSERT INTO orders (name, phone, link, city, zone, method, methods, marketplaces, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, phone, link, cityInfo.name, zone || '', methodsStr.split(',')[0] || 'FBO', methodsStr, mktStr, 'new']
    );

    const zoneStr = order.zone ? ' — ' + order.zone : '';
    const host = req.get('host');
    const proto = req.protocol || 'https';

    tg('sendMessage', {
      chat_id: CHAT_ID, parse_mode: 'HTML',
      text: [
        '📦 <b>Новая заявка на фулфилмент</b>', '',
        `👤 <b>Имя:</b> ${esc(order.name)}`,
        `📞 <b>Телефон:</b> ${esc(order.phone)}`,
        `🔗 <b>Ссылка:</b> ${esc(order.link)}`,
        `📍 <b>Город/зона:</b> ${order.city}${zoneStr}`,
        `📦 <b>Способ:</b> ${order.method || 'FBO'}`,
        '', `<a href="${proto}://${host}/admin">Открыть админку</a>`,
      ].join('\n'),
    });

    res.json({ ok: true, id: order.id });
  } catch (e) {
    console.error('Order error:', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ====== Admin: заявки ======
app.get('/api/admin/orders', auth, requireAdmin, async (req, res) => {
  try {
    let sql = `SELECT * FROM orders`;
    const params = [];
    const conditions = [];

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`status = $${params.length}`);
    }
    if (req.query.city) {
      params.push(req.query.city);
      conditions.push(`city = $${params.length}`);
    }
    if (conditions.length) sql += ` WHERE ` + conditions.join(' AND ');
    sql += ` ORDER BY id DESC LIMIT 200`;

    const orders = await db.query(sql, params);
    res.json({ orders, cities: Object.values(CITIES).map(c => c.name) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.patch('/api/admin/orders/:id', auth, requireAdmin, async (req, res) => {
  try {
    const valid = ['new', 'accepted', 'in_progress', 'done', 'cancelled'];
    if (!valid.includes(req.body.status)) return res.status(400).json({ error: 'Неверный статус' });
    const result = await db.execute(`UPDATE orders SET status = $1 WHERE id = $2`, [req.body.status, req.params.id]);
    if (result === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/admin/stats', auth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.query(`SELECT status, COUNT(*) as cnt FROM orders GROUP BY status`);
    const stats = { total: 0, new: 0, accepted: 0, in_progress: 0, done: 0, cancelled: 0 };
    rows.forEach(r => { stats[r.status] = parseInt(r.cnt); stats.total += parseInt(r.cnt); });
    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/admin/export', auth, requireAdmin, async (req, res) => {
  try {
    const orders = await db.query(`SELECT * FROM orders ORDER BY id DESC`);
    const csv = ['id,имя,телефон,ссылка,город,зона,статус,дата'];
    orders.forEach(o => {
      csv.push(`${o.id},"${o.name}","${o.phone}","${o.link}","${o.city}","${o.zone || ''}","${o.status}","${o.created_at}"`);
    });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename=orders.csv');
    res.send('\uFEFF' + csv.join('\n'));
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ====== Admin: партнёры ======
app.get('/api/admin/partners', auth, requireAdmin, async (req, res) => {
  try {
    const partners = await db.query(`SELECT * FROM users WHERE role = 'partner' ORDER BY created_at DESC`);
    res.json({
      partners: partners.map(p => ({
        id: String(p.id), login: p.login, password: p.password, city: p.city, zone: p.zone,
        status: p.status || 'approved', company: p.company, contact: p.contact, phone: p.phone,
        created_at: p.created_at, expires_at: p.expires_at,
      })),
      cities: CITIES,
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/admin/partners', auth, requireAdmin, async (req, res) => {
  try {
    if (!req.body.city) return res.status(400).json({ error: 'Город обязателен' });
    const login = req.body.login || `partner-${Date.now()}`;
    const password = req.body.password || crypto.randomBytes(4).toString('hex');

    const user = await db.queryOne(
      `INSERT INTO users (login, password, role, city, zone, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [login, password, 'partner', req.body.city, req.body.zone || '', 'approved']
    );

    const host = req.get('host');
    const proto = req.protocol || 'https';
    res.json({
      ok: true, login: user.login, password: password,
      link: `${proto}://${host}/login`,
      city: user.city, zone: user.zone,
    });
  } catch (e) {
    console.error('Create partner error:', e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.delete('/api/admin/partners/:id', auth, requireAdmin, async (req, res) => {
  try {
    await db.execute(`DELETE FROM users WHERE id = $1 AND role = 'partner'`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/admin/partners/:id/approve', auth, requireAdmin, async (req, res) => {
  try {
    const user = await db.queryOne(`SELECT * FROM users WHERE id = $1 AND role = 'partner'`, [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Партнёр не найден' });

    let expiresAt = user.expires_at;
    if (!expiresAt) {
      const d = new Date(); d.setMonth(d.getMonth() + 1);
      expiresAt = d.toISOString().slice(0, 10);
    }
    await db.execute(`UPDATE users SET status = 'approved', expires_at = $1 WHERE id = $2`, [expiresAt, req.params.id]);

    res.json({ ok: true, login: user.login, expires_at: expiresAt });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.patch('/api/admin/partners/:id', auth, requireAdmin, async (req, res) => {
  try {
    const user = await db.queryOne(`SELECT * FROM users WHERE id = $1 AND role = 'partner'`, [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Партнёр не найден' });

    let expiresAt;
    const { months, expires_at } = req.body;
    if (expires_at) {
      expiresAt = expires_at;
    } else if (months && months >= 1) {
      const base = user.expires_at && user.expires_at > new Date().toISOString().slice(0, 10)
        ? new Date(user.expires_at) : new Date();
      base.setMonth(base.getMonth() + months);
      expiresAt = base.toISOString().slice(0, 10);
    } else {
      return res.status(400).json({ error: 'Укажите дату или количество месяцев' });
    }
    await db.execute(`UPDATE users SET expires_at = $1 WHERE id = $2`, [expiresAt, req.params.id]);
    res.json({ ok: true, expires_at: expiresAt });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ====== Partner: заявки ======
app.get('/api/partner/orders', auth, async (req, res) => {
  try {
    if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
    const userMethods = req.user.methods ? req.user.methods.split(',') : [];
    const userMkt = req.user.marketplaces ? req.user.marketplaces.split(',') : [];

    let orders = await db.query(
      `SELECT * FROM orders WHERE city = $1 ORDER BY id DESC LIMIT 100`,
      [req.user.city]
    );

    // Фильтрация по методам и маркетплейсам на стороне сервера (для простоты)
    if (userMethods.length) {
      orders = orders.filter(o => {
        if (!o.methods) return false;
        return userMethods.some(m => o.methods.split(',').includes(m));
      });
    }
    if (userMkt.length) {
      orders = orders.filter(o => {
        if (!o.marketplaces) return false;
        return userMkt.some(m => o.marketplaces.split(',').includes(m));
      });
    }

    res.json({ orders, partner: { city: req.user.city, methods: req.user.methods, marketplaces: req.user.marketplaces } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.patch('/api/partner/orders/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
    if (!['accepted', 'in_progress', 'done'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Неверный статус' });
    }
    const result = await db.execute(
      `UPDATE orders SET status = $1 WHERE id = $2 AND city = $3 AND zone = $4`,
      [req.body.status, req.params.id, req.user.city, req.user.zone]
    );
    if (result === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ====== Маршруты (попутные перевозки) ======
app.get('/api/routes', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const routes = await db.query(
      `SELECT * FROM routes WHERE date >= $1 ORDER BY date ASC`,
      [today]
    );
    res.json({ routes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/routes', auth, async (req, res) => {
  try {
    if (req.user.role !== 'partner') return res.status(403).json({ error: 'Только для партнёров' });
    const { from_city, to_city, date, marketplaces, pallets, boxes, contact_tg, contact_phone, direction } = req.body;

    if (!from_city || !to_city || !date) {
      return res.status(400).json({ error: 'Город отправления, город назначения и дата обязательны' });
    }
    if (!direction || !['везет','ищет'].includes(direction)) {
      return res.status(400).json({ error: 'Выберите: везу или ищу перевозку' });
    }

    const palletsNum = parseInt(pallets) || 0;
    const boxesNum = parseInt(boxes) || 0;
    if (palletsNum + boxesNum === 0) {
      return res.status(400).json({ error: 'Укажите количество поддонов или коробов' });
    }

    const route = await db.queryOne(
      `INSERT INTO routes (direction, from_city, to_city, date, pallets, boxes, marketplaces, contact_tg, contact_phone, partner_id, partner_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        direction, from_city, to_city, date, palletsNum, boxesNum,
        Array.isArray(marketplaces) ? marketplaces : (marketplaces ? [marketplaces] : []),
        (contact_tg || '').replace('@', '').trim(),
        (contact_phone || '').trim(),
        req.user.id,
        req.user.company || req.user.login,
      ]
    );

    res.json({ ok: true, route });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/routes/:id', auth, async (req, res) => {
  try {
    const route = await db.queryOne(`SELECT * FROM routes WHERE id = $1`, [req.params.id]);
    if (!route) return res.status(404).json({ error: 'Маршрут не найден' });
    if (String(route.partner_id) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Нет прав на удаление' });
    }
    await db.execute(`DELETE FROM routes WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ====== Telegram Webhook ======
const pendingCustomDate = {};

app.post('/telegram-webhook', (req, res) => {
  const cb = req.body.callback_query;
  if (cb) {
    const msg = cb.message;
    if (!msg) return res.sendStatus(200);
    const chatId = msg.chat.id;
    const msgId = msg.message_id;
    tg('answerCallbackQuery', { callback_query_id: cb.id });

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
    else if (cb.data.startsWith('rej:')) {
      const userId = cb.data.slice(4);
      db.execute(`UPDATE users SET status = 'rejected' WHERE id = $1 AND role = 'partner'`, [userId]).catch(() => {});
      tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: msg.text + '\n\n❌ <b>Отказано</b>' });
    }
    else if (cb.data.startsWith('dt:') && !cb.data.endsWith(':custom')) {
      const parts = cb.data.slice(3).split(':');
      const userId = parts[0];
      const months = parseInt(parts[1]);
      (async () => {
        const d = new Date(); d.setMonth(d.getMonth() + months);
        const expiresAt = d.toISOString().slice(0, 10);
        await db.execute(`UPDATE users SET status = 'approved', expires_at = $1 WHERE id = $2 AND role = 'partner'`, [expiresAt, userId]);
        tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: msg.text + `\n\n✅ <b>Доступ выдан!</b>\n📅 До: ${expiresAt}` });
      })();
      delete pendingCustomDate[chatId];
    }
    else if (cb.data.endsWith(':custom')) {
      const userId = cb.data.slice(3).split(':')[0];
      pendingCustomDate[chatId] = userId;
      tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: msg.text + '\n\n📆 <b>Введите дату в формате ГГГГ-ММ-ДД</b>\n<i>Например: 2026-10-29</i>' });
    }
    return res.sendStatus(200);
  }

  const m = req.body.message || req.body.edited_message;
  if (!m || !m.text) return res.sendStatus(200);
  const chatId = m.chat.id;
  const text = m.text.trim();

  if (pendingCustomDate[chatId]) {
    const userId = pendingCustomDate[chatId];
    const match = text.match(/^\d{4}-\d{2}-\d{2}$/);
    if (match) {
      db.execute(`UPDATE users SET status = 'approved', expires_at = $1 WHERE id = $2 AND role = 'partner'`, [match[0], userId]).catch(() => {});
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ <b>Доступ выдан!</b>\n📅 До: ${match[0]}` });
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Неверный формат. Введите дату как ГГГГ-ММ-ДД (например: 2026-10-29)' });
    }
    delete pendingCustomDate[chatId];
    return res.sendStatus(200);
  }

  if (text === '/start' || text === '/start@Sell_full_bot') {
    const host = req.get('host');
    const proto = req.protocol || 'https';
    tg('sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown',
      text: '🏭 *Фулфилмент — найдём склад для вашего товара*\n\nВыберите страну и город, оставьте заявку — мы подберём ближайший фулфилмент.\n\nНажмите кнопку ниже чтобы начать:',
      reply_markup: { inline_keyboard: [[{ text: '🏭 Подобрать склад', web_app: { url: `${proto}://${host}` } }]] },
    });
  }
  res.sendStatus(200);
});

// ====== Статические страницы ======
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/partner', (_, res) => res.sendFile(path.join(__dirname, 'public', 'partner.html')));
app.get('/login', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (_, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

// ====== Static files + SPA fallback ======
const staticDir = path.join(__dirname, 'public');
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const filePath = path.join(staticDir, req.path === '/' ? 'index.html' : req.path);
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return res.sendFile(filePath);
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

process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err); });
process.on('unhandledRejection', (err) => { console.error('UNHANDLED REJECTION:', err); });

// ====== Старт сервера ======
(async () => {
  try {
    // Ждём готовности базы и запускаем миграции
    console.log('⏳ Подключение к PostgreSQL...');
    await db.migrate();
    console.log('✅ База данных готова');

    app.listen(PORT, () => {
      console.log(`🚀 Сервер: http://localhost:${PORT}`);
      console.log(`👑 Админ: admin / admin-secret-2026`);
      console.log(`🤖 Режим бота: polling`);
      startPolling();
    });
  } catch (e) {
    console.error('❌ Ошибка запуска:', e.message);
    // Всё равно стартуем — может база появится позже
    app.listen(PORT, () => {
      console.log(`⚠️ Сервер запущен БЕЗ базы данных: http://localhost:${PORT}`);
      startPolling();
    });
  }
})();

// ====== Polling mode ======
let lastUpdateId = 0;

async function startPolling() {
  console.log('🔁 Polling started...');
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
  if (u.callback_query) return handleCallbackQuery(u.callback_query);
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
    db.execute(`UPDATE users SET status = 'rejected' WHERE id = $1 AND role = 'partner'`, [userId]).catch(() => {});
    tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: (msg.text || '') + '\n\n❌ <b>Отказано</b>' });
  }
  else if (cb.data.startsWith('dt:') && !cb.data.endsWith(':custom')) {
    const parts = cb.data.slice(3).split(':');
    const userId = parts[0];
    const months = parseInt(parts[1]);
    (async () => {
      const d = new Date(); d.setMonth(d.getMonth() + months);
      const expiresAt = d.toISOString().slice(0, 10);
      await db.execute(`UPDATE users SET status = 'approved', expires_at = $1 WHERE id = $2 AND role = 'partner'`, [expiresAt, userId]);
      tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: (msg.text || '') + '\n\n✅ <b>Доступ выдан!</b>\n📅 До: ' + expiresAt });
    })();
    delete pendingCustomDate[chatId];
  }
  else if (cb.data.endsWith(':custom')) {
    const userId = cb.data.slice(3).split(':')[0];
    pendingCustomDate[chatId] = userId;
    tg('editMessageText', { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', text: (msg.text || '') + '\n\n📆 <b>Введите дату в формате ГГГГ-ММ-ДД</b>\n<i>Например: 2026-10-29</i>' });
  }
}

function handleMessage(m) {
  const chatId = m.chat.id;
  const text = m.text.trim();

  if (pendingCustomDate[chatId]) {
    const userId = pendingCustomDate[chatId];
    const match = text.match(/^\d{4}-\d{2}-\d{2}$/);
    if (match) {
      db.execute(`UPDATE users SET status = 'approved', expires_at = $1 WHERE id = $2 AND role = 'partner'`, [match[0], userId]).catch(() => {});
      tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: '✅ <b>Доступ выдан!</b>\n📅 До: ' + match[0] });
    } else {
      tg('sendMessage', { chat_id: chatId, text: '⚠️ Неверный формат. Введите дату как ГГГГ-ММ-ДД (например: 2026-10-29)' });
    }
    delete pendingCustomDate[chatId];
    return;
  }

  if ((text === '/status' || text === '/status@Sell_full_bot') && String(chatId) === CHAT_ID) {
    (async () => {
      try {
        const partners = await db.query(`SELECT * FROM users WHERE role = 'partner'`);
        const pending = partners.filter(p => p.status === 'pending').length;
        const approved = partners.filter(p => p.status === 'approved').length;
        const orderCount = (await db.queryOne(`SELECT COUNT(*) as cnt FROM orders`))?.cnt || 0;
        const newOrders = (await db.queryOne(`SELECT COUNT(*) as cnt FROM orders WHERE status = 'new'`))?.cnt || 0;
        const uptime = Math.floor(process.uptime());
        const h = Math.floor(uptime / 3600);
        const min = Math.floor((uptime % 3600) / 60);

        tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: [
          '📊 <b>Панель приборов</b>', '',
          '🟢 Mini App — работает',
          '🟢 Города API — ' + Object.keys(CITIES).length + ' городов',
          (pollErrors < 5 ? '🟢' : '🔴') + ' Бот polling — ' + (pollErrors < 5 ? 'OK' : pollErrors + ' ошибок'),
          '🟢 PostgreSQL — подключена', '',
          '<b>Заявки:</b> ' + orderCount + ' (' + newOrders + ' новых)',
          '<b>Партнёры:</b> ' + partners.length + ' (' + approved + ' акт., ' + pending + ' pending)', '',
          '<b>Uptime:</b> ' + h + 'ч ' + min + 'м',
        ].join('\n') });
      } catch(e) { console.error('/status error:', e); }
    })();
  }

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
