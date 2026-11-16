/* extras.js - add-on for Atulya's Chat. Load AFTER script.js.
   1) hides the admin's username in chat + typing text (shows only "✦ Admin")
   2) adds a "who's online" button with the list of names */
(() => {
"use strict";

const ADMINS = ["adminraj", "atulya"]; // admin username(s) to hide (lowercase)
const TITLE = null;       // optional: e.g. "Chat Room" to also replace the header title
const KEY = "chat_user_name";
const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

const $ = (id) => document.getElementById(id);
const ui = { app: $("app"), list: $("list"), typeText: $("typeText"), skel: $("skel"), modal: $("nameModal"),
  form: $("nameForm"), nameIn: $("nameIn"), menu: $("menu"), menuBtn: $("menuBtn"), hdr: document.querySelector(".hdr") };
if (!ui.list || !ui.hdr || !ui.menuBtn) return;

/* ---------- 1) hide admin username ---------- */
function maskNames() {
  ui.list.querySelectorAll(".name > span:first-child").forEach((s) => {
    const nx = s.nextElementSibling, hasBadge = !!(nx && nx.classList.contains("badge"));
    if (!s.classList.contains("x-hide") && (hasBadge || ADMINS.indexOf(s.textContent.trim().toLowerCase()) > -1)) s.classList.add("x-hide");
  });
}
new MutationObserver(maskNames).observe(ui.list, { childList: true, subtree: true });
maskNames();

const adminPat = ADMINS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const adminTest = new RegExp(adminPat, "i"), adminAll = new RegExp(adminPat, "gi");
new MutationObserver(() => {
  const t = ui.typeText.textContent;
  if (adminTest.test(t)) ui.typeText.textContent = t.replace(adminAll, "Admin");
}).observe(ui.typeText, { childList: true, characterData: true, subtree: true });

const h1 = document.querySelector(".ttl h1");
if (TITLE && h1) h1.textContent = TITLE;

/* ---------- 2) who's online ---------- */
const configured = typeof SUPABASE_URL === "string" && /^https?:\/\//.test(SUPABASE_URL) &&
  typeof SUPABASE_KEY === "string" && !/YOUR_/.test(SUPABASE_URL + SUPABASE_KEY) && window.supabase;
if (!configured) return;

const clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
let typedName = "", me = "", isAdmin = false, started = false, c2 = null, ch = null, retryT = null, tries = 0;
let btn, badge, panel;

ui.form.addEventListener("submit", () => { typedName = ui.nameIn.value.trim(); });

function readName() {
  try { const v = sessionStorage.getItem(KEY); if (v) return v; } catch (e) { /* blocked */ }
  return typedName;
}
function nameColor(n) { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return "hsl(" + (h % 360) + " 85% 72%)"; }
function mk(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

function buildUI() {
  btn = mk("button", "ibtn ol-btn", "👥");
  btn.type = "button"; btn.setAttribute("aria-label", "Who's online"); btn.setAttribute("aria-expanded", "false");
  badge = mk("span", "ol-badge", "0");
  btn.append(badge);
  ui.hdr.insertBefore(btn, ui.menuBtn);
  panel = mk("div", "ol-panel glass dark");
  panel.hidden = true; panel.setAttribute("role", "region"); panel.setAttribute("aria-label", "Online users");
  ui.hdr.append(panel);
  btn.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) { if (ui.menu) ui.menu.hidden = true; render(); }
  });
  document.addEventListener("pointerdown", (e) => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) closePanel(); }, { passive: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) closePanel(); });
}
function closePanel() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }

function render() {
  const state = ch ? ch.presenceState() : {};
  const keys = Object.keys(state);
  badge.textContent = keys.length > 99 ? "99+" : String(keys.length);
  if (panel.hidden) return;
  const map = new Map();
  keys.forEach((k) => {
    const m = state[k] && state[k][0];
    if (!m) return;
    const admin = m.admin === true, name = admin ? "Admin" : String(m.name || "").slice(0, 20);
    if (!admin && !NAME_RE.test(name)) return;
    const id = admin ? "\u0000admin" : name.toLowerCase();
    const e = map.get(id) || { name, admin, count: 0, you: false };
    e.count++; if (k === clientId) e.you = true;
    map.set(id, e);
  });
  const rows = [...map.values()].sort((a, b) => (b.admin - a.admin) || a.name.localeCompare(b.name));
  clear(panel);
  panel.append(mk("h3", null, "Online · " + keys.length));
  if (!rows.length) panel.append(mk("div", "ol-empty", "Connecting…"));
  rows.forEach((r) => {
    const row = mk("div", "ol-row"), nm = mk("span", null, r.admin ? "✦ Admin" : r.name);
    if (!r.admin) nm.style.color = nameColor(r.name);
    row.append(mk("i"), nm);
    const tag = r.you ? "You" : (r.count > 1 ? "×" + r.count : "");
    if (tag) row.append(mk("small", null, tag));
    panel.append(row);
  });
}

function connect() {
  clearTimeout(retryT); retryT = null;
  try {
    if (!c2) c2 = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    if (ch) { const old = ch; ch = null; Promise.resolve(c2.removeChannel(old)).catch(() => {}); }
    const c = c2.channel("online-users", { config: { presence: { key: clientId } } });
    ch = c;
    c.on("presence", { event: "sync" }, render);
    c.subscribe(async (s) => {
      if (c !== ch) return;
      if (s === "SUBSCRIBED") {
        tries = 0;
        try { await c.track({ name: isAdmin ? "Admin" : me, admin: isAdmin }); } catch (e) { console.error("presence track", e); }
        render();
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") retry();
    });
  } catch (e) { console.error("online list", e); retry(); }
}
function retry() {
  if (retryT) return;
  const d = Math.min(1000 * Math.pow(2, tries++), 30000);
  retryT = setTimeout(() => { retryT = null; connect(); }, d);
}

function tryStart() {
  if (started || ui.app.hidden || !ui.modal.hidden || !ui.skel.hidden) return; // wait until joined + history loaded
  const n = readName();
  if (!n || !NAME_RE.test(n)) return;
  started = true; me = n; isAdmin = ADMINS.indexOf(n.toLowerCase()) > -1;
  buildUI(); connect();
  window.addEventListener("online", connect);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (!ch || ch.state !== "joined")) connect(); });
}
[ui.app, ui.modal, ui.skel].forEach((n) => { if (n) new MutationObserver(tryStart).observe(n, { attributes: true, attributeFilter: ["hidden"] }); });
tryStart();
})();
