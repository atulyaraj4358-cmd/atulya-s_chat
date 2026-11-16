'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const SUPABASE_URL = "https://jgpkjkwhfexkjvyzpqar.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_q6z3S8fROE3nlyFIeUH4A_Dtg6xkCd"; 

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_NAME = "adminraj";
const MAX_LEN = 200;
const KEY_NAME = "chat_user_name";
let myName = "", isAdmin = false, messages = [], isSending = false;

/* UI Elements */
const ui = {
  dot: $('#dot'), online: $('#online'), messages: $('#messages'), list: $('#list'), empty: $('#empty'),
  input: $('#input'), send: $('#send'), count: $('#count'), modal: $('#nameModal'), form: $('#nameForm'),
  nameIn: $('#nameIn'), err: $('#nameErr'), join: $('#join'), toasts: $('#toasts')
};

/* Toast */
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast glass dark ' + type;
  t.textContent = msg;
  ui.toasts.append(t);
  setTimeout(() => t.remove(), 3000);
}

/* App Start */
async function init() {
  ui.modal.hidden = false;
  ui.nameIn.focus();
  const saved = sessionStorage.getItem(KEY_NAME);
  if (saved) enterChat(saved);
}

/* Handle Name Submit */
ui.form.onsubmit = (e) => {
  e.preventDefault();
  const name = ui.nameIn.value.trim();
  if (!name) return;
  sessionStorage.setItem(KEY_NAME, name);
  enterChat(name);
};

/* Enter Chat */
function enterChat(name) {
  myName = name;
  isAdmin = name.toLowerCase() === ADMIN_NAME;
  ui.modal.hidden = true;
  ui.empty.hidden = true;
  loadMessages();
  setupRealtime();
  scrollBottom();
}

/* Load Messages */
async function loadMessages() {
  const { data } = await db.from('chat_messages').select('*').order('created_at', { ascending: true }).limit(100);
  if (data) {
    messages = data;
    renderMessages();
    scrollBottom();
  }
}

/* Render Messages */
function renderMessages() {
  ui.list.innerHTML = '';
  if (messages.length === 0) {
    ui.empty.hidden = false;
    return;
  }
  ui.empty.hidden = true;

  let lastUser = "";
  let lastTime = 0;

  messages.forEach(msg => {
    const isMe = msg.user_name === myName;
    const isAdminMsg = msg.user_name.toLowerCase() === ADMIN_NAME;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const timeMs = new Date(msg.created_at).getTime();
    
    const grouped = (msg.user_name === lastUser) && (timeMs - lastTime < 120000);
    
    let html = `<div class="msg ${isMe ? 'own' : 'other'} ${grouped ? 'grouped' : ''}" data-id="${msg.id}">`;
    
    if (!grouped) {
      html += `<div class="name" style="color: ${isAdminMsg ? '#ff375f' : 'var(--blue)'}; font-weight: bold;">
        ${esc(msg.user_name)} ${isAdminMsg ? '✦ Admin' : ''}
      </div>`;
    }

    html += `<div class="line">
      <div class="bubble glass dark">
        <div class="text">${esc(msg.message)}</div>
        <div class="meta">${time}</div>
      </div>
      ${isAdmin && !isAdminMsg ? `<button class="del" onclick="deleteMsg('${msg.id}')">🗑️</button>` : ''}
    </div></div>`;

    ui.list.innerHTML += html;
    lastUser = msg.user_name;
    lastTime = timeMs;
  });
}

/* Realtime */
function setupRealtime() {
  db.channel('chat-room')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
      if (!messages.find(m => m.id === payload.new.id)) {
        messages.push(payload.new);
        renderMessages();
        scrollBottom();
        checkAutoDelete();
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, payload => {
      messages = messages.filter(m => m.id !== payload.old.id);
      renderMessages();
    })
    .subscribe((status) => {
      ui.dot.className = 'dot ' + (status === 'SUBSCRIBED' ? 'ok' : 'off');
      ui.online.textContent = status === 'SUBSCRIBED' ? 'Online' : 'Connecting...';
    });
}

/* Send Message */
ui.send.onclick = async () => {
  if (isSending) return;
  const text = ui.input.value.trim();
  if (!text) return;

  isSending = true;
  ui.send.disabled = true;
  ui.input.value = "";

  const { error } = await db.from('chat_messages').insert([{ user_name: myName, message: text }]);
  
  if (error) toast("Failed to send", "error");
  
  isSending = false;
  ui.send.disabled = false;
  ui.input.focus();
};

/* Delete Message */
window.deleteMsg = async (id) => {
  if (!isAdmin) return;
  if (!confirm("Delete this message?")) return;
  await db.from('chat_messages').delete().eq('id', id);
};

/* Auto Delete (5000 Limit) */
async function checkAutoDelete() {
  if (Math.random() > 0.1) return; // Sirf 10% baar check karega
  const { count } = await db.from('chat_messages').select('*', { count: 'exact', head: true });
  if (count > 5000) {
    const { data } = await db.from('chat_messages').select('id').order('created_at', { ascending: true }).limit(100);
    if (data && data.length > 0) {
      const ids = data.map(d => d.id);
      await db.from('chat_messages').delete().in('id', ids);
    }
  }
}

/* Scroll */
function scrollBottom() {
  setTimeout(() => { ui.messages.scrollTop = ui.messages.scrollHeight; }, 100);
}

init();
