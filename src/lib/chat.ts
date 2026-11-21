import { prepareChatPayload, SYSTEM_PROMPT, type ChatInput, type GeminiContent } from "./conversation.js";
import { describeHttpError, describeNetworkError } from "./errors.js";
import { cors, methodOf, readJsonBody, tooLarge, type HttpRequest, type HttpResponse } from "./http.js";
import { allow, clientIp } from "./rate-limit.js";

export type EnvMap = Record<string, string | undefined>;

export const CHAT_LIMIT = 10;
export const CHAT_WINDOW_MS = 60_000;
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const MAX_OUTPUT_TOKENS = 350;

export function getGeminiApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return undefined;
  return key.trim();
}

export function getModelId(env: EnvMap = process.env): string {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}

export async function callGemini(
  contents: GeminiContent[],
  model: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.6 },
    }),
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("RATE_LIMIT");
    }
    throw new Error("The assistant is unavailable right now.");
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The assistant returned an empty response.");
  return text;
}

export async function handleChatHttp(
  req: HttpRequest,
  res: HttpResponse,
  deps: { env?: EnvMap; generate?: typeof callGemini; now?: number } = {},
): Promise<void> {
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
  const prepared = prepareChatPayload((body.value ?? {}) as ChatInput);
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

export interface ChatApiResult {
  ok: boolean;
  status: number;
  reply?: string;
  model?: string;
  error?: string;
}

export async function requestChat(
  message: string,
  history: { role: "user" | "assistant"; text: string }[],
  fetchFn: typeof fetch = fetch,
): Promise<ChatApiResult> {
  try {
    const response = await fetchFn("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
    const payload = (await response.json().catch(() => ({}))) as { reply?: string; model?: string; error?: string };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: describeHttpError(response.status, payload.error),
      };
    }
    const reply = (payload.reply ?? "").trim();
    if (!reply) {
      return { ok: false, status: 502, error: describeHttpError(502) };
    }
    return { ok: true, status: 200, reply, model: payload.model };
  } catch {
    return { ok: false, status: 0, error: describeNetworkError() };
  }
}
