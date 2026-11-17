/* extras.js - add-on for Atulya's Chat. Load AFTER script.js.
   1) admin username hidden (only "✦ Admin" shown)
   2) 👥 button: who's online (admin on top + count)
   3) admin-only ⋮ menu on every message: Block 1 hour / Unblock / Delete
   4) blocked user can't send for 1 hour (needs blocks.sql run once in Supabase) */
(() => {
"use strict";

const ADMINS = ["adminraj", "atulya"]; // admin usernames (lowercase)
const BLOCK_MS = 60 * 60 * 1000;       // block length = 1 hour
const KEY = "chat_user_name";
const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

const $ = (id) => document.getElementById(id);
const ui = { app: $("app"), list: $("list"), typeText: $("typeText"), skel: $("skel"), modal: $("nameModal"), form: $("nameForm"),
  nameIn: $("nameIn"), menu: $("menu"), menuBtn: $("menuBtn"), hdr: document.querySelector(".hdr"), input: $("input"),
  send: $("send"), emojiBtn: $("emojiBtn"), field: document.querySelector(".field"), toasts: $("toasts") };
if (!ui.list || !ui.hdr || !ui.menuBtn) return;

let typedName = "", me = "", isAdmin = false, started = false;
let c2 = null, ch = null, bch = null, retryT = null, tries = 0, btn, badge, panel, menuEl = null, menuFor = null, unT = null, wasBlocked = false;
const blocks = new Map(); // user_key -> blocked_until (ms)
const SECURE = typeof ADMIN_MODE !== "undefined" && ADMIN_MODE === "secure";
const clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();

/* ---------- helpers ---------- */
function mk(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
const pad = (n) => String(n).padStart(2, "0");
function hhmm(t) { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function nameColor(n) { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return "hsl(" + (h % 360) + " 85% 72%)"; }
function readName() {
  try { const v = sessionStorage.getItem(KEY); if (v) return v; } catch (e) { /* blocked */ }
  return typedName;
}
const viewerIsAdmin = () => ADMINS.indexOf(readName().trim().toLowerCase()) > -1;
function toast(msg, type) {
  const box = ui.toasts; if (!box) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const t = mk("div", "toast glass " + (type || "info"), msg);
  t.addEventListener("animationend", (e) => { if (e.animationName === "tout") t.remove(); });
  box.append(t); setTimeout(() => t.remove(), 4800);
}
ui.form.addEventListener("submit", () => { typedName = ui.nameIn.value.trim(); });

/* ---------- 1) hide admin name, add badge, add ⋮ for admin ---------- */
function process() {
  const adminView = viewerIsAdmin();
  ui.list.querySelectorAll(".msg:not([data-x])").forEach((m) => {
    m.dataset.x = "1";
    const s = m.querySelector(".name > span:first-child");
    let u = "";
    if (s) u = s.textContent.trim();
    else { let p = m.previousElementSibling; while (p && !p.classList.contains("msg")) p = p.previousElementSibling; u = p ? (p.dataset.u || "") : ""; }
    m.dataset.u = u;
    const hasBadge = !!(s && s.nextElementSibling && s.nextElementSibling.classList.contains("badge"));
    if (s && (hasBadge || ADMINS.indexOf(u.toLowerCase()) > -1)) {
      s.classList.add("x-hide");
      if (!hasBadge) s.after(mk("span", "badge", "✦ Admin"));
    }
    if (adminView) {
      const line = m.querySelector(".line");
      if (line && !line.querySelector(".ax-btn")) {
        const b = mk("button", "ax-btn", "⋮"); b.type = "button";
        b.setAttribute("aria-label", "Message options"); b.setAttribute("aria-haspopup", "menu");
        line.append(b);
      }
    }
  });
}
new MutationObserver(process).observe(ui.list, { childList: true, subtree: true });
process();

const adminPat = ADMINS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const adminTest = new RegExp(adminPat, "i"), adminAll = new RegExp(adminPat, "gi");
new MutationObserver(() => {
  const t = ui.typeText.textContent;
  if (adminTest.test(t)) ui.typeText.textContent = t.replace(adminAll, "Admin");
}).observe(ui.typeText, { childList: true, characterData: true, subtree: true });

/* ---------- needs Supabase from here ---------- */
const configured = typeof SUPABASE_URL === "string" && /^https?:\/\//.test(SUPABASE_URL) &&
  typeof SUPABASE_KEY === "string" && !/YOUR_/.test(SUPABASE_URL + SUPABASE_KEY) && window.supabase;
if (!configured) return;

function client() {
  if (!c2) c2 = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: SECURE, autoRefreshToken: false, detectSessionInUrl: false } });
  return c2;
}
function blockErr(e) {
  const m = String((e && e.message) || "") + String((e && e.code) || "");
  return /chat_blocks|relation|schema cache|42P01|PGRST/i.test(m) ? "Run blocks.sql in Supabase first" : "Action failed. Try again.";
}

/* ---------- 3) admin menu: block / unblock / delete ---------- */
async function deleteMsg(msg) {
  const id = msg.dataset.id;
  msg.classList.add("leaving"); // instant feedback
  try {
    const { data, error } = await client().from("chat_messages").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("not permitted");
    setTimeout(() => { const m = ui.list.querySelector('.msg[data-id="' + id + '"]'); if (m) m.remove(); }, 1500);
  } catch (e) { console.error("delete", e); msg.classList.remove("leaving"); toast("Couldn't delete message", "error"); }
}
async function blockUser(name) {
  const key = name.toLowerCase(), until = Date.now() + BLOCK_MS;
  try {
    const { error } = await client().from("chat_blocks").upsert({ user_key: key, blocked_until: new Date(until).toISOString() });
    if (error) throw error;
    blocks.set(key, until); toast("Blocked " + name + " for 1 hour", "success");
  } catch (e) { console.error("block", e); toast(blockErr(e), "error"); }
}
async function unblockUser(name) {
  const key = name.toLowerCase();
  try {
    const { error } = await client().from("chat_blocks").delete().eq("user_key", key);
    if (error) throw error;
    blocks.delete(key); toast("Unblocked " + name, "success");
  } catch (e) { console.error("unblock", e); toast(blockErr(e), "error"); }
}
function closeMenu() { if (menuEl) menuEl.hidden = true; menuFor = null; }
function openMenu(msg, anchor) {
  if (menuEl && !menuEl.hidden && menuFor === msg) { closeMenu(); return; }
  const u = msg.dataset.u || "", targetAdmin = ADMINS.indexOf(u.toLowerCase()) > -1;
  if (!menuEl) { menuEl = mk("div", "ax-menu glass dark"); menuEl.hidden = true; menuEl.setAttribute("role", "menu"); document.body.append(menuEl); }
  menuFor = msg; clear(menuEl);
  menuEl.append(mk("h4", null, targetAdmin ? "✦ Admin" : u));
  if (!targetAdmin && u) {
    const blocked = (blocks.get(u.toLowerCase()) || 0) > Date.now();
    const b = mk("button", blocked ? "ax-ok" : "ax-warn", blocked ? "✅ Unblock" : "🚫 Block for 1 hour");
    b.type = "button";
    b.addEventListener("click", () => { closeMenu(); if (blocked) unblockUser(u); else blockUser(u); });
    menuEl.append(b);
  }
  const d = mk("button", "ax-danger", "🗑️ Delete message"); d.type = "button";
  let armed = false, t = null;
  d.addEventListener("click", () => {
    if (!armed) { armed = true; d.textContent = "⚠️ Tap again to delete"; t = setTimeout(() => { armed = false; d.textContent = "🗑️ Delete message"; }, 3000); return; }
    clearTimeout(t); closeMenu(); deleteMsg(msg);
  });
  menuEl.append(d);
  menuEl.hidden = false;
  const r = anchor.getBoundingClientRect(), w = menuEl.offsetWidth || 210, h = menuEl.offsetHeight;
  let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8), top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  menuEl.style.left = left + "px"; menuEl.style.top = top + "px";
}
ui.list.addEventListener("click", (e) => {
  const b = e.target.closest(".ax-btn");
  if (!b || !viewerIsAdmin()) return;
  openMenu(b.closest(".msg"), b);
});
document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest(".ax-btn")) closeMenu(); }, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("resize", closeMenu);
const scroller = $("messages"); if (scroller) scroller.addEventListener("scroll", closeMenu, { passive: true });

/* ---------- 4) blocked user: lock the input ---------- */
function applyMyBlock() {
  clearTimeout(unT);
  const until = blocks.get(me.toLowerCase()) || 0, active = !isAdmin && until > Date.now();
  if (active) {
    if (!wasBlocked) { wasBlocked = true; toast("Admin blocked you until " + hhmm(until), "error"); }
    if (ui.input.value) { ui.input.value = ""; ui.input.dispatchEvent(new Event("input")); }
    ui.input.disabled = true; ui.input.placeholder = "🚫 Blocked until " + hhmm(until);
    ui.send.disabled = true; if (ui.emojiBtn) ui.emojiBtn.disabled = true; if (ui.field) ui.field.classList.add("is-blocked");
    unT = setTimeout(applyMyBlock, Math.max(1000, until - Date.now() + 500));
  } else {
    if (wasBlocked) { wasBlocked = false; toast("You can chat again ✅", "success"); }
    ui.input.disabled = false; ui.input.placeholder = "Message";
    if (ui.emojiBtn) ui.emojiBtn.disabled = false; if (ui.field) ui.field.classList.remove("is-blocked");
  }
}
async function loadBlocks() {
  try {
    const { data, error } = await client().from("chat_blocks").select("user_key,blocked_until").gt("blocked_until", new Date().toISOString());
    if (error) throw error;
    blocks.clear(); data.forEach((r) => blocks.set(r.user_key, Date.parse(r.blocked_until)));
    applyMyBlock();
  } catch (e) { console.warn("blocks unavailable (run blocks.sql once in Supabase)", e); }
}
function watchBlocks() {
  try {
    if (bch) return;
    bch = client().channel("blocks-watch");
    bch.on("postgres_changes", { event: "*", schema: "public", table: "chat_blocks" }, (p) => {
      const row = (p.eventType === "DELETE" ? p.old : p.new) || {};
      if (!row.user_key) return;
      if (p.eventType === "DELETE") blocks.delete(row.user_key); else blocks.set(row.user_key, Date.parse(row.blocked_until));
      if (row.user_key === me.toLowerCase()) applyMyBlock();
    });
    bch.subscribe();
  } catch (e) { console.error("watch blocks", e); }
}

/* ---------- 2) who's online ---------- */
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
    if (ch) { const old = ch; ch = null; Promise.resolve(client().removeChannel(old)).catch(() => {}); }
    const c = client().channel("online-users", { config: { presence: { key: clientId } } });
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
  buildUI(); connect(); loadBlocks(); watchBlocks(); process();
  window.addEventListener("online", connect);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    loadBlocks();
    if (!ch || ch.state !== "joined") connect();
  });
}
[ui.app, ui.modal, ui.skel].forEach((n) => { if (n) new MutationObserver(tryStart).observe(n, { attributes: true, attributeFilter: ["hidden"] }); });
tryStart();
})();
