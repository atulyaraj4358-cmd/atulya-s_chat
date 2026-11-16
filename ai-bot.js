/* ai-bot.js — Gemini "/ai" bot for Atulya's chat
 * Load this BEFORE script.js:  <script src="ai-bot.js"></script>
 * Needs from script.js (already in your app): uid, addRow, push, ui, st
 * WARNING: GEMINI_API_KEY here is public to anyone who opens DevTools.
 * Restrict the key by HTTP referrer in Google AI Studio, or use an Edge Function.
 */

// ===== CONFIG =====
const GEMINI_API_KEY = " AQ.Ab8RN6LRN33GKR7uAJOTasHMCR9nOtYPxCSiZkgqKzEJEig9Nw ";
const GEMINI_MODEL   = "gemini-3.5-flash"; // verify at ai.google.dev/gemini-api/docs/models
const AI_NAME        = "Atulya AI";
const AI_COOLDOWN_MS = 5000;
const AI_MAX_LEN     = 1000; // set to your messages.message column limit

// ===== Gemini call =====
// Returns a plain string on success; throws Error(friendly message) on failure.
async function askGemini(question) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text:
            "You are Atulya AI, a helpful assistant inside a group chat. Reply concisely (under 700 characters), in plain text only: no markdown, no headings, no bullet symbols. Be friendly and direct. If unsure, say so." }] },
          contents: [{ role: "user", parts: [{ text: question }] }],
          generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: "low" } }
        })
      }
    );
    if (res.status === 429) throw new Error("AI is busy (rate limit). Try again shortly.");
    if (res.status >= 500)  throw new Error("AI service is having issues. Try again later.");
    if (!res.ok)            throw new Error(`AI request failed (${res.status}).`);

    const data = await res.json();
    if (data.promptFeedback?.blockReason) throw new Error("That question was blocked by the AI safety filter.");
    const cand = data.candidates?.[0];
    const out = (cand?.content?.parts || [])
      .filter(p => p.text && !p.thought).map(p => p.text).join("").trim();
    if (!out) throw new Error(cand?.finishReason === "SAFETY"
      ? "Reply blocked by safety filter." : "AI returned an empty answer.");
    return out;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("AI took too long (20s). Try again.");
    if (e instanceof TypeError)  throw new Error("Network error. Check your connection.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Command handler =====
// Returns true if `text` was an /ai command (fully handled, NOT sent to Supabase),
// false otherwise so your normal send() continues.
async function handleAiCommand(text) {
  const cmd = text.match(/^\/ai(?:\s+([\s\S]*))?$/i);
  if (!cmd) return false;

  const now = () => new Date().toISOString();
  const say = (msg, id = uid()) => addRow(                       // local-only bot row
    { id, user_name: AI_NAME, message: msg, created_at: now() }, { fresh: true });
  const drop = (h, id) => {                                      // remove local placeholder
    const el = h instanceof Element ? h : document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    el?.remove();
  };

  // Loop guard: nobody may act as the bot
  if (String(st.me).toLowerCase() === AI_NAME.toLowerCase()) {
    say("That name is reserved for the bot."); return true;
  }

  const q = (cmd[1] || "").trim().slice(0, 2000);
  if (!q) { ui.input.value = ""; say("Usage: /ai your question"); return true; }

  const wait = AI_COOLDOWN_MS - (Date.now() - (st.aiLast || 0));
  if (wait > 0) { say(`Easy! Try again in ${Math.ceil(wait / 1000)}s.`); return true; }
  st.aiLast = Date.now();
  ui.input.value = "";

  // User's question: visible locally only, never pushed
  addRow({ id: uid(), user_name: st.me, message: text, created_at: now() }, { fresh: true, own: true });
  const tid = uid();
  const h = say("Atulya AI is thinking...", tid);

  let reply;
  try { reply = await askGemini(q); }
  catch (e) { drop(h, tid); say(e.message || "AI is unavailable right now."); return true; }
  drop(h, tid);

  if (reply.length > AI_MAX_LEN) reply = reply.slice(0, AI_MAX_LEN - 1) + "…";
  try { await push({ id: uid(), user_name: AI_NAME, message: reply, created_at: now() }); }
  catch { say("Couldn't post the AI reply. Try again."); }
  return true;
}
