/* fun.js - add-on for Atulya's Chat. Load AFTER script.js and extras.js.
   1) tap a message: emoji reactions + reply   2) sound + (N) in tab title on new messages */
(() => {
"use strict";

const ADMINS = ["adminraj", "atulya"]; // same admin names as extras.js (lowercase)
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const KEY = "chat_user_name";
const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;
const QUOTE_RE = /^↪ ([^⟦\n]{1,20})⟦([^⟧\n]{0,40})⟧\n?([\s\S]*)$/;

const $ = (id) => document.getElementById(id);
const ui = { app: $("app"), list: $("list"), modal: $("nameModal"), skel: $("skel"), form: $("nameForm"), nameIn: $("nameIn"),
  input: $("input"), menu: $("menu"), toasts: $("toasts"), bar: document.querySelector(".bar"), field: document.querySelector(".field") };
if (!ui.list || !ui.input || !ui.bar || !ui.field) return;

let me = "", started = false, typedName = "", c3 = null, rch = null, reply = null, pending = "";
let pop = null, popFor = null, muted = false, ac = null, lastBeep = 0, unread = 0;
const baseTitle = document.title;
const reacts = new Map(); // message id -> Map(emoji -> Set(names))

/* ---------- helpers ---------- */
function mk(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function readName() { try { const v = sessionStorage.getItem(KEY); if (v) return v; } catch (e) { /* blocked */ } return typedName; }
ui.form.addEventListener("submit", () => { typedName = ui.nameIn.value.trim(); });
const label = (u) => (ADMINS.indexOf(u.toLowerCase()) > -1 ? "Admin" : u);
function toast(msg, type) {
  const box = ui.toasts; if (!box) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const t = mk("div", "toast glass " + (type || "info"), msg);
  t.addEventListener("animationend", (e) => { if (e.animationName === "tout") t.remove(); });
  box.append(t); setTimeout(() => t.remove(), 4800);
}
function linkify(text) {
  const frag = document.createDocumentFragment(), re = /https?:\/\/[^\s<>"'`]+/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    let url = m[0], trail = "";
    const t = url.match(/[.,;:!?)\]}]+$/);
    if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch (e) { /* invalid */ }
    frag.append(text.slice(last, m.index));
    if (ok) { const a = mk("a", null, url); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; frag.append(a); } else frag.append(url);
    frag.append(trail); last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}
function sender(m) {
  if (m.dataset.fxu !== undefined) return m.dataset.fxu;
  const s = m.querySelector(".name > span:first-child");
  let u = "";
  if (s) u = s.textContent.trim();
  else { let p = m.previousElementSibling; while (p && !p.classList.contains("msg")) p = p.previousElementSibling; u = p ? sender(p) : ""; }
  m.dataset.fxu = u;
  return u;
}

/* ---------- sound + title count ---------- */
try { muted = localStorage.getItem("chat_sound") === "off"; } catch (e) { /* blocked */ }
function audio() {
  if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (C) ac = new C(); }
  if (ac && ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, audio, { passive: true }));
function beep() {
  const now = Date.now();
  if (muted || now - lastBeep < 600) return;
  lastBeep = now;
  const a = audio();
  if (!a || a.state !== "running") return;
  const t = a.currentTime;
  [[880, 0], [1175, 0.09]].forEach((p) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.value = p[0];
    g.gain.setValueAtTime(0, t + p[1]);
    g.gain.linearRampToValueAtTime(0.07, t + p[1] + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p[1] + 0.18);
    o.connect(g); g.connect(a.destination); o.start(t + p[1]); o.stop(t + p[1] + 0.2);
  });
}
function notify() {
  if (document.hidden) { unread++; document.title = "(" + unread + ") " + baseTitle; }
  beep();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { unread = 0; document.title = baseTitle; } });
(function soundButton() {
  if (!ui.menu) return;
  const b = mk("button", null, ""); b.type = "button";
  const paint = () => { b.textContent = muted ? "🔕 Sound: off" : "🔔 Sound: on"; };
  b.addEventListener("click", () => { muted = !muted; paint(); try { localStorage.setItem("chat_sound", muted ? "off" : "on"); } catch (e) { /* blocked */ } });
  paint(); ui.menu.append(b);
})();

/* ---------- reactions ---------- */
function setReact(id, emoji, name, on) {
  let m = reacts.get(id); if (!m) { m = new Map(); reacts.set(id, m); }
  let s = m.get(emoji); if (!s) { s = new Set(); m.set(emoji, s); }
  if (on) s.add(name); else { s.delete(name); if (!s.size) m.delete(emoji); }
}
function has(id, emoji) { const m = reacts.get(id), s = m && m.get(emoji); return !!(s && s.has(me)); }
function renderReacts(m) {
  const data = reacts.get(m.dataset.id);
  let box = m.querySelector(".fx-reacts");
  if (!data || !data.size) { if (box) box.remove(); return; }
  if (!box) { box = mk("div", "fx-reacts"); m.append(box); }
  clear(box);
  data.forEach((names, emoji) => {
    const c = mk("button", "fx-chip" + (names.has(me) ? " mine" : "")); c.type = "button"; c.dataset.e = emoji;
    c.append(mk("span", null, emoji), mk("small", null, String(names.size)));
    box.append(c);
  });
}
function renderById(id) { const m = ui.list.querySelector('.msg[data-id="' + id + '"]'); if (m) renderReacts(m); }
function client() {
  if (!c3) c3 = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return c3;
}
async function toggleReaction(id, emoji) {
  const had = has(id, emoji);
  setReact(id, emoji, me, !had); renderById(id);
  try {
    const q = client().from("chat_reactions");
    const { error } = had ? await q.delete().match({ message_id: id, user_name: me, emoji }) : await q.insert({ message_id: id, user_name: me, emoji });
    if (error && error.code !== "23505") throw error;
  } catch (e) {
    console.error("reaction", e);
    setReact(id, emoji, me, had); renderById(id);
    toast(/chat_reactions|relation|schema cache|PGRST|42P01/i.test(String((e && e.message) || "") + String((e && e.code) || "")) ? "Run fun.sql in Supabase first" : "Reaction failed", "error");
  }
}
async function loadReacts() {
  try {
    const { data, error } = await client().from("chat_reactions").select("message_id,user_name,emoji").order("created_at", { ascending: false }).limit(2000);
    if (error) throw error;
    reacts.clear(); data.forEach((r) => setReact(r.message_id, r.emoji, r.user_name, true));
    ui.list.querySelectorAll(".msg").forEach(renderReacts);
  } catch (e) { console.warn("reactions unavailable (run fun.sql once in Supabase)", e); }
}
function watchReacts() {
  if (rch) return;
  try {
    rch = client().channel("reacts-watch");
    rch.on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, (p) => {
      const r = (p.eventType === "DELETE" ? p.old : p.new) || {};
      if (!r.message_id || !r.emoji || !r.user_name) return;
      setReact(r.message_id, r.emoji, r.user_name, p.eventType !== "DELETE"); renderById(r.message_id);
    });
    rch.subscribe();
  } catch (e) { console.error("watch reactions", e); }
}

/* ---------- tap menu (reactions + reply) ---------- */
function closePop() { if (pop) pop.hidden = true; popFor = null; }
function openPop(m, anchor) {
  if (pop && !pop.hidden && popFor === m) { closePop(); return; }
  if (!pop) { pop = mk("div", "fx-pop glass dark"); pop.hidden = true; document.body.append(pop); }
  popFor = m; clear(pop);
  const row = mk("div", "fx-emojis");
  EMOJIS.forEach((e) => {
    const b = mk("button", has(m.dataset.id, e) ? "on" : "", e); b.type = "button"; b.setAttribute("aria-label", "React " + e);
    b.addEventListener("click", () => { closePop(); toggleReaction(m.dataset.id, e); });
    row.append(b);
  });
  const r = mk("button", "fx-replybtn", "↩ Reply"); r.type = "button";
  r.addEventListener("click", () => { closePop(); startReply(m); });
  pop.append(row, r); pop.hidden = false;
  const rc = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  let left = m.classList.contains("own") ? rc.right - w : rc.left;
  left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
  let top = rc.top - h - 6; if (top < 8) top = rc.bottom + 6;
  pop.style.left = left + "px"; pop.style.top = top + "px";
}
ui.list.addEventListener("click", (e) => {
  const chip = e.target.closest(".fx-chip");
  if (chip) { toggleReaction(chip.closest(".msg").dataset.id, chip.dataset.e); return; }
  if (!started || e.target.closest("a,button")) return;
  const b = e.target.closest(".bubble"); if (!b) return;
  const m = b.closest(".msg");
  if (m.classList.contains("sending") || m.classList.contains("failed")) return;
  openPop(m, b);
});
document.addEventListener("pointerdown", (e) => { if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest(".bubble")) closePop(); }, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
window.addEventListener("resize", closePop);
const scroller = $("messages"); if (scroller) scroller.addEventListener("scroll", closePop, { passive: true });

/* ---------- reply ---------- */
const rb = mk("div", "fx-replybar glass dark"), rt = mk("div", "fx-rt"), rx = mk("button", null, "✕");
rb.hidden = true; rx.type = "button"; rx.setAttribute("aria-label", "Cancel reply"); rb.append(rt, rx);
ui.bar.insertBefore(rb, ui.field);
function clearReply() { reply = null; rb.hidden = true; }
rx.addEventListener("click", clearReply);
function startReply(m) {
  const body = (m.dataset.fxb || "").replace(/[⟦⟧]/g, "").replace(/\s+/g, " ").trim();
  reply = { name: label(sender(m)), snippet: body.slice(0, 30) };
  clear(rt); rt.append(mk("b", null, "↩ " + reply.name), mk("span", null, " " + reply.snippet));
  rb.hidden = false; ui.input.focus();
}
// runs just BEFORE script.js sends: puts the quote in front of the text, then removes it again if the send was refused
function inject(e) {
  if (!reply || !started) return;
  const v = ui.input.value;
  if (!v.trim() || v.indexOf("↪ ") === 0) return;
  let pre = "↪ " + reply.name + "⟦" + reply.snippet + "⟧\n";
  if (v.length + pre.length > 200) {
    const room = 200 - v.length - ("↪ " + reply.name + "⟦⟧\n").length;
    if (room < 0) { e.preventDefault(); e.stopImmediatePropagation(); toast("Message too long for a reply", "info"); return; }
    pre = "↪ " + reply.name + "⟦" + reply.snippet.slice(0, room) + "⟧\n";
  }
  ui.input.value = pre + v; pending = pre;
  setTimeout(() => {
    if (pending && ui.input.value.indexOf(pending) === 0) { ui.input.value = ui.input.value.slice(pending.length); ui.input.dispatchEvent(new Event("input")); }
    else clearReply();
    pending = "";
  }, 0);
}
document.addEventListener("keydown", (e) => { if (e.target === ui.input && e.key === "Enter" && !e.shiftKey && !e.isComposing) inject(e); }, true);
document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#send")) inject(e); }, true);

/* ---------- per-message processing ---------- */
function processMsg(m) {
  m.dataset.fx = "1";
  const t = m.querySelector(".text");
  if (t) {
    const raw = t.textContent, q = QUOTE_RE.exec(raw);
    if (q) {
      clear(t);
      const box = mk("div", "fx-quote"); box.append(mk("b", null, label(q[1])), mk("span", null, q[2]));
      t.append(box, linkify(q[3])); m.dataset.fxb = q[3];
    } else m.dataset.fxb = raw;
  }
  if (started && m.classList.contains("pop") && m.classList.contains("other")) notify();
  renderReacts(m);
}
function scan() { ui.list.querySelectorAll(".msg:not([data-fx])").forEach(processMsg); }
new MutationObserver(scan).observe(ui.list, { childList: true, subtree: true });
scan();

/* ---------- start after join (needs Supabase) ---------- */
const configured = typeof SUPABASE_URL === "string" && /^https?:\/\//.test(SUPABASE_URL) &&
  typeof SUPABASE_KEY === "string" && !/YOUR_/.test(SUPABASE_URL + SUPABASE_KEY) && window.supabase;
function tryStart() {
  if (started || !configured || ui.app.hidden || !ui.modal.hidden || !ui.skel.hidden) return;
  const n = readName();
  if (!n || !NAME_RE.test(n)) return;
  started = true; me = n;
  loadReacts(); watchReacts();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadReacts(); });
}
[ui.app, ui.modal, ui.skel].forEach((n) => { if (n) new MutationObserver(tryStart).observe(n, { attributes: true, attributeFilter: ["hidden"] }); });
tryStart();
})();
