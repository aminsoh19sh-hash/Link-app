const $ = (id) => document.getElementById(id);

const FILTERS = [
  { key: 'all', label: 'الكل' },
  { key: 'apk', label: 'APK' },
  { key: 'aab', label: 'AAB' },
  { key: 'zip', label: 'ZIP' },
  { key: 'html', label: 'HTML' },
  { key: 'desktop', label: 'سطح المكتب' },
  { key: 'other', label: 'أخرى' },
];

const BADGE = { apk: 'APK', aab: 'AAB', zip: 'ZIP', html: 'HTML', desktop: 'Desktop', other: 'ملف' };

let files = [];
let activeFilter = 'all';

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function linkFor(name) {
  return `${location.origin}/download/${encodeURIComponent(name)}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 2)} ${units[i]}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // احتياطي للروابط http غير الآمنة
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  toast('تم نسخ الرابط');
}

function renderStats() {
  $('statCount').textContent = files.length;
  $('statSize').textContent = fmtSize(files.reduce((s, f) => s + f.size, 0));
}

function renderFilters() {
  const box = $('filters');
  box.innerHTML = '';
  FILTERS.forEach((f) => {
    const count = f.key === 'all' ? files.length : files.filter((x) => x.type === f.key).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (activeFilter === f.key ? ' active' : '');
    b.innerHTML = `${f.label} <span class="count">${count}</span>`;
    b.onclick = () => {
      activeFilter = f.key;
      renderFilters();
      renderTable();
    };
    box.appendChild(b);
  });
}

function renderTable() {
  const q = $('search').value.trim().toLowerCase();
  const list = files.filter(
    (f) => (activeFilter === 'all' || f.type === activeFilter) && f.name.toLowerCase().includes(q)
  );

  const tbody = $('tbody');
  tbody.innerHTML = '';

  const empty = $('empty');
  if (list.length === 0) {
    empty.textContent = files.length === 0
      ? 'لا توجد ملفات في مجلد apk. ضع ملفاتك هناك وستظهر هنا تلقائياً.'
      : 'لا توجد نتائج مطابقة.';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  list.forEach((f, i) => {
    const link = linkFor(f.name);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><div class="name-cell"><span class="badge"></span><span class="fname"></span></div></td>
      <td class="date"></td>
      <td class="size"></td>
      <td><div class="link-cell"><a class="link"></a><button class="btn small" data-act="copy">نسخ</button></div></td>
      <td><button class="btn small danger" data-act="del">حذف</button></td>`;

    const badge = tr.querySelector('.badge');
    badge.textContent = BADGE[f.type];
    badge.classList.add('t-' + f.type);
    tr.querySelector('.fname').textContent = f.name;
    tr.querySelector('.fname').title = f.name;
    tr.querySelector('.date').textContent = fmtDate(f.date);
    tr.querySelector('.size').textContent = fmtSize(f.size);

    const a = tr.querySelector('a.link');
    a.href = `/download/${encodeURIComponent(f.name)}`;
    a.setAttribute('download', f.name);
    a.textContent = link;
    a.title = link;

    tr.querySelector('[data-act="copy"]').onclick = () => copyText(link);
    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`سيتم حذف الملف نهائياً من مجلد apk:\n${f.name}\n\nهل تريد المتابعة؟`)) return;
      const res = await fetch(`/api/files/${encodeURIComponent(f.name)}`, { method: 'DELETE' });
      toast(res.ok ? 'تم حذف الملف' : 'تعذر حذف الملف');
      load();
    };
    tbody.appendChild(tr);
  });
}

async function load() {
  try {
    const res = await fetch('/api/files', { cache: 'no-store' });
    files = await res.json();
  } catch (e) {
    return toast('تعذر الاتصال بالسيرفر');
  }
  renderStats();
  renderFilters();
  renderTable();
}

$('search').oninput = renderTable;
$('refreshBtn').onclick = () => {
  load();
  toast('تم التحديث');
};

load();
// تحديث تلقائي لاكتشاف الملفات الجديدة
setInterval(load, 15000);
