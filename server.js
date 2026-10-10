import express from 'express';
import { Pool } from 'pg';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ТВОЙ_ПАРОЛЬ';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
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
      note TEXT DEFAULT ''
    );
  `);
  console.log('✅ База готова');
}

app.get('/api/data', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM flats ORDER BY number');
    res.json({ flats: result.rows });
  } catch (e) {
    console.error('Ошибка чтения:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

app.post('/api/flat', async (req, res) => {
  if (req.headers['x-admin-token'] !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const { number, fio, phone, status, note } = req.body;
  if (!number) return res.status(400).json({ error: 'Нет номера' });

  try {
    await pool.query(`
      INSERT INTO flats (number, fio, phone, status, note)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (number) DO UPDATE SET
        fio = EXCLUDED.fio,
        phone = EXCLUDED.phone,
        status = EXCLUDED.status,
        note = EXCLUDED.note
    `, [number, fio || '', phone || '', status || 'empty', note || '']);
    res.json({ ok: true });
  } catch (e) {
    console.error('Ошибка записи:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
  });
}).catch(err => {
  console.error('❌ Ошибка инициализации БД:', err);
  process.exit(1);
});
