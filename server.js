import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '343';

/* ====== Чтение / запись базы ====== */
function readDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/* ====== API ====== */
app.get('/api/data', (req, res) => {
  const db = readDB();
  const flats = Object.values(db);
  res.json({ flats });
});

app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

app.post('/api/flat', (req, res) => {
  if (req.headers['x-admin-token'] !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const { number, fio, phone, status, note } = req.body;
  if (!number) return res.status(400).json({ error: 'Нет номера' });

  const db = readDB();
  db[number] = { number, fio: fio || '', phone: phone || '',
                 status: status || 'empty', note: note || '' };
  writeDB(db);
  res.json({ ok: true });
});

/* ====== Запуск ====== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
