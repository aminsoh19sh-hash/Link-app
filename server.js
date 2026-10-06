const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const APK_DIR = path.join(__dirname, 'apk');
if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });

// تصنيف الملفات حسب الامتداد
const TYPES = {
  apk: ['apk', 'apks', 'xapk'],
  aab: ['aab'],
  zip: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'],
  html: ['html', 'htm'],
  desktop: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'snap', 'flatpak'],
};

function typeOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  for (const [type, exts] of Object.entries(TYPES)) {
    if (exts.includes(ext)) return type;
  }
  return 'other';
}

const MIME = {
  apk: 'application/vnd.android.package-archive',
  zip: 'application/zip',
  html: 'text/html; charset=utf-8',
};

function mimeOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// قائمة كل الملفات في مجلد apk (الملفات المخفية تُتجاهل)
function listFiles() {
  return fs
    .readdirSync(APK_DIR)
    .filter((n) => !n.startsWith('.'))
    .map((n) => {
      try {
        const st = fs.statSync(path.join(APK_DIR, n));
        if (!st.isFile()) return null;
        return { name: n, size: st.size, date: st.mtime.toISOString(), type: typeOf(n) };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// مسار آمن داخل مجلد apk فقط
function safeFile(name) {
  name = String(name || '');
  if (!name || name !== path.basename(name) || name.startsWith('.')) return null;
  const full = path.join(APK_DIR, name);
  if (!full.startsWith(APK_DIR + path.sep)) return null;
  try {
    return fs.statSync(full).isFile() ? { name, full } : null;
  } catch (e) {
    return null;
  }
}

function contentDisposition(name) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/files', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listFiles());
});

// حذف الملف نهائياً من مجلد apk
app.delete('/api/files/:name', (req, res) => {
  const file = safeFile(req.params.name);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
  try {
    fs.unlinkSync(file.full);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'تعذر حذف الملف' });
  }
});

// تحميل الملف بنفس صيغته واسمه الأصلي (تحميل إجباري)
app.get('/download/:name', (req, res) => {
  const file = safeFile(req.params.name);
  if (!file) return res.status(404).send('الملف غير موجود');

  const size = fs.statSync(file.full).size;
  res.status(200);
  res.setHeader('Content-Type', mimeOf(file.name));
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', contentDisposition(file.name));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const stream = fs.createReadStream(file.full);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Open: http://192.168.1.9:${PORT}/`);
});
