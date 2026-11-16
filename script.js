// ====== CONFIG (edit these) ======
const SUPABASE_URL = " https://jgpkjkwhfexkjvyzpqar.supabase.co ";
const SUPABASE_KEY = "sb_publishable_q6z3S8fROzE3nlyFIeUH4A_Dtg6xkCd"; // anon PUBLIC key only
const ADMIN_MODE = "simple";     // "simple" | "secure"
const ADMIN_EMAIL = "admin@example.com"; // used only when ADMIN_MODE === "secure"

(() => {
"use strict";

/* ---------- CONFIG ---------- */
const CFG = {
  ADMIN_NAME: "adminraj", MAX_LEN: 200, PAGE_FIRST: 100, PAGE_MORE: 50, DOM_CAP: 300, NEAR: 120,
  GROUP_MS: 120000, MIN_GAP: 1200, BURST_N: 8, BURST_MS: 30000, TYPE_THROTTLE: 2000, TYPE_TTL: 3000,
  BACKOFF_MAX: 30000, KEY: "chat_user_name", NAME_RE: /^[A-Za-z0-9 _-]{1,20}$/,
  BAD_WORDS: ["damn", "shit", "fuck", "bitch", "asshole"],
  EMOJIS: ["😀","😂","🥹","😍","😎","🤔","😭","😡","👍","👎","🙏","👏","🔥","✨","💯","🎉","❤️","💜","💙","🥳","😴","🤝","👋","🙌","💀","🤯","😅","🌈"]
};
const COLS = "id,user_name,message,created_at";

/* ---------- storage with in-memory fallback ---------- */
const mem = {};
const store = {
  get(k) { try { const v = sessionStorage.getItem(k); return v === null ? (mem[k] ?? null) : v; } catch (e) { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { sessionStorage.setItem(k, v); } catch (e) { } },
  del(k) { delete mem[k]; try { sessionStorage.removeItem(k); } catch (e) { } }
};

/* ---------- state ---------- */
const st = {
  me: "", isAdmin: false, items: [], byId: new Map(), lastTs: null, hasMore: false, loading: true, loadingMore: false,
  unread: 0, sending: false, sent: [], recent: [], typers: new Map(), typingSent: 0,
  status: "connecting", wasDown: false, retry: 0, timer: null, started: false, baseH: 0, baseW: 0
};
let sb = null, channel = null;
const clientId = uid();

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const ui = {
  app: $("app"), dot: $("dot"), online: $("online"), menuBtn: $("menuBtn"), menu: $("menu"), changeName: $("changeName"),
  scroll: $("messages"), list: $("list"), more: $("more"), skel: $("skel"), empty: $("empty"), pill: $("pill"), pillN: $("pillN"),
  typing: $("typing"), typeText: $("typeText"), tray: $("tray"), emojiBtn: $("emojiBtn"), input: $("input"), count: $("count"), send: $("send"),
  modal: $("nameModal"), form: $("nameForm"), nameIn: $("nameIn"), pwWrap: $("pwWrap"), pw: $("pw"), err: $("nameErr"), join: $("join"),
  setup: $("setup"), toasts: $("toasts")
};
  /* ---------- utils ---------- */
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
}
function nameColor(n) { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return "hsl(" + (h % 360) + " 85% 72%)"; }
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (t) => { const d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
function dayLabel(t) {
  const now = Date.now();
  if (dayKey(t) === dayKey(now)) return "Today";
  if (dayKey(t) === dayKey(now - 864e5)) return "Yesterday";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
const badRe = CFG.BAD_WORDS.length ? new RegExp("\\b(" + CFG.BAD_WORDS.join("|") + ")\\b", "gi") : null;
function sanitizeMessage(raw) {
  let s = String(raw).replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  s = s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (badRe) s = s.replace(badRe, (m) => "*".repeat(m.length));
  return s.slice(0, CFG.MAX_LEN);
}
function linkify(text) {
  const frag = document.createDocumentFragment(), re = /https?:\/\/[^\s<>"'`]+/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    let url = m[0], trail = "";
    const t = url.match(/[.,;:!?)\]}]+$/);
    if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch (e) { }
    frag.append(text.slice(last, m.index));
    if (ok) { const a = el("a", null, url); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; frag.append(a); }
    else frag.append(url);
    frag.append(trail);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}
const validRow = (r) => r && typeof r.id === "string" && typeof r.user_name === "string" && typeof r.message === "string" && typeof r.created_at === "string";

/* ---------- UI helpers ---------- */
function toast(msg, type) {
  while (ui.toasts.children.length >= 3) ui.toasts.firstChild.remove();
  const t = el("div", "toast glass " + (type || "info"), msg);
  t.addEventListener("animationend", (e) => { if (e.animationName === "tout") t.remove(); });
  ui.toasts.append(t);
  setTimeout(() => t.remove(), 4800);
}
function setStatus(s) {
  st.status = s;
  ui.dot.className = "dot" + (s === "connected" ? " ok" : s === "connecting" ? "" : " off");
  ui.dot.setAttribute("aria-label", s === "connected" ? "Connected" : s === "connecting" ? "Connecting" : "Disconnected");
  if (s !== "connected") ui.online.textContent = s === "connecting" ? "Connecting…" : "Offline";
}
const nearBottom = () => ui.scroll.scrollHeight - ui.scroll.scrollTop - ui.scroll.clientHeight < CFG.NEAR;
function scrollBottom(smooth) { requestAnimationFrame(() => ui.scroll.scrollTo({ top: ui.scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" })); }
function updatePill() {
  ui.pill.classList.toggle("show", st.unread > 0 && !nearBottom());
  ui.pillN.textContent = st.unread > 99 ? "99+" : String(st.unread);
}
function syncEmpty() { ui.empty.hidden = st.loading || st.items.length > 0; }
function syncMore() { ui.more.hidden = !st.hasMore; }
function setSendState() {
  ui.send.disabled = st.sending || !ui.input.value.trim();
  ui.send.classList.toggle("busy", st.sending);
}
function updateCount() {
  const n = ui.input.value.length;
  ui.count.textContent = n + "/" + CFG.MAX_LEN;
  ui.count.classList.toggle("warn", n >= 180 && n < 200);
  ui.count.classList.toggle("max", n >= 200);
}
function autosize() {
  const near = nearBottom();
  ui.input.style.height = "auto";
  ui.input.style.height = Math.min(ui.input.scrollHeight, 110) + "px";
  if (near) scrollBottom(false);
    }
  /* ---------- message rendering ---------- */
function paintStatus(it) {
  const n = it.node;
  n.classList.toggle("sending", it.status === "sending");
  n.classList.toggle("failed", it.status === "failed");
  it.stEl.textContent = "";
  const b = n.querySelector(".bubble");
  if (it.status === "sending") it.stEl.append(el("span", "clock"));
  if (it.status === "failed") { it.stEl.textContent = "Failed · tap to retry"; b.tabIndex = 0; b.setAttribute("role", "button"); }
  else { b.removeAttribute("tabindex"); b.removeAttribute("role"); }
}
function build(it, prev, mode) {
  const row = it.row, t = it.t, own = row.user_name === st.me, frag = document.createDocumentFragment();
  it.div = (!prev || dayKey(prev.t) !== dayKey(t)) ? el("div", "day", dayLabel(t)) : null;
  if (it.div) frag.append(it.div);
  const grouped = !!prev && !it.div && prev.row.user_name === row.user_name && t - prev.t < CFG.GROUP_MS;
  const n = el("div", "msg " + (own ? "own" : "other") + (grouped ? " grouped" : "") + (mode ? " " + mode : ""));
  n.dataset.id = row.id;
  if (!grouped) {
    const nm = el("div", "name"), u = el("span", null, row.user_name);
    u.style.color = nameColor(row.user_name);
    nm.append(u);
    if (row.user_name.toLowerCase() === CFG.ADMIN_NAME) nm.append(el("span", "badge", "✦ Admin"));
    n.append(nm);
  }
  const line = el("div", "line"), bub = el("div", "bubble glass"), txt = el("div", "text"), meta = el("div", "meta");
  txt.append(linkify(row.message));
  it.timeEl = el("time", null, hhmm(t)); it.stEl = el("span");
  meta.append(it.timeEl, it.stEl);
  bub.append(txt, meta);
  line.append(bub);
  if (st.isAdmin) {
    const del = el("button", "del", "🗑️"); del.type = "button"; del.setAttribute("aria-label", "Delete message");
    const c = el("span", "confirm glass dark", "Delete?"), y = el("button", "yes", "✓"), no = el("button", "no", "✕");
    y.type = no.type = "button"; y.setAttribute("aria-label", "Confirm delete"); no.setAttribute("aria-label", "Cancel");
    c.append(y, no);
    line.append(del, c);
  }
  n.append(line);
  it.node = n;
  frag.append(n);
  paintStatus(it);
  return frag;
}
function noteTs(row) { if (!st.lastTs || Date.parse(row.created_at) > Date.parse(st.lastTs)) st.lastTs = row.created_at; }
function confirmItem(it, row) {
  it.row = row; it.t = Date.parse(row.created_at) || it.t; it.status = "sent";
  it.timeEl.textContent = hhmm(it.t); paintStatus(it); noteTs(row);
}
function addRow(row, o) {
  o = o || {};
  const ex = st.byId.get(row.id);
  if (ex) { if (!o.pending && ex.status !== "sent") confirmItem(ex, row); return ex; }
  const t = Date.parse(row.created_at) || Date.now();
  const it = { row, t, node: null, div: null, status: o.pending ? "sending" : "sent" };
  let idx = st.items.length;
  if (idx && st.items[idx - 1].t > t) idx = st.items.findIndex((i) => i.t > t);
  const prev = st.items[idx - 1] || null, next = st.items[idx] || null, near = nearBottom();
  const frag = build(it, prev, o.fresh ? "pop" : "");
  ui.list.insertBefore(frag, next ? (next.div || next.node) : null);
  st.items.splice(idx, 0, it); st.byId.set(row.id, it);
  if (!o.pending) noteTs(row);
  syncEmpty();
  if (o.fresh) {
    if (o.own || near) { scrollBottom(true); prune(); }
    else { st.unread++; updatePill(); }
  }
  return it;
}
function renderBatch(rows, prepend) {
  const frag = document.createDocumentFragment(), made = [];
  let prev = null;
  rows.forEach((row, i) => {
    if (!validRow(row) || st.byId.has(row.id)) return;
    const it = { row, t: Date.parse(row.created_at), node: null, div: null, status: "sent" };
    frag.append(build(it, prev, "old fade"));
    it.node.style.setProperty("--i", Math.min(i, 14));
    st.byId.set(row.id, it); made.push(it); prev = it;
  });
  if (!made.length) return;
  if (prepend) {
    const f = st.items[0], last = made[made.length - 1];
    if (f && f.div && dayKey(f.t) === dayKey(last.t)) { f.div.remove(); f.div = null; }
    ui.list.insertBefore(frag, ui.list.firstChild);
    st.items.unshift(...made);
  } else { ui.list.append(frag); st.items.push(...made); }
  if (!prepend) noteTs(made[made.length - 1].row);
  syncEmpty();
}
function prune() {
  while (st.items.length > CFG.DOM_CAP) {
    const f = st.items.shift();
    st.byId.delete(f.row.id);
    if (f.div) f.div.remove();
    f.node.remove();
    st.hasMore = true;
  }
  syncMore();
}
function removeById(id) {
  const it = st.byId.get(id);
  if (!it) return;
  st.byId.delete(id);
  const i = st.items.indexOf(it);
  if (i > -1) st.items.splice(i, 1);
  const next = st.items[i];
  if (it.div) { if (next && !next.div && dayKey(next.t) === dayKey(it.t)) next.div = it.div; else it.div.remove(); }
  let done = false;
  const fin = () => { if (done) return; done = true; it.node.remove(); syncEmpty(); };
  it.node.classList.add("leaving");
  it.node.addEventListener("animationend", fin, { once: true });
  setTimeout(fin, 450);
      }
  /* ---------- Supabase service ---------- */
async function fetchLatest() {
  const { data, error } = await sb.from("chat_messages").select(COLS).order("created_at", { ascending: false }).limit(CFG.PAGE_FIRST);
  if (error) throw error;
  return data.reverse();
}
async function fetchMissed() {
  try {
    if (!st.lastTs) { (await fetchLatest()).forEach((r) => addRow(r)); return; }
    const { data, error } = await sb.from("chat_messages").select(COLS).gt("created_at", st.lastTs).order("created_at", { ascending: true }).limit(CFG.PAGE_FIRST);
    if (error) throw error;
    data.forEach((r) => addRow(r, { fresh: true }));
  } catch (e) { console.error("fetchMissed", e); }
}
async function loadOlder() {
  if (st.loadingMore || !st.hasMore || !st.items.length) return;
  st.loadingMore = true; ui.more.disabled = true; ui.more.textContent = "Loading…";
  try {
    const { data, error } = await sb.from("chat_messages").select(COLS).lt("created_at", st.items[0].row.created_at)
      .order("created_at", { ascending: false }).limit(CFG.PAGE_MORE);
    if (error) throw error;
    const h0 = ui.scroll.scrollHeight, top0 = ui.scroll.scrollTop;
    renderBatch(data.reverse(), true);
    ui.scroll.scrollTop = top0 + (ui.scroll.scrollHeight - h0);
    st.hasMore = data.length === CFG.PAGE_MORE;
  } catch (e) { console.error("loadOlder", e); toast("Couldn't load earlier messages", "error"); }
  finally { st.loadingMore = false; ui.more.disabled = false; ui.more.textContent = "Load earlier messages"; syncMore(); }
}
async function push(row) {
  const it = st.byId.get(row.id);
  st.sending = true; setSendState();
  try {
    const { data, error } = await sb.from("chat_messages").insert({ id: row.id, user_name: row.user_name, message: row.message }).select().single();
    if (error && error.code !== "23505") throw error;
    if (it) confirmItem(it, data || row);
  } catch (e) {
    console.error("send", e);
    if (it) { it.status = "failed"; paintStatus(it); }
    toast(/rate/i.test(String(e && e.message)) ? "Slow down ✋" : "Message failed to send. Tap it to retry.", "error");
  } finally { st.sending = false; setSendState(); }
}
async function send() {
  if (st.sending) return;
  const text = sanitizeMessage(ui.input.value);
  if (await handleAiCommand(text)) return;
  if (!text) { ui.input.value = ""; autosize(); updateCount(); setSendState(); return; }
  const now = Date.now();
  st.sent = st.sent.filter((x) => now - x < CFG.BURST_MS);
  if ((st.sent.length && now - st.sent[st.sent.length - 1] < CFG.MIN_GAP) || st.sent.length >= CFG.BURST_N) { toast("Slow down ✋", "info"); return; }
  const last2 = st.recent.slice(-2);
  if (last2.length === 2 && last2.every((x) => x === text)) { toast("Please don't repeat the same message", "info"); return; }
  st.sent.push(now); st.recent.push(text); if (st.recent.length > 5) st.recent.shift();
  const row = { id: uid(), user_name: st.me, message: text, created_at: new Date().toISOString() };
  ui.input.value = ""; autosize(); updateCount(); closeTray();
  addRow(row, { fresh: true, pending: true, own: true });
  await push(row);
// Ye line add karni hai:
if (Math.random() < 0.1) autoCleanup(); 
}
function retry(it) { if (st.sending || it.status !== "failed") return; it.status = "sending"; paintStatus(it); push(it.row); }
async function deleteMsg(id) {
  const it = st.byId.get(id);
  if (!it || !st.isAdmin) return;
  const row = it.row;
  removeById(id);
  try {
    const { data, error } = await sb.from("chat_messages").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || !data.length) throw new Error("Delete not permitted");
  } catch (e) { console.error("delete", e); addRow(row); toast("Couldn't delete message", "error"); }
}

/* ---------- realtime ---------- */
function renderTyping() {
  const n = [...st.typers.keys()];
  ui.typeText.textContent = n.length === 1 ? n[0] + " is typing" : n.length === 2 ? n[0] + " and " + n[1] + " are typing" : n.length ? "Several people are typing" : "";
  ui.typing.classList.toggle("on", n.length > 0);
}
function clearTyper(name) { if (st.typers.has(name)) { clearTimeout(st.typers.get(name)); st.typers.delete(name); renderTyping(); } }
async function connect() {
  clearTimeout(st.timer); st.timer = null;
  if (channel) { const old = channel; channel = null; try { await sb.removeChannel(old); } catch (e) { } }
  setStatus("connecting");
  const ch = sb.channel("chat-room", { config: { presence: { key: clientId }, broadcast: { self: false } } });
  channel = ch;
  ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
    if (!validRow(p.new)) return;
    clearTyper(p.new.user_name);
    addRow(p.new, { fresh: true });
  });
  ch.on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, (p) => { if (p.old && p.old.id) removeById(p.old.id); });
  ch.on("presence", { event: "sync" }, () => { ui.online.textContent = Object.keys(ch.presenceState()).length + " online"; });
  ch.on("broadcast", { event: "typing" }, ({ payload }) => {
    const n = payload && typeof payload.name === "string" ? payload.name.slice(0, 20) : "";
    if (!n || n === st.me) return;
    clearTimeout(st.typers.get(n));
    st.typers.set(n, setTimeout(() => { st.typers.delete(n); renderTyping(); }, CFG.TYPE_TTL));
    renderTyping();
  });
  ch.subscribe(async (status) => {
    if (ch !== channel) return;
    if (status === "SUBSCRIBED") {
      st.retry = 0; setStatus("connected");
      if (st.wasDown) { st.wasDown = false; toast("Reconnected", "success"); }
      try { await ch.track({ name: st.me }); } catch (e) { console.error("track", e); }
      fetchMissed();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") handleDown();
  });
}
function handleDown() {
  if (st.timer) return;
  setStatus("disconnected");
  if (!st.wasDown) { st.wasDown = true; toast("Disconnected. Reconnecting…", "error"); }
  const delay = Math.min(1000 * Math.pow(2, st.retry++), CFG.BACKOFF_MAX);
  st.timer = setTimeout(() => { st.timer = null; connect(); }, delay);
}
function reconnectNow() { st.retry = 0; clearTimeout(st.timer); st.timer = null; connect(); }
  /* ---------- session / modal ---------- */
function nameError(msg) {
  ui.err.textContent = msg;
  ui.nameIn.classList.remove("shake"); void ui.nameIn.offsetWidth; ui.nameIn.classList.add("shake");
  ui.nameIn.focus();
}
function showModal() { ui.modal.hidden = false; ui.nameIn.focus(); }
async function submitName(e) {
  e.preventDefault();
  const name = ui.nameIn.value.trim();
  if (!CFG.NAME_RE.test(name)) return nameError("Use 1–20 letters, numbers, spaces, _ or -");
  const admin = name.toLowerCase() === CFG.ADMIN_NAME;
  if (ADMIN_MODE === "secure" && admin) {
    if (ui.pwWrap.hidden) { ui.pwWrap.hidden = false; ui.pw.focus(); return; }
    ui.join.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ui.pw.value });
      if (error) { nameError("Wrong admin password"); return; }
    } catch (err) { console.error("auth", err); nameError("Login failed. Try again."); return; }
    finally { ui.join.disabled = false; }
  }
  store.set(CFG.KEY, name);
  enter(name);
}
function enter(name) {
  st.me = name; st.isAdmin = name.toLowerCase() === CFG.ADMIN_NAME;
  ui.modal.hidden = true; ui.err.textContent = "";
  start();
}
async function start() {
  if (st.started) return;
  st.started = true; st.loading = true; ui.skel.hidden = false; syncEmpty();
  try { const rows = await fetchLatest(); renderBatch(rows, false); st.hasMore = rows.length === CFG.PAGE_FIRST; }
  catch (e) { console.error("initial load", e); toast("Couldn't load messages", "error"); }
  st.loading = false; ui.skel.hidden = true; syncEmpty(); syncMore(); scrollBottom(false);
  connect();
}

/* ---------- tray / viewport ---------- */
function openTray() { ui.tray.classList.add("open"); ui.emojiBtn.setAttribute("aria-expanded", "true"); scrollBottom(true); }
function closeTray() { ui.tray.classList.remove("open"); ui.emojiBtn.setAttribute("aria-expanded", "false"); }
function insertEmoji(em) {
  const i = ui.input, s = i.selectionStart == null ? i.value.length : i.selectionStart, en = i.selectionEnd == null ? s : i.selectionEnd;
  const v = i.value.slice(0, s) + em + i.value.slice(en);
  if (v.length > CFG.MAX_LEN) return;
  i.value = v; i.setSelectionRange(s + em.length, s + em.length); onInput();
}
function onInput() {
  autosize(); updateCount(); setSendState();
  const now = Date.now();
  if (channel && st.status === "connected" && ui.input.value.trim() && now - st.typingSent > CFG.TYPE_THROTTLE) {
    st.typingSent = now;
    channel.send({ type: "broadcast", event: "typing", payload: { name: st.me } }).catch((e) => console.error("typing", e));
  }
}
let vvQueued = false;
function syncViewport() {
  const vv = window.visualViewport;
  if (!vv || vvQueued) return;
  vvQueued = true;
  requestAnimationFrame(() => {
    vvQueued = false;
    const h = Math.round(vv.height), w = Math.round(vv.width), root = document.documentElement.style;
    if (w !== st.baseW) { st.baseW = w; st.baseH = h; }
    st.baseH = Math.max(st.baseH, h);
    root.setProperty("--vv-h", h + "px"); root.setProperty("--vv-top", Math.round(vv.offsetTop) + "px");
    const kb = st.baseH - h > 120, was = ui.app.classList.contains("kb");
    ui.app.classList.toggle("kb", kb);
    if (kb && !was) scrollBottom(false);
  });
}

/* ---------- events ---------- */
function bind() {
  CFG.EMOJIS.forEach((em) => { const b = el("button", null, em); b.type = "button"; b.setAttribute("aria-label", "Insert " + em); ui.tray.append(b); });
  ui.tray.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) insertEmoji(b.textContent); });
  ui.tray.addEventListener("mousedown", (e) => e.preventDefault());
  ui.emojiBtn.addEventListener("click", () => (ui.tray.classList.contains("open") ? closeTray() : openTray()));
  ui.input.addEventListener("input", onInput);
  ui.input.addEventListener("focus", () => setTimeout(() => scrollBottom(false), 300));
  ui.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  ui.send.addEventListener("click", send);
  ui.send.addEventListener("mousedown", (e) => e.preventDefault());
  ui.send.addEventListener("pointerdown", (e) => {
    const r = ui.send.getBoundingClientRect(), s = el("span", "ripple");
    s.style.left = (e.clientX - r.left) + "px"; s.style.top = (e.clientY - r.top) + "px";
    s.addEventListener("animationend", () => s.remove());
    ui.send.append(s);
  });
  ui.form.addEventListener("submit", submitName);
  ui.nameIn.addEventListener("input", () => {
    ui.err.textContent = "";
    if (!(ADMIN_MODE === "secure" && ui.nameIn.value.trim().toLowerCase() === CFG.ADMIN_NAME)) ui.pwWrap.hidden = true;
  });
  ui.modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...ui.modal.querySelectorAll("input,button")].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  ui.menuBtn.addEventListener("click", () => { ui.menu.hidden = !ui.menu.hidden; ui.menuBtn.setAttribute("aria-expanded", String(!ui.menu.hidden)); });
  ui.changeName.addEventListener("click", async () => {
    store.del(CFG.KEY);
    try { if (ADMIN_MODE === "secure") await sb.auth.signOut(); } catch (e) { console.error(e); }
    location.reload();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!ui.tray.contains(e.target) && !ui.emojiBtn.contains(e.target)) closeTray();
    if (!ui.menu.contains(e.target) && !ui.menuBtn.contains(e.target)) { ui.menu.hidden = true; ui.menuBtn.setAttribute("aria-expanded", "false"); }
  }, { passive: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeTray(); ui.menu.hidden = true; } });
  ui.pill.addEventListener("click", () => { st.unread = 0; updatePill(); scrollBottom(true); });
  ui.more.addEventListener("click", loadOlder);
  let q = false;
  ui.scroll.addEventListener("scroll", () => {
    if (q) return; q = true;
    requestAnimationFrame(() => {
      q = false;
      if (nearBottom()) st.unread = 0;
      updatePill();
      if (ui.scroll.scrollTop < 60) loadOlder();
    });
  }, { passive: true });
  ui.list.addEventListener("click", (e) => {
    const msg = e.target.closest(".msg");
    if (!msg) return;
    if (e.target.closest(".del")) { if (st.isAdmin) msg.classList.add("asking"); return; }
    if (e.target.closest(".no")) { msg.classList.remove("asking"); return; }
    if (e.target.closest(".yes")) { msg.classList.remove("asking"); deleteMsg(msg.dataset.id); return; }
    const it = st.byId.get(msg.dataset.id);
    if (it && it.status === "failed" && e.target.closest(".bubble")) retry(it);
  });
  ui.list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const b = e.target.closest(".msg.failed .bubble");
    if (b) { const it = st.byId.get(b.closest(".msg").dataset.id); if (it) retry(it); }
  });
  window.addEventListener("offline", () => { st.wasDown = true; setStatus("disconnected"); toast("You're offline", "error"); });
  window.addEventListener("online", () => { if (st.started) reconnectNow(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !st.started) return;
    if (st.status === "connected") fetchMissed(); else reconnectNow();
  });
  if (window.visualViewport) { visualViewport.addEventListener("resize", syncViewport); visualViewport.addEventListener("scroll", syncViewport); syncViewport(); }
}

/* ---------- init ---------- */
async function init() {
  const ok = typeof SUPABASE_URL === "string" && /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_KEY && !/YOUR_/.test(SUPABASE_URL + SUPABASE_KEY);
  if (!ok || !window.supabase) { ui.setup.hidden = false; return; }
  ui.app.hidden = false;
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: ADMIN_MODE === "secure", autoRefreshToken: ADMIN_MODE === "secure" } });
  } catch (e) { console.error(e); ui.app.hidden = true; ui.setup.hidden = false; return; }
  bind(); updateCount(); setSendState();
  const saved = store.get(CFG.KEY);
  if (saved && CFG.NAME_RE.test(saved)) {
    if (ADMIN_MODE === "secure" && saved.toLowerCase() === CFG.ADMIN_NAME) {
      let has = false;
      try { const { data } = await sb.auth.getSession(); has = !!(data && data.session); } catch (e) { console.error(e); }
      if (!has) { store.del(CFG.KEY); showModal(); return; }
    }
    enter(saved);
  } else showModal();
}
  /* ---------- AUTO CLEANUP (5000 MESSAGES LIMIT) ---------- */
async function autoCleanup() {
  try {
    const { count, error } = await sb.from('chat_messages').select('*', { count: 'exact', head: true });
    
    if (count > 5000) {
      console.log("Cleaning up old messages... Total: " + count);
      const { data } = await sb.from('chat_messages').select('id').order('created_at', { ascending: true }).limit(100);
      
      if (data && data.length > 0) {
        const idsToDelete = data.map(m => m.id);
        await sb.from('chat_messages').delete().in('id', idsToDelete);
        console.log("Deleted 100 old messages.");
      }
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}
init();
})();
