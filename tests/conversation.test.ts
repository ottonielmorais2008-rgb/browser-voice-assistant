import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  SYSTEM_PROMPT,
  appendMessage,
  prepareChatPayload,
  sanitizeText,
  toGeminiContents,
  trimHistory,
  type ChatMessage,
} from "../src/lib/conversation.js";

function msg(role: ChatMessage["role"], text: string, id = text): ChatMessage {
  return { id, role, text };
}

describe("sanitizeText", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeText("  hello   world\n\n ")).toBe("hello world");
    expect(sanitizeText(42)).toBe("");
    expect(sanitizeText("   ")).toBe("");
  });

  it("caps message length", () => {
    const long = "a".repeat(MAX_MESSAGE_CHARS + 25);
    expect(sanitizeText(long).length).toBe(MAX_MESSAGE_CHARS);
  });
});

describe("history and prompt building", () => {
  it("appends non-empty messages and skips blanks", () => {
    const next = appendMessage([], "user", "  Hello  ");
    expect(next).toHaveLength(1);
    expect(next[0]?.role).toBe("user");
    expect(next[0]?.text).toBe("Hello");
    expect(appendMessage(next, "assistant", "   ")).toEqual(next);
  });

  it("keeps only the most recent history messages", () => {
    const history = Array.from({ length: 12 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `m${i}`));
    const trimmed = trimHistory(history);
    expect(trimmed).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(trimmed[0]?.text).toBe("m4");
    expect(trimmed.at(-1)?.text).toBe("m11");
  });

  it("drops older messages when the character budget is exceeded", () => {
    const history = [msg("user", "a".repeat(4000), "a"), msg("assistant", "b".repeat(4000), "b"), msg("user", "short", "c")];
    const trimmed = trimHistory(history, 8, 5000);
    expect(trimmed.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("maps assistant turns to Gemini model contents", () => {
    const contents = toGeminiContents([msg("user", "Hi"), msg("assistant", "Hello")]);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "Hi" }] },
      { role: "model", parts: [{ text: "Hello" }] },
    ]);
  });

  it("keeps a system prompt that asks for short spoken answers", () => {
    expect(SYSTEM_PROMPT).toMatch(/read aloud/i);
    expect(SYSTEM_PROMPT).toMatch(/short/i);
    expect(SYSTEM_PROMPT).not.toMatch(/school|lisbon|course/i);
  });
});

describe("prepareChatPayload", () => {
  it("accepts a message and trims prior history", () => {
    const prepared = prepareChatPayload({
      message: "What time is it?",
      history: [
        { role: "user", text: "Hello" },
        { role: "assistant", text: "Hi there" },
      ],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.message).toBe("What time is it?");
    expect(prepared.history).toHaveLength(2);
    expect(prepared.contents.at(-1)).toEqual({ role: "user", parts: [{ text: "What time is it?" }] });
  });

  it("rejects a missing or blank message", () => {
    expect(prepareChatPayload({}).ok).toBe(false);
    expect(prepareChatPayload({ message: "   " }).ok).toBe(false);
    const empty = prepareChatPayload({ message: "" });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.status).toBe(400);
  });

  it("rejects a message that is over the length limit", () => {
    const prepared = prepareChatPayload({ message: "x".repeat(MAX_MESSAGE_CHARS + 1) });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.status).toBe(413);
  });

  it("rejects history entries with invalid roles", () => {
    const prepared = prepareChatPayload({
      message: "Hi",
      history: [{ role: "system", text: "nope" }],
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.status).toBe(400);
    expect(prepared.error).toMatch(/history/i);
  });
});
