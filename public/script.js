const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

/* ================= الترجمة (العربية هي الأساس) ================= */
const I18N = {
  ar: {
    pageTitle: 'مدير روابط التطبيقات',
    title: 'مدير روابط التطبيقات',
    refresh: 'تحديث',
    statCount: 'عدد التطبيقات',
    statSize: 'الحجم الكلي',
    search: 'ابحث باسم التطبيق...',
    f_all: 'الكل', f_apk: 'APK', f_aab: 'AAB', f_zip: 'ZIP', f_html: 'HTML', f_desktop: 'سطح المكتب', f_other: 'أخرى',
    th_name: 'اسم التطبيق الأصلي',
    th_date: 'تاريخ ووقت النشر',
    th_size: 'الحجم',
    th_link: 'الرابط',
    th_del: 'حذف',
    copy: 'نسخ',
    copied: '✓ تم',
    del: 'حذف',
    badgeOther: 'ملف',
    toastCopied: 'تم نسخ الرابط',
    toastRefreshed: 'تم التحديث',
    toastDeleted: 'تم حذف الملف',
    toastDelFail: 'تعذر حذف الملف',
    toastConn: 'تعذر الاتصال بالسيرفر',
    emptyNone: 'لا توجد ملفات في مجلد apk. ضع ملفاتك هناك وستظهر هنا تلقائياً.',
    emptyNoMatch: 'لا توجد نتائج مطابقة.',
    confirmDelete: (n) => `سيتم حذف الملف نهائياً من مجلد apk:\n${n}\n\nهل تريد المتابعة؟`,
    themeToLight: 'الوضع الفاتح',
    themeToDark: 'الوضع الداكن',
    langTitle: 'English',
    langLabel: 'EN',
  },
  en: {
    pageTitle: 'Apps Link Manager',
    title: 'Apps Link Manager',
    refresh: 'Refresh',
    statCount: 'Total apps',
    statSize: 'Total size',
    search: 'Search by app name...',
    f_all: 'All', f_apk: 'APK', f_aab: 'AAB', f_zip: 'ZIP', f_html: 'HTML', f_desktop: 'Desktop', f_other: 'Other',
    th_name: 'Original app name',
    th_date: 'Published date & time',
    th_size: 'Size',
    th_link: 'Link',
    th_del: 'Delete',
    copy: 'Copy',
    copied: '✓ Done',
    del: 'Delete',
    badgeOther: 'File',
    toastCopied: 'Link copied',
    toastRefreshed: 'Refreshed',
    toastDeleted: 'File deleted',
    toastDelFail: 'Could not delete the file',
    toastConn: 'Could not reach the server',
    emptyNone: 'The apk folder is empty. Drop your files there and they will show up here automatically.',
    emptyNoMatch: 'No matching results.',
    confirmDelete: (n) => `This will permanently delete the file from the apk folder:\n${n}\n\nContinue?`,
    themeToLight: 'Light mode',
    themeToDark: 'Dark mode',
    langTitle: 'العربية',
    langLabel: 'عربي',
  },
};

const FILTER_KEYS = ['all', 'apk', 'aab', 'zip', 'html', 'desktop', 'other'];
const BADGE = { apk: 'APK', aab: 'AAB', zip: 'ZIP', html: 'HTML', desktop: 'Desktop' };

let lang = root.lang === 'en' ? 'en' : 'ar';
let files = [];
let seen = new Set();
let lastSig = null;
let loaded = false;
let activeFilter = 'all';

const t = (key, ...args) => {
  const v = I18N[lang][key];
  return typeof v === 'function' ? v(...args) : v;
};

/* ================= أدوات مساعدة ================= */
function toast(msg, type) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', type === 'error');
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1900);
}

const linkFor = (name) => `${location.origin}/download/${encodeURIComponent(name)}`;

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  toast(t('toastCopied'));
}

// عدّاد متحرك للأرقام
function animateNumber(el, to, fmt) {
  const from = el._v || 0;
  el._v = to;
  if (el._raf) cancelAnimationFrame(el._raf);
  if (reduced || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const dur = 750;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// تأثير الموجة عند الضغط
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .chip, .icon-btn');
  if (!el || reduced) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  el.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
});

/* ================= الثيم واللغة ================= */
function updateThemeButton() {
  const dark = root.dataset.theme === 'dark';
  $('themeBtn').title = dark ? t('themeToLight') : t('themeToDark');
  $('themeBtn').setAttribute('aria-label', $('themeBtn').title);
}

function setTheme(theme) {
  root.classList.add('theme-anim');
  root.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch (e) {}
  updateThemeButton();
  setTimeout(() => root.classList.remove('theme-anim'), 500);
}

function applyLang(animate) {
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $('langLabel').textContent = t('langLabel');
  $('langBtn').title = t('langTitle');
  $('langBtn').setAttribute('aria-label', t('langTitle'));
  updateThemeButton();
  if (animate) {
    const c = document.querySelector('.container');
    c.classList.remove('lang-anim');
    void c.offsetWidth;
    c.classList.add('lang-anim');
  }
  if (loaded) {
    renderFilters();
    renderTable({ stagger: animate });
  }
}

function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); } catch (e) {}
  applyLang(true);
}

/* ================= العرض ================= */
function renderStats() {
  animateNumber($('statCount'), files.length, (n) => String(n));
  animateNumber($('statSize'), files.reduce((s, f) => s + f.size, 0), fmtSize);
}

function renderFilters() {
  const box = $('filters');
  box.innerHTML = '';
  FILTER_KEYS.forEach((key) => {
    const count = key === 'all' ? files.length : files.filter((x) => x.type === key).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.k = key;
    b.className = 'chip' + (activeFilter === key ? ' active' : '');
    b.innerHTML = `<span class="lbl"></span><span class="count">${count}</span>`;
    b.querySelector('.lbl').textContent = t('f_' + key);
    b.onclick = () => {
      activeFilter = key;
      renderFilters();
      renderTable({ stagger: true });
    };
    box.appendChild(b);
  });
}

function renderTable({ stagger = false, flash = new Set() } = {}) {
  const q = $('search').value.trim().toLowerCase();
  const list = files.filter(
    (f) => (activeFilter === 'all' || f.type === activeFilter) && f.name.toLowerCase().includes(q)
  );

  const tbody = $('tbody');
  tbody.innerHTML = '';
  tbody.classList.toggle('stagger', stagger);

  const empty = $('empty');
  if (list.length === 0) {
    $('emptyText').textContent = files.length === 0 ? t('emptyNone') : t('emptyNoMatch');
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  list.forEach((f, i) => {
    const link = linkFor(f.name);
    const tr = document.createElement('tr');
    tr.style.setProperty('--i', Math.min(i, 14));
    if (flash.has(f.name)) tr.classList.add('flash');

    tr.innerHTML = `
      <td class="idx">${i + 1}</td>
      <td><div class="name-cell"><span class="badge"></span><span class="fname"></span></div></td>
      <td><span class="num date"></span></td>
      <td><span class="num size"></span></td>
      <td><div class="link-cell"><a class="link"></a><button type="button" class="btn" data-act="copy"></button></div></td>
      <td><button type="button" class="btn danger" data-act="del"></button></td>`;

    const badge = tr.querySelector('.badge');
    badge.textContent = BADGE[f.type] || t('badgeOther');
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

    const copyBtn = tr.querySelector('[data-act="copy"]');
    copyBtn.textContent = t('copy');
    copyBtn.onclick = async () => {
      await copyText(link);
      copyBtn.classList.add('copied');
      copyBtn.textContent = t('copied');
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.textContent = t('copy');
      }, 1400);
    };

    const delBtn = tr.querySelector('[data-act="del"]');
    delBtn.textContent = t('del');
    delBtn.onclick = async () => {
      if (!confirm(t('confirmDelete', f.name))) return;
      tr.classList.add('removing');
      await wait(reduced ? 0 : 320);
      let ok = false;
      try {
        ok = (await fetch(`/api/files/${encodeURIComponent(f.name)}`, { method: 'DELETE' })).ok;
      } catch (e) {}
      toast(ok ? t('toastDeleted') : t('toastDelFail'), ok ? undefined : 'error');
      load(true);
    };

    tbody.appendChild(tr);
  });
}

async function load(force) {
  try {
    const res = await fetch('/api/files', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    files = await res.json();
  } catch (e) {
    return toast(t('toastConn'), 'error');
  }

  const sig = files.map((f) => `${f.name}|${f.size}|${f.date}`).join('\n');
  const first = !loaded;
  if (!first && sig === lastSig && !force) return;

  // الملفات الجديدة تُضيء لحظة ظهورها
  const flash = first ? new Set() : new Set(files.filter((f) => !seen.has(f.name)).map((f) => f.name));
  seen = new Set(files.map((f) => f.name));
  lastSig = sig;
  loaded = true;

  renderStats();
  renderFilters();
  renderTable({ stagger: first, flash });
}

/* ================= الأحداث ================= */
$('search').oninput = () => renderTable();

$('refreshBtn').onclick = () => {
  const b = $('refreshBtn');
  b.classList.remove('spinning');
  void b.offsetWidth;
  b.classList.add('spinning');
  load(true).then(() => toast(t('toastRefreshed')));
};

$('themeBtn').onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
$('langBtn').onclick = () => setLang(lang === 'ar' ? 'en' : 'ar');

applyLang(false);
load();
// تحديث تلقائي لاكتشاف الملفات الجديدة
setInterval(load, 15000);
