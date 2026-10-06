const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const APK_DIR = path.join(__dirname, 'apk');
const DB_FILE = path.join(__dirname, 'uploads.json');

// إنشاء المجلد وقاعدة البيانات تلقائياً
if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');

function readDB() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeDB(items) {
  fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2), 'utf8');
}

// مسار آمن داخل مجلد apk فقط
function safeApkPath(fileName) {
  const base = path.basename(String(fileName || ''));
  if (!base) return null;
  const full = path.join(APK_DIR, base);
  if (!full.startsWith(APK_DIR + path.sep)) return null;
  return fs.existsSync(full) && fs.statSync(full).isFile() ? { base, full } : null;
}

// تنظيف الرابط: يقبل http/https فقط، ويحوّل روابط صفحات github (blob) إلى رابط الملف المباشر
function normalizeUrl(input) {
  let u;
  try {
    u = new URL(String(input || '').trim());
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
    u.pathname = u.pathname.replace(/^\/([^/]+)\/([^/]+)\/blob\//, '/$1/$2/raw/');
  }
  return u.toString();
}

function cleanName(n) {
  return path
    .basename(String(n || ''))
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
}

function nameFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    return cleanName(decodeURIComponent(p.split('/').filter(Boolean).pop() || ''));
  } catch (e) {
    return '';
  }
}

function nameFromDisposition(h) {
  if (!h) return '';
  let m = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(h);
  if (m) {
    try {
      return cleanName(decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')));
    } catch (e) {}
  }
  m = /filename\s*=\s*"?([^";]+)"?/i.exec(h);
  return m ? cleanName(m[1]) : '';
}

function contentDisposition(name) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// قائمة ملفات apk الموجودة في المجلد
app.get('/api/apk-files', (req, res) => {
  const files = fs
    .readdirSync(APK_DIR)
    .filter((f) => !f.startsWith('.'))
    .filter((f) => fs.statSync(path.join(APK_DIR, f)).isFile())
    .filter((f) => f.toLowerCase().endsWith('.apk'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(APK_DIR, f)).size }));
  res.json(files);
});

// كل التطبيقات المسجلة
app.get('/api/apps', (req, res) => {
  const items = readDB()
    .map((i) => ({ ...i, source: i.source || 'file' }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(items);
});

// يبني بيانات المصدر (ملف من المجلد أو رابط) من الطلب
function buildSource(body) {
  const source = body && body.source === 'url' ? 'url' : 'file';
  if (source === 'url') {
    const url = normalizeUrl(body.url);
    if (!url) return { error: 'الرابط غير صالح (يجب أن يبدأ بـ http أو https)' };
    return { data: { source, url, file: null } };
  }
  const file = safeApkPath(body && body.file);
  if (!file) return { error: 'ملف APK غير موجود في مجلد apk' };
  return { data: { source, file: file.base, url: null } };
}

// إضافة تطبيق
app.post('/api/apps', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم التطبيق مطلوب' });
  const src = buildSource(req.body);
  if (src.error) return res.status(400).json({ error: src.error });

  const items = readDB();
  const item = {
    id: crypto.randomBytes(5).toString('hex'),
    name,
    ...src.data,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  writeDB(items);
  res.json(item);
});

// تعديل تطبيق
app.put('/api/apps/:id', (req, res) => {
  const items = readDB();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'غير موجود' });

  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'اسم التطبيق مطلوب' });
  const src = buildSource(req.body);
  if (src.error) return res.status(400).json({ error: src.error });

  item.name = name;
  Object.assign(item, src.data);
  item.updatedAt = new Date().toISOString();
  writeDB(items);
  res.json(item);
});

// حذف تطبيق (يحذف السجل فقط وليس الملف)
app.delete('/api/apps/:id', (req, res) => {
  const items = readDB();
  const next = items.filter((i) => i.id !== req.params.id);
  if (next.length === items.length) return res.status(404).json({ error: 'غير موجود' });
  writeDB(next);
  res.json({ ok: true });
});

// تحميل ملف من مجلد apk بنفس صيغته
function sendLocalFile(res, file) {
  const size = fs.statSync(file.full).size;
  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', contentDisposition(file.base));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file.full).pipe(res);
}

// تحميل ملف من رابط خارجي: السيرفر يجلبه ويمرره بنفس الصيغة والاسم الأصلي (أي نوع ملف)
async function proxyRemoteFile(req, res, item) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let upstream;
  try {
    upstream = await fetch(item.url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': 'apk-link-manager', Accept: '*/*' },
    });
  } catch (e) {
    return res.status(502).send('تعذر الاتصال بالرابط: ' + (e.cause && e.cause.code ? e.cause.code : e.message));
  }
  if (!upstream.ok || !upstream.body) {
    return res.status(502).send(`الرابط أرجع خطأ ${upstream.status}`);
  }

  // الاسم الأصلي: من ترويسة السيرفر، ثم من الرابط النهائي، ثم من الرابط المسجل، ثم اسم التطبيق
  const name =
    nameFromDisposition(upstream.headers.get('content-disposition')) ||
    nameFromUrl(upstream.url) ||
    nameFromUrl(item.url) ||
    cleanName(item.name) ||
    'download';

  let type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = path.extname(name).toLowerCase();

  // الرابط يشير لصفحة ويب وليس لملف
  if (type === 'text/html' && ext !== '.html' && ext !== '.htm') {
    ac.abort();
    return res
      .status(422)
      .send('هذا الرابط يشير إلى صفحة ويب وليس إلى ملف. استخدم رابط الملف المباشر (مثلاً من Releases أو Raw).');
  }

  if (ext === '.apk') type = 'application/vnd.android.package-archive';
  if (!type) type = 'application/octet-stream';

  res.status(200);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', contentDisposition(name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const len = upstream.headers.get('content-length');
  if (len && !upstream.headers.get('content-encoding')) res.setHeader('Content-Length', len);

  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

app.get('/download/:id', async (req, res) => {
  const item = readDB().find((i) => i.id === req.params.id);
  if (!item) return res.status(404).send('الرابط غير صالح');

  if (item.source === 'url') {
    try {
      return await proxyRemoteFile(req, res, item);
    } catch (e) {
      if (!res.headersSent) return res.status(500).send('خطأ أثناء التحميل');
      return res.destroy();
    }
  }

  const file = safeApkPath(item.file);
  if (!file) return res.status(404).send('ملف APK غير موجود على السيرفر');
  sendLocalFile(res, file);
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Open: http://192.168.1.9:${PORT}/`);
});
