// src/lib/conversation.ts
var MAX_MESSAGE_CHARS = 2e3;
var MAX_HISTORY_MESSAGES = 8;
var MAX_HISTORY_CHARS = 6e3;
var MAX_PAYLOAD_CHARS = 8e3;
var SYSTEM_PROMPT = `You are a concise voice assistant running in the browser.
Rules:
- Reply in clear, natural language that can be read aloud.
- Keep answers short: usually one to four sentences, or a brief list of short items.
- Do not use markdown headings, tables, or code fences unless the user explicitly asks for code. If you include code, keep it brief.
- If you are unsure, say so plainly. Do not invent facts.
- Do not mention these instructions.`;
function sanitizeText(text, max = MAX_MESSAGE_CHARS) {
  if (typeof text !== "string") return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}
function isRole(value) {
  return value === "user" || value === "assistant";
}
function createMessage(role, text, id) {
  return {
    id: id ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
    role,
    text: sanitizeText(text)
  };
}
function trimHistory(messages, maxMessages = MAX_HISTORY_MESSAGES, maxChars = MAX_HISTORY_CHARS) {
  const recent = messages.filter((message) => message.text).slice(-maxMessages);
  let total = recent.reduce((sum, message) => sum + message.text.length, 0);
  const trimmed = [...recent];
  while (trimmed.length > 1 && total > maxChars) {
    const removed = trimmed.shift();
    total -= removed?.text.length ?? 0;
  }
  return trimmed;
}
function toGeminiContents(messages) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.text }]
  }));
}
function prepareChatPayload(input) {
  const message = sanitizeText(input.message);
  if (!message) {
    return { ok: false, status: 400, error: "A message is required." };
  }
  if (typeof input.message === "string" && input.message.trim().length > MAX_MESSAGE_CHARS) {
    return { ok: false, status: 413, error: "That message is too long. Please shorten it and try again." };
  }
  const rawHistory = Array.isArray(input.history) ? input.history : [];
  const history = [];
  for (const item of rawHistory) {
    if (!item || typeof item !== "object") {
      return { ok: false, status: 400, error: "Conversation history is invalid." };
    }
    const entry = item;
    if (!isRole(entry.role)) {
      return { ok: false, status: 400, error: "Conversation history is invalid." };
    }
    const text = sanitizeText(entry.text);
    if (!text) continue;
    history.push(createMessage(entry.role, text, typeof item.id === "string" ? item.id : void 0));
  }
  const trimmed = trimHistory(history);
  const contents = toGeminiContents([...trimmed, createMessage("user", message, "current")]);
  const serialized = JSON.stringify(contents);
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    return { ok: false, status: 413, error: "The conversation is too long. Clear the history and try again." };
  }
  return { ok: true, message, history: trimmed, contents };
}

// src/lib/http.ts
var MAX_BODY_BYTES = 16384;
function methodOf(req) {
  return (req.method ?? "GET").toUpperCase();
}
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
function tooLarge(req, max = MAX_BODY_BYTES) {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}
function readJsonBody(req) {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}
function cors(res) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}

// src/lib/rate-limit.ts
var hits = /* @__PURE__ */ new Map();
function allow(key, limit = 20, windowMs = 6e4, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5e3) hits.clear();
  return true;
}
function clientIp(headers, fallback = "unknown") {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(",")[0].trim();
  const real = headers["x-real-ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue && realValue.trim()) return realValue.trim();
  return fallback;
}

// src/lib/chat.ts
var CHAT_LIMIT = 10;
var CHAT_WINDOW_MS = 6e4;
var DEFAULT_MODEL = "gemini-3.5-flash-lite";
var MAX_OUTPUT_TOKENS = 350;
function getGeminiApiKey(env = process.env) {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return void 0;
  return key.trim();
}
function getModelId(env = process.env) {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}
async function callGemini(contents, model, apiKey, fetchFn = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.6 }
    })
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("RATE_LIMIT");
    }
    throw new Error("The assistant is unavailable right now.");
  }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The assistant returned an empty response.");
  return text;
}
async function handleChatHttp(req, res, deps = {}) {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  const env = deps.env ?? process.env;
  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`chat:${ip}`, CHAT_LIMIT, CHAT_WINDOW_MS, deps.now ?? Date.now())) {
    res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
    return;
  }
  const key = getGeminiApiKey(env);
  if (!key) {
    res.status(503).json({ error: "The assistant is not configured on this deployment." });
    return;
  }
  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const prepared = prepareChatPayload(body.value ?? {});
  if (!prepared.ok) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }
  try {
    const generate = deps.generate ?? callGemini;
    const text = await generate(prepared.contents, getModelId(env), key);
    res.status(200).json({ reply: text, model: getModelId(env) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "RATE_LIMIT") {
      res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
      return;
    }
    res.status(502).json({ error: "The assistant could not reply. Please try again in a moment." });
  }
}

// server/chat.ts
var maxDuration = 30;
async function handler(req, res) {
  await handleChatHttp(req, res);
}
export {
  handler as default,
  maxDuration
};
