const $ = (id) => document.getElementById(id);

let editingId = null;
let apps = [];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function linkFor(id) {
  return `${location.origin}/download/${id}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

function currentSource() {
  return document.querySelector('input[name="source"]:checked').value;
}

function setSource(value) {
  document.querySelector(`input[name="source"][value="${value}"]`).checked = true;
  $('fileBox').classList.toggle('hidden', value !== 'file');
  $('urlBox').classList.toggle('hidden', value !== 'url');
}

document.querySelectorAll('input[name="source"]').forEach((r) => {
  r.onchange = () => setSource(currentSource());
});

async function loadFiles(selected) {
  const res = await fetch('/api/apk-files');
  const files = await res.json();
  const sel = $('apkSelect');
  sel.innerHTML = '';
  files.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.name;
    o.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`;
    sel.appendChild(o);
  });
  if (selected && files.some((f) => f.name === selected)) sel.value = selected;
  $('noFiles').classList.toggle('hidden', files.length > 0);
}

async function loadApps() {
  const res = await fetch('/api/apps');
  apps = await res.json();
  const tbody = $('tbody');
  tbody.innerHTML = '';
  $('empty').classList.toggle('hidden', apps.length > 0);

  apps.forEach((a, i) => {
    const link = linkFor(a.id);
    const isUrl = a.source === 'url';
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td></td>
      <td class="fname"></td>
      <td><div class="link-cell"><span></span><button class="btn small" data-act="copy">نسخ</button></div></td>
      <td class="date"></td>
      <td><div class="actions">
        <a class="btn small primary" data-act="dl">تحميل</a>
        <button class="btn small" data-act="edit">تعديل</button>
        <button class="btn small danger" data-act="del">حذف</button>
      </div></td>`;

    tr.children[1].textContent = a.name;
    const src = tr.children[2];
    src.textContent = (isUrl ? '🔗 ' : '📁 ') + (isUrl ? a.url : a.file);
    src.title = isUrl ? a.url : a.file;
    tr.querySelector('.link-cell span').textContent = link;
    tr.querySelector('.link-cell span').title = link;
    tr.querySelector('.date').textContent = fmtDate(a.updatedAt || a.createdAt);

    const dl = tr.querySelector('[data-act="dl"]');
    dl.href = `/download/${a.id}`;
    dl.setAttribute('download', '');

    tr.querySelector('[data-act="copy"]').onclick = () => copyText(link);
    tr.querySelector('[data-act="edit"]').onclick = () => openForm(a);
    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`حذف "${a.name}"؟`)) return;
      await fetch(`/api/apps/${a.id}`, { method: 'DELETE' });
      toast('تم الحذف');
      loadApps();
    };
    tbody.appendChild(tr);
  });
}

async function openForm(app) {
  editingId = app ? app.id : null;
  $('formTitle').textContent = app ? 'تعديل التطبيق' : 'تطبيق جديد';
  $('appName').value = app ? app.name : '';
  $('appUrl').value = app && app.source === 'url' ? app.url : '';
  $('resultBox').classList.add('hidden');
  await loadFiles(app && app.file);
  setSource(app && app.source === 'url' ? 'url' : 'file');
  $('formBox').classList.remove('hidden');
  $('appName').focus();
}

function closeForm() {
  $('formBox').classList.add('hidden');
  editingId = null;
}

$('addBtn').onclick = () => openForm(null);
$('cancelBtn').onclick = closeForm;
$('refreshFiles').onclick = () => loadFiles($('apkSelect').value);

$('appForm').onsubmit = async (e) => {
  e.preventDefault();
  const source = currentSource();
  const body = { name: $('appName').value.trim(), source };
  if (source === 'url') {
    body.url = $('appUrl').value.trim();
    if (!body.url) return toast('اكتب رابط الملف');
  } else {
    body.file = $('apkSelect').value;
    if (!body.file) return toast('اختر ملف APK');
  }
  if (!body.name) return toast('اكتب اسم التطبيق');

  const url = editingId ? `/api/apps/${editingId}` : '/api/apps';
  const res = await fetch(url, {
    method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || 'حدث خطأ');

  closeForm();
  $('resultLink').value = linkFor(data.id);
  $('resultBox').classList.remove('hidden');
  await loadApps();
};

$('copyResult').onclick = () => copyText($('resultLink').value);

loadApps();
