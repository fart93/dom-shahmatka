import express from 'express';
import { Pool } from 'pg';

const app = express();
app.use(express.json());
app.use(express.static('public'));

/* ================== ПОЛЬЗОВАТЕЛИ ==================
   role: 'admin' — председатель (видит всё)
   role: 'entrance' — старший по подъезду (видит только свой)
   entrance: 1..8 — номер подъезда
==================================================== */
const USERS = {
  'admin': { password: '343', role: 'admin',    name: 'Председатель совета дома', entrance: null },
  '1':     { password: '111', role: 'entrance', name: 'Старший 1-го подъезда',    entrance: 1 },
  '2':     { password: '222', role: 'entrance', name: 'Старший 2-го подъезда',    entrance: 2 },
  '3':     { password: '333', role: 'entrance', name: 'Старший 3-го подъезда',    entrance: 3 },
  '4':     { password: '444', role: 'entrance', name: 'Старший 4-го подъезда',    entrance: 4 },
  '5':     { password: '555', role: 'entrance', name: 'Старший 5-го подъезда',    entrance: 5 },
  '6':     { password: '666', role: 'entrance', name: 'Старший 6-го подъезда',    entrance: 6 },
  '7':     { password: '777', role: 'entrance', name: 'Старший 7-го подъезда',    entrance: 7 },
  '8':     { password: '888', role: 'entrance', name: 'Старший 8-го подъезда',    entrance: 8 }
};

/* ============== ГРАНИЦЫ ПОДЪЕЗДОВ ==============
   Какие номера квартир в каком подъезде.
   Совпадает с index.html
============================================== */
const FLOORS = 9;
const ENTRANCES_CONFIG = [
  { ground: 4, other: 5 },  // 1 → 1-44
  { ground: 5, other: 6 },  // 2 → 45-97
  { ground: 4, other: 5 },  // 3 → 98-141
  { ground: 5, other: 6 },  // 4 → 142-194
  { ground: 7, other: 8 },  // 5 → 195-265
  { ground: 4, other: 5 },  // 6 → 266-309
  { ground: 7, other: 8 },  // 7 → 310-380
  { ground: 5, other: 6 }   // 8 → 381-433
];

function getEntranceRanges() {
  let running = 1;
  return ENTRANCES_CONFIG.map(cfg => {
    const count = cfg.ground + cfg.other * (FLOORS - 1);
    const range = { start: running, end: running + count - 1 };
    running += count;
    return range;
  });
}
const RANGES = getEntranceRanges();

function inEntrance(num, entranceNumber) {
  const r = RANGES[entranceNumber - 1];
  return r && num >= r.start && num <= r.end;
}

/* ============== ПОДКЛЮЧЕНИЕ К БАЗЕ ============== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS flats (
      number INTEGER PRIMARY KEY,
      fio TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      status TEXT DEFAULT 'empty',
      note TEXT DEFAULT '',
      car TEXT DEFAULT ''
    );
  `);
  await pool.query(`ALTER TABLE flats ADD COLUMN IF NOT EXISTS car TEXT DEFAULT '';`);
  console.log('✅ База готова');
}

/* ============== ПРОВЕРКА ТОКЕНА ==============
   Токен — это просто логин пользователя (простая защита).
   Хранится в браузере и присылается в заголовке.
   Для дома этого достаточно.
============================================== */
function getUser(req) {
  const token = req.headers['x-auth-token'];
  if (!token) return null;
  const user = USERS[token];
  if (!user) return null;
  return { login: token, ...user };
}

/* ============== API ============== */

// Вход
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
  }
  const user = USERS[login];
  if (!user || user.password !== password) {
    return res.status(401).json({ ok: false, error: 'Неверный пароль' });
  }
  res.json({
    ok: true,
    token: login,
    user: { login, name: user.name, role: user.role, entrance: user.entrance }
  });
});

// Выход (на клиенте просто удаляется токен, но на всякий случай есть endpoint)
app.post('/api/logout', (req, res) => {
  res.json({ ok: true });
});

// Получить данные о себе (для проверки при загрузке)
app.get('/api/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { login: user.login, name: user.name, role: user.role, entrance: user.entrance } });
});

// Получить квартиры (фильтруются по правам)
app.get('/api/data', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });

  try {
    let result;
    if (user.role === 'admin') {
      // Председатель видит всё
      result = await pool.query('SELECT * FROM flats ORDER BY number');
    } else {
      // Старший видит только свой подъезд
      const r = RANGES[user.entrance - 1];
      result = await pool.query(
        'SELECT * FROM flats WHERE number BETWEEN $1 AND $2 ORDER BY number',
        [r.start, r.end]
      );
    }
    res.json({ flats: result.rows, user: { login: user.login, name: user.name, role: user.role, entrance: user.entrance } });
  } catch (e) {
    console.error('Ошибка чтения:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Сохранить/изменить квартиру (только свою или все — для админа)
app.post('/api/flat', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });

  const { number, fio, phone, status, note, car } = req.body;
  if (!number) return res.status(400).json({ error: 'Нет номера' });

  // Проверка прав: старший может редактировать только свой подъезд
  if (user.role !== 'admin') {
    if (!inEntrance(Number(number), user.entrance)) {
      return res.status(403).json({ error: 'Нет доступа к этой квартире' });
    }
  }

  try {
    await pool.query(`
      INSERT INTO flats (number, fio, phone, status, note, car)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (number) DO UPDATE SET
        fio = EXCLUDED.fio,
        phone = EXCLUDED.phone,
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        car = EXCLUDED.car
    `, [number, fio || '', phone || '', status || 'empty', note || '', car || '']);
    res.json({ ok: true });
  } catch (e) {
    console.error('Ошибка записи:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

/* ============== ЗАПУСК ============== */
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
  });
}).catch(err => {
  console.error('❌ Ошибка инициализации БД:', err);
  process.exit(1);
});
