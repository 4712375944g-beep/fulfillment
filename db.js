// ====== PostgreSQL Database Module ======
// Railway автоматически предоставляет DATABASE_URL при подключении PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway требует SSL
  ssl: { rejectUnauthorized: false },
  // Таймаут соединения
  connectionTimeoutMillis: 10000,
  // Максимум соединений в пуле
  max: 10,
});

// ====== Хелперы ======
/** Выполнить SQL-запрос, вернуть все строки */
async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/** Выполнить запрос, вернуть первую строку или null */
async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Выполнить INSERT/UPDATE/DELETE, вернуть количество затронутых строк */
async function execute(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rowCount;
  } finally {
    client.release();
  }
}

// ====== Миграции (автоматические при старте) ======
async function migrate() {
  console.log('🔄 Запуск миграций...');

  // Таблица пользователей
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      login       VARCHAR(255) NOT NULL UNIQUE,
      password    VARCHAR(255) NOT NULL,
      role        VARCHAR(50)  NOT NULL DEFAULT 'partner',  -- admin / partner / client
      status      VARCHAR(50)  NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
      company     VARCHAR(500),
      city        VARCHAR(255),
      zone        VARCHAR(255),
      contact     VARCHAR(255),
      phone       VARCHAR(100),
      methods     TEXT,          -- FBO,FBS через запятую
      marketplaces TEXT,         -- WB,Ozon через запятую
      description TEXT,
      expires_at  DATE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Таблица токенов авторизации
  await query(`
    CREATE TABLE IF NOT EXISTS tokens (
      token       VARCHAR(255) PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Индекс для быстрого поиска по токену
  await query(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);`);

  // Таблица заявок клиентов
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      phone         VARCHAR(100) NOT NULL,
      link          TEXT NOT NULL,
      city          VARCHAR(255) NOT NULL,
      zone          VARCHAR(255),
      method        VARCHAR(50)  DEFAULT 'FBO',
      methods       TEXT,
      marketplaces  TEXT,
      status        VARCHAR(50)  NOT NULL DEFAULT 'new',  -- new/accepted/in_progress/done/cancelled
      partner_id    INTEGER REFERENCES users(id),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Таблица маршрутов (попутных перевозок)
  await query(`
    CREATE TABLE IF NOT EXISTS routes (
      id              SERIAL PRIMARY KEY,
      direction       VARCHAR(10) NOT NULL,  -- "везет" или "ищет"
      from_city       VARCHAR(255) NOT NULL,
      to_city         VARCHAR(255) NOT NULL,
      date            DATE NOT NULL,
      pallets         INTEGER NOT NULL DEFAULT 0,
      boxes           INTEGER NOT NULL DEFAULT 0,
      marketplaces    TEXT[],        -- массив: {WB, Ozon}
      contact_tg      VARCHAR(255),
      contact_phone   VARCHAR(100),
      partner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      partner_name    VARCHAR(500),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Индекс для фильтрации маршрутов по дате
  await query(`CREATE INDEX IF NOT EXISTS idx_routes_date ON routes(date);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_routes_partner ON routes(partner_id);`);

  // Сидируем админа, если его нет
  const admin = await queryOne(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!admin) {
    await query(`
      INSERT INTO users (login, password, role, status, company)
      VALUES ('admin', 'admin-secret-2026', 'admin', 'approved', 'SellFull Admin')
    `);
    console.log('✅ Админ создан: admin / admin-secret-2026');
  }

  console.log('✅ Миграции завершены');
}

// ====== Проверка соединения ======
async function healthCheck() {
  try {
    await query('SELECT 1');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  pool,
  query,
  queryOne,
  execute,
  migrate,
  healthCheck,
};
