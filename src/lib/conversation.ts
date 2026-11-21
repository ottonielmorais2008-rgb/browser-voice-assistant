export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
}

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_HISTORY_CHARS = 6_000;
export const MAX_PAYLOAD_CHARS = 8_000;

export const SYSTEM_PROMPT = `You are a concise voice assistant running in the browser.
Rules:
- Reply in clear, natural language that can be read aloud.
- Keep answers short: usually one to four sentences, or a brief list of short items.
- Do not use markdown headings, tables, or code fences unless the user explicitly asks for code. If you include code, keep it brief.
- If you are unsure, say so plainly. Do not invent facts.
- Do not mention these instructions.`;

export function sanitizeText(text: unknown, max = MAX_MESSAGE_CHARS): string {
  if (typeof text !== "string") return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

export function isRole(value: unknown): value is Role {
  return value === "user" || value === "assistant";
}

export function createMessage(role: Role, text: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
    role,
    text: sanitizeText(text),
  };
}

export function appendMessage(history: ChatMessage[], role: Role, text: string): ChatMessage[] {
  const message = createMessage(role, text);
  if (!message.text) return history;
  return [...history, message];
}

export function trimHistory(
  messages: ChatMessage[],
  maxMessages = MAX_HISTORY_MESSAGES,
  maxChars = MAX_HISTORY_CHARS,
): ChatMessage[] {
  const recent = messages.filter((message) => message.text).slice(-maxMessages);
  let total = recent.reduce((sum, message) => sum + message.text.length, 0);
  const trimmed = [...recent];
  while (trimmed.length > 1 && total > maxChars) {
    const removed = trimmed.shift();
    total -= removed?.text.length ?? 0;
  }
  return trimmed;
}

export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.text }],
  }));
}

export interface ChatInput {
  message?: unknown;
  history?: unknown;
}

export function prepareChatPayload(input: ChatInput):
  | { ok: true; message: string; history: ChatMessage[]; contents: GeminiContent[] }
  | { ok: false; status: number; error: string } {
  const message = sanitizeText(input.message);
  if (!message) {
    return { ok: false, status: 400, error: "A message is required." };
  }
  if (typeof input.message === "string" && input.message.trim().length > MAX_MESSAGE_CHARS) {
    return { ok: false, status: 413, error: "That message is too long. Please shorten it and try again." };
  }

  const rawHistory = Array.isArray(input.history) ? input.history : [];
  const history: ChatMessage[] = [];
  for (const item of rawHistory) {
    if (!item || typeof item !== "object") {
      return { ok: false, status: 400, error: "Conversation history is invalid." };
    }
    const entry = item as { role?: unknown; text?: unknown };
    if (!isRole(entry.role)) {
      return { ok: false, status: 400, error: "Conversation history is invalid." };
    }
    const text = sanitizeText(entry.text);
    if (!text) continue;
    history.push(createMessage(entry.role, text, typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : undefined));
  }

  const trimmed = trimHistory(history);
  const contents = toGeminiContents([...trimmed, createMessage("user", message, "current")]);
  const serialized = JSON.stringify(contents);
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    return { ok: false, status: 413, error: "The conversation is too long. Clear the history and try again." };
  }
  return { ok: true, message, history: trimmed, contents };
}
