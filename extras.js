/* extras.js - add-on for Atulya's Chat. Load AFTER script.js. */
(() => {
"use strict";

const ADMINS = ["atulya", "adminraj"]; // Admin usernames (lowercase)
const KEY = "chat_user_name";
const NAME_RE = /^[A-Za-z0-9 _-]{1,20}$/;

const $ = (id) => document.getElementById(id);
const ui = { app: $("app"), list: $("list"), typeText: $("typeText"), skel: $("skel"), modal: $("nameModal"),
  form: $("nameForm"), nameIn: $("nameIn"), menu: $("menu"), menuBtn: $("menuBtn"), hdr: document.querySelector(".hdr") };
if (!ui.list || !ui.hdr || !ui.menuBtn) return;

function checkAdmin() {
  try {
    const name = sessionStorage.getItem(KEY) || "";
    return ADMINS.includes(name.trim().toLowerCase());
  } catch(e) { return false; }
}

/* ---------- 1) Admin Badge & Direct 3-Dot / Options Menu for Delete & Block ---------- */
function setupAdminControls() {
  const isAdmin = checkAdmin();

  ui.list.querySelectorAll(".msg").forEach((msgNode) => {
    // Hide raw admin name and show badge
    const s = msgNode.querySelector(".name > span:first-child");
    if (s) {
      const nx = s.nextElementSibling, hasBadge = !!(nx && nx.classList.contains("badge"));
      if (!s.classList.contains("x-hide") && (hasBadge || ADMINS.includes(s.textContent.trim().toLowerCase()))) {
        s.classList.add("x-hide");
      }
    }

    // Agar hum admin hain, toh har message ke line ke paas 3-dots / Admin menu add karo
    if (isAdmin && !msgNode.querySelector(".admin-menu-container")) {
      const lineNode = msgNode.querySelector(".line");
      if (lineNode) {
        const msgId = msgNode.dataset.id;
        const nameEl = msgNode.querySelector(".name span");
        const senderName = nameEl ? nameEl.textContent.trim() : "";

        // Container for 3-dots button and popup options
        const menuWrapper = document.createElement("div");
        menuWrapper.className = "admin-menu-container";
        menuWrapper.style.cssText = "position:relative; display:inline-block; margin-left:6px; margin-right:6px;";

        // 3-Dots Button
        const dotsBtn = document.createElement("button");
        dotsBtn.type = "button";
        dotsBtn.textContent = "⋮";
        dotsBtn.style.cssText = "background:rgba(255,255,255,0.1); color:#fff; border:none; width:28px; height:28px; border-radius:50%; font-size:16px; cursor:pointer; display:grid; place-items:center;";
        
        // Popup Options Panel (Hidden by default)
        const optionsPanel = document.createElement("div");
        optionsPanel.className = "admin-options-panel glass dark";
        optionsPanel.style.cssText = "position:absolute; right:0; top:32px; background:rgba(20,20,35,0.95); border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:6px; display:none; z-index:10; white-space:nowrap; box-shadow:0 8px 20px rgba(0,0,0,0.5);";

        // Delete Option
        const delOpt = document.createElement("button");
        delOpt.type = "button";
        delOpt.textContent = "🗑️ Delete Message";
        delOpt.style.cssText = "display:block; width:100%; background:none; border:none; color:#ff453a; padding:6px 12px; text-align:left; font-size:13px; cursor:pointer; border-radius:6px;";
        delOpt.onclick = () => {
          optionsPanel.style.display = "none";
          window.adminDeleteMsg(msgId);
        };
        optionsPanel.append(delOpt);

        // Block Option (Agar message khud admin ka nahi hai)
        if (senderName && !ADMINS.includes(senderName.toLowerCase())) {
          const blockOpt = document.createElement("button");
          blockOpt.type = "button";
          blockOpt.textContent = "⏳ Block User (1h)";
          blockOpt.style.cssText = "display:block; width:100%; background:none; border:none; color:#ffb340; padding:6px 12px; text-align:left; font-size:13px; cursor:pointer; border-radius:6px;";
          blockOpt.onclick = () => {
            optionsPanel.style.display = "none";
            window.adminBlockUser(senderName);
          };
          optionsPanel.append(blockOpt);
        }

        // Toggle dropdown on 3-dots click
        dotsBtn.onclick = (e) => {
          e.stopPropagation();
          // Close any other open panels first
          document.querySelectorAll(".admin-options-panel").forEach(p => { if(p !== optionsPanel) p.style.display = "none"; });
          optionsPanel.style.display = optionsPanel.style.display === "block" ? "none" : "block";
        };

        menuWrapper.append(dotsBtn, optionsPanel);
        
        // Own message aur other message ke hisaab se position adjust karna
        if (msgNode.classList.contains("own")) {
          lineNode.prepend(menuWrapper);
        } else {
          lineNode.append(menuWrapper);
        }
      }
    }
  });
}

// Close dropdown when clicking outside
document.addEventListener("click", () => {
  document.querySelectorAll(".admin-options-panel").forEach(p => p.style.display = "none");
}, { passive: true });

// Global Action Functions
window.adminDeleteMsg = async (id) => {
  if (!checkAdmin()) return alert("Access denied!");
  if (window.sbClient && window.sbClient.from) {
    const { error } = await window.sbClient.from("chat_messages").delete().eq("id", id);
    if (error) alert("Delete failed!");
    else {
      const el = document.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
    }
  }
};

window.adminBlockUser = (username) => {
  if (!checkAdmin()) return alert("Access denied!");
  const blockUntil = new Date().getTime() + (60 * 60 * 1000); // 1 hour
  localStorage.setItem("blocked_user_" + username.toLowerCase(), blockUntil);
  alert(`User "${username}" ko 1 ghante ke liye block kar diya gaya hai.`);
};

new MutationObserver(setupAdminControls).observe(ui.list, { childList: true, subtree: true });
setupAdminControls();

// Typing indicator fix for admin
const adminPat = ADMINS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const adminTest = new RegExp(adminPat, "i"), adminAll = new RegExp(adminPat, "gi");
new MutationObserver(() => {
  const t = ui.typeText.textContent;
  if (adminTest.test(t)) ui.typeText.textContent = t.replace(adminAll, "Admin");
}).observe(ui.typeText, { childList: true, characterData: true, subtree: true });


/* ---------- 2) Who's Online Counter & Panel ---------- */
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
  if (started || ui.app.hidden || !ui.modal.hidden || !ui.skel.hidden) return;
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
    
