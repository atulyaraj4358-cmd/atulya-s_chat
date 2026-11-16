'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TABS = ['All','APK','PDF','ZIP']; 
const THEMES = {aurora:'🌌',sunset:'🌅',ocean:'🌊',candy:'🍬',neon:'🌃',forest:'🌲'};
let S = {version:0, files:[], apps:[]}, tab = 'All', q = '', hidden = new Set(), fresh = {}, known = null, fails = 0, loaded = false;
let tok = sessionStorage.getItem('av_tok'), user = localStorage.getItem('av_user') || '';

/* ---------- toasts & confetti ---------- */
function toast(kind, msg, action) {
  const t = document.createElement('div'); t.className = 'toast glass ' + kind;
  const s = document.createElement('span'); s.textContent = ({success:'✅ ',error:'⚠️ ',info:'ℹ️ '}[kind] || '') + msg; t.append(s);
  if (action) { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = action.label; b.onclick = () => { action.fn(); t.remove(); }; t.append(b); }
  t.append(document.createElement('i')); $('#toasts').append(t);
  let x0 = null; t.onpointerdown = e => x0 = e.clientX; t.onpointerup = e => { if (x0 !== null && e.clientX - x0 > 60) t.remove(); };
  setTimeout(() => t.remove(), action ? 6500 : 4000);
}
function confetti() {
  for (let i = 0; i < 36; i++) { const e = document.createElement('span'); e.className = 'cf'; e.textContent = '🎉✨🎊💎🔒'[i % 5 * 2 % 5] || '🎉';
    e.style.left = Math.random() * 100 + 'vw'; e.style.setProperty('--x', (Math.random() * 200 - 100) + 'px'); e.style.animationDelay = Math.random() * .5 + 's';
    document.body.append(e); setTimeout(() => e.remove(), 3000); }
}

/* ---------- SUPABASE DATABASE ---------- */
const SUPABASE_URL = "https://jgpkjkwhfexkjvyzpqar.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_q6z3S8fROzE3nlyFIeUH4A_Dtg6xkCd"; 

const { createClient } = supabase;
const dbClient = createClient(SUPABASE_URL, SUPABASE_KEY);

async function api(action, body) {
    try {
        if (action === 'list' || action === 'version') {
            const { data, error } = await dbClient.from('vault_files').select('*').order('date', { ascending: false });
            if (error) throw error;
            return { version: Date.now(), files: data || [], apps: [], scores: {}, deleted: [] };
        }
        if (action === 'login') {
            if (body.user === 'adminraj' && body.pass === 'admin') return { token: 'admin-token' };
            throw new Error('Wrong credentials');
        }
        if (action === 'add') {
            const newItem = { title: body.title, desc: body.desc, type: body.type, size: body.size, link: body.link, icon: body.icon };
            const { data, error } = await dbClient.from('vault_files').insert([newItem]).select();
            if (error) throw error;
            return { item: data[0] };
        }
        if (action === 'delete') {
            const { error } = await dbClient.from('vault_files').delete().eq('id', body.id);
            if (error) throw error;
            return { ok: true };
        }
        return { version: Date.now(), files: [], apps: [] };
    } catch (e) {
        console.error("Supabase Error:", e);
        if (typeof toast === 'function') toast('error', 'Database Error: ' + e.message);
        throw e;
    }
}

function initRealtime() {
    dbClient.channel('custom-all-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'vault_files' }, payload => { load(); }).subscribe();
}
function setDot(s) { $('#dot').className = 'dot ' + s; $('#pill').hidden = s !== 'off'; }

async function load() {
  setDot('sync');
  try {
    const d = await api('list'); fails = 0; setDot('');
    const all = [...d.files, ...d.apps];
    if (known) all.filter(x => !known.has(x.id) && x.addedBy !== '__me').forEach(x => {
      fresh[x.id] = Date.now() + 60000;
      toast('info', '🆕 New file added: ' + x.title, {label:'View', fn:() => { $('#search').value = ''; q = ''; tab = 'All'; render(); document.querySelector('[data-id="' + x.id + '"]')?.scrollIntoView({behavior:'smooth', block:'center'}); }});
    });
    known = new Set(all.map(x => x.id)); S = d; render();
  } catch (e) { fails++; setDot('off'); }
}
['focus', 'online'].forEach(e => addEventListener(e, load)); document.addEventListener('visibilitychange', () => !document.hidden && load());

/* ---------- render ---------- */
function items() {
  const all = [...S.files.map(x => ({...x, kind:'files'})), ...S.apps.map(x => ({...x, kind:'apps'}))].filter(x => !hidden.has(x.id));
  const f = all.filter(x => tab === 'All' || (tab === 'Apps' ? x.kind === 'apps' || x.type === 'APP' : tab === 'Games' ? x.type === 'GAME' : x.type === tab));
  if (!q) return f;
  const k = q.toLowerCase(); return f.filter(x => [x.title, x.desc, x.type, ...(x.tags || [])].join(' ').toLowerCase().includes(k));
}
function hl(s) { const e = esc(s); if (!q) return e; return e.replace(new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); }

function render() {
  const list = items(), g = $('#grid'), old = {};
  g.querySelectorAll('.card').forEach(c => old[c.dataset.id] = c.getBoundingClientRect());
  g.innerHTML = list.length ? list.map((x, i) => {
    const fakeDls = x.id ? (parseInt(x.id.slice(0, 4), 16) % 900) + 100 : 150;
    const fakeViews = fakeDls + Math.floor(Math.random() * 500) + 200;
    return `<article class="card glass" data-id="${esc(x.id)}" data-kind="${x.kind}" style="--i:${loaded ? 0 : i}">
    ${fresh[x.id] > Date.now() ? '<span class="new">NEW</span>' : ''}<span class="ic">${esc(x.icon)}</span>
    <h3>${hl(x.title)}</h3><p>${hl(x.desc)}</p>
    <div class="meta">${esc(x.type)} · ${esc(x.size || '—')} · ${esc((x.date || '').slice(0, 10))} · 👀 ${fakeViews} views · ⬇️ ${fakeDls} downloads · 🛡️ Safe</div>
    <div class="row"><button class="btn" data-a="dl">⬇️</button><button class="btn ghost" data-a="view">👁️</button><button class="btn ghost" data-a="share">🔗</button>${tok ? '<button class="btn ghost" data-a="del">🗑️</button>' : ''}</div></article>`;
  }).join('') : '<div class="empty">🔍 Nothing here yet. Try another search or tab.</div>';

  g.querySelectorAll('.card').forEach(c => { const o = old[c.dataset.id]; if (!o) return; const n = c.getBoundingClientRect();
    c.style.animation = 'none'; c.animate([{transform:`translate(${o.left - n.left}px,${o.top - n.top}px)`}, {transform:'none'}], {duration:450, easing:'cubic-bezier(.2,1.4,.3,1)'}); });
  loaded = true;

  let totalFakeDownloads = 0;
  list.forEach(x => { totalFakeDownloads += x.id ? (parseInt(x.id.slice(0, 4), 16) % 500) + 100 : 150; });
  const heroEl = document.getElementById('stats');
  if(heroEl) { heroEl.innerHTML = '📄 <b>' + S.files.length + '</b> files · ⬇️ <b>' + totalFakeDownloads + '</b> downloads'; }
}
function byId(id) { return items().find(x => x.id === id) || [...S.files, ...S.apps].find(x => x.id === id); }

/* ---------- modal ---------- */
let lastFocus;
function modal(html) {
  lastFocus = document.activeElement; const m = $('#modal'); m.innerHTML = `<div class="sheet glass" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false;
  (m.querySelector('input,textarea,button') || m).focus();
}
function closeModal() { $('#modal').hidden = true; lastFocus?.focus(); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.dataset.close !== undefined) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- card actions ---------- */
$('#grid').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return; const c = b.closest('.card'), id = c.dataset.id, x = byId(id); if (!x) return;
  if (b.dataset.a === 'dl') { 
    let downloadLink = x.link;
    if (downloadLink.includes('drive.google.com/file/d/')) {
        const fileId = downloadLink.split('/d/')[1].split('/')[0];
        downloadLink = `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    const a = document.createElement('a'); a.href = downloadLink; a.download = x.title || 'file'; a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('success', 'Download started'); confetti(); 
  }
  if (b.dataset.a === 'share') { try { await navigator.clipboard.writeText(x.link); } catch { const t = document.createElement('textarea'); t.value = x.link; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); } toast('success', 'Link copied 🔗'); }
  if (b.dataset.a === 'view') modal(`<h2>${esc(x.icon)} ${esc(x.title)}</h2><p>${esc(x.desc)}</p><p>${esc(x.type)} · ${esc(x.size)}</p><p>${(x.tags || []).map(t => '#' + esc(t)).join(' ')}</p><button class="btn" data-close>Close</button>`);
  if (b.dataset.a === 'del') {
    hidden.add(id); c.classList.add('out'); let undone = false;
    toast('info', 'Deleted “' + x.title + '”', {label:'Undo', fn:() => { undone = true; hidden.delete(id); render(); }});
    setTimeout(async () => { if (undone) return; try { await api('delete', {id}); } catch (er) { hidden.delete(id); toast('error', er.message); } load(); }, 6500);
  }
});

/* ---------- login ---------- */
function paintUser() { $('#who').textContent = user ? (tok ? '👑 ' : '👤 ') + user : ''; $('#loginBtn').textContent = user ? 'Log out' : 'Log in'; $('#admin').hidden = !tok; render(); }
$('#loginBtn').onclick = () => {
  if (user) { user = ''; tok = null; localStorage.removeItem('av_user'); sessionStorage.removeItem('av_tok'); paintUser(); return toast('info', 'Logged out'); }
  modal(`<h2>🔒 Log in</h2><div class="f"><input id="lu" placeholder="Username" autocomplete="username"><input id="lp" type="password" placeholder="Password" autocomplete="current-password"><button class="btn" id="lgo">Log in</button></div>`);
  $('#lgo').onclick = async () => {
    const u = $('#lu').value.trim(), p = $('#lp').value; if (!u || !p) return toast('error', 'Enter username and password');
    if (u === 'adminraj') { try { const r = await api('login', {user:u, pass:p}); tok = r.token; sessionStorage.setItem('av_tok', tok); } catch (e) { return toast('error', e.status === 403 ? 'Wrong admin credentials' : 'Login failed'); } }
    user = u; localStorage.setItem('av_user', u); closeModal(); paintUser(); toast('success', 'Welcome, ' + u + '!' + (tok ? ' 👑' : ''));
  };
};

/* ---------- admin add ---------- */
function addForm(app) {
  modal(`<h2>${app ? '📱 Add App' : '➕ Add File'}</h2><div class="f"><input id="t" placeholder="Title" maxlength="80"><textarea id="d" placeholder="Description" maxlength="300"></textarea>
  <select id="ty"><option value="APK">APK</option><option value="PDF">PDF</option><option value="ZIP">ZIP</option></select>
  <input id="sz" placeholder="Size (e.g. 24 MB)"><input id="ln" type="url" placeholder="https://download-link"><input id="ic" placeholder="Emoji icon (optional)" maxlength="4"><input id="tg" placeholder="Tags, comma separated"><button class="btn" id="pub">Publish</button></div>`);
  $('#pub').onclick = async () => {
    const b = {kind:app ? 'apps' : 'files', title:$('#t').value, desc:$('#d').value, type:$('#ty').value, size:$('#sz').value, link:$('#ln').value, icon:$('#ic').value, tags:$('#tg').value.split(',').map(s => s.trim()).filter(Boolean)};
    if (!b.title.trim()) return toast('error', 'Please add a title');
    if (!/^https?:\/\//i.test(b.link)) return toast('error', 'Link must start with http:// or https://');
    if (!confirm('Publish “' + b.title + '” for everyone?')) return;
    try { const r = await api('add', b); known?.add(r.item.id); closeModal(); confetti(); toast('success', 'Published!'); load(); } catch (e) { toast('error', e.status === 403 ? 'Session expired. Log in again.' : e.message); }
  };
}
$('#addBtn').onclick = () => addForm(false); $('#addApp').onclick = () => addForm(true);

/* ---------- UI setup ---------- */
$('#tabs').innerHTML = TABS.map(t => `<button role="tab" aria-selected="${t === 'All'}">${t}</button>`).join('');
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; tab = b.textContent; $('#tabs').querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', x === b)); render(); };
$('#search').oninput = e => { q = e.target.value.trim(); render(); };
$('#themes').innerHTML = Object.entries(THEMES).map(([k, v]) => `<button data-t="${k}" title="${k}" aria-label="${k} theme" style="background:var(--a)">${''}</button>`).join('');
const PAL = {aurora:'#7c5cff,#00d4ff', sunset:'#ff5e62,#ff9966', ocean:'#0072ff,#00c6ff', candy:'#ff6ec4,#7873f5', neon:'#b026ff,#00ffa3', forest:'#11998e,#38ef7d'};
$('#themes').querySelectorAll('button').forEach(b => b.style.background = `linear-gradient(135deg,${PAL[b.dataset.t]})`);
function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('av_theme', t); $('#themes').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === t)); }
$('#themes').onclick = e => { const b = e.target.closest('button'); if (b) setTheme(b.dataset.t); };
setTheme(localStorage.getItem('av_theme') in THEMES ? localStorage.getItem('av_theme') : 'aurora');

const premiumTitles = ["Your Personal Vault.", "Premium Files.", "Unlock the Best.", "Atulya's Vault."];
let titleIdx = 0;
function changePremiumTitle() {
  $('#title').innerHTML = [...premiumTitles[titleIdx]].map((c, i) => c === ' ' ? ' ' : `<span style="animation-delay:${i * 45}ms">${esc(c)}</span>`).join('');
  titleIdx = (titleIdx + 1) % premiumTitles.length;
}
changePremiumTitle();
setInterval(changePremiumTitle, 4000);

const words = ['APK','PDF','ZIP','FILE']; let wi = 0;
setInterval(() => { const w = $('#word'); w.classList.add('out'); setTimeout(() => { wi = (wi + 1) % 4; w.textContent = words[wi]; w.classList.remove('out'); }, 400); }, 2200);
addEventListener('scroll', () => { const h = document.documentElement; $('#prog').style.transform = `scaleX(${scrollY / Math.max(1, h.scrollHeight - innerHeight)})`; document.querySelector('nav').style.backdropFilter = `blur(${24 + Math.min(scrollY / 20, 16)}px) saturate(180%)`; }, {passive:true});
let taps = 0, tt; $('#logo').onclick = () => { taps++; clearTimeout(tt); tt = setTimeout(() => taps = 0, 1500); if (taps >= 5) { taps = 0; confetti(); confetti(); } };
paintUser(); load().then(() => initRealtime());
