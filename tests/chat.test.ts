import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_LIMIT,
  DEFAULT_MODEL,
  callGemini,
  getGeminiApiKey,
  getModelId,
  handleChatHttp,
  requestChat,
} from "../src/lib/chat.js";
import { SYSTEM_PROMPT, type GeminiContent } from "../src/lib/conversation.js";
import type { HttpResponse } from "../src/lib/http.js";
import { resetRateLimit } from "../src/lib/rate-limit.js";

afterEach(() => {
  resetRateLimit();
});

function collect() {
  let status = 0;
  let body: unknown;
  const res: HttpResponse = {
    status(code) {
      status = code;
      return res;
    },
    json(value) {
      body = value;
    },
    setHeader() {},
  };
  return { res, read: () => ({ status, body: body as Record<string, unknown> }) };
}

const validBody = { message: "Hello there", history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello" }] };

describe("handleChatHttp", () => {
  it("answers OPTIONS with 204", async () => {
    const box = collect();
    await handleChatHttp({ method: "OPTIONS" }, box.res);
    expect(box.read().status).toBe(204);
  });

  it("rejects methods other than POST", async () => {
    const box = collect();
    await handleChatHttp({ method: "GET" }, box.res);
    const { status, body } = box.read();
    expect(status).toBe(405);
    expect(body.error).toMatch(/POST/);
  });

  it("rejects a body that is too large", async () => {
    const box = collect();
    await handleChatHttp(
      { method: "POST", headers: { "content-length": "20000" }, body: "{}" },
      box.res,
      { env: { GEMINI_API_KEY: "test-key" } },
    );
    expect(box.read().status).toBe(413);
  });

  it("returns 503 when no API key is configured and does not mention any key", async () => {
    const box = collect();
    await handleChatHttp(
      { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: validBody },
      box.res,
      { env: {} },
    );
    const { status, body } = box.read();
    expect(status).toBe(503);
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/aiza|aq\.|api[_-]?key|gemini_key|test-key/);
  });

  it("rate-limits chat requests from the same client", async () => {
    let limited = 0;
    for (let i = 0; i < CHAT_LIMIT + 3; i += 1) {
      const box = collect();
      await handleChatHttp(
        { method: "POST", headers: { "x-forwarded-for": "2.2.2.2" }, body: validBody },
        box.res,
        { env: { GEMINI_API_KEY: "test-key" }, generate: async () => "ok" },
      );
      if (box.read().status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("rejects invalid JSON", async () => {
    const box = collect();
    await handleChatHttp(
      { method: "POST", headers: { "x-forwarded-for": "4.4.4.4" }, body: "{not-json" },
      box.res,
      { env: { GEMINI_API_KEY: "test-key" } },
    );
    const { status, body } = box.read();
    expect(status).toBe(400);
    expect(body.error).toMatch(/JSON/i);
  });

  it("rejects a missing message", async () => {
    const box = collect();
    await handleChatHttp(
      { method: "POST", headers: { "x-forwarded-for": "5.5.5.5" }, body: { history: [] } },
      box.res,
      { env: { GEMINI_API_KEY: "test-key" } },
    );
    expect(box.read().status).toBe(400);
  });

  it("returns a reply and the configured model", async () => {
    const box = collect();
    const generate = vi.fn(async (contents: GeminiContent[], model: string, apiKey: string) => {
      expect(apiKey).toBe("test-key");
      expect(model).toBe(DEFAULT_MODEL);
      expect(contents.at(-1)?.parts[0]?.text).toBe("Hello there");
      return "Hi, I can hear you.";
    });
    await handleChatHttp(
      { method: "POST", headers: { "x-forwarded-for": "3.3.3.3" }, body: validBody },
      box.res,
      { env: { GEMINI_API_KEY: "test-key" }, generate },
    );
    const { status, body } = box.read();
    expect(status).toBe(200);
    expect(body.reply).toBe("Hi, I can hear you.");
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when generation fails, without leaking secrets", async () => {
    const box = collect();
    await handleChatHttp(
      { method: "POST", headers: { "x-forwarded-for": "6.6.6.6" }, body: validBody },
      box.res,
      {
        env: { GEMINI_API_KEY: "super-secret-key" },
        generate: async () => {
          throw new Error("super-secret-key failed");
        },
      },
    );
    const { status, body } = box.read();
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("super-secret-key");
  });

  it("maps an upstream rate limit to HTTP 429", async () => {
    const box = collect();
    await handleChatHttp(
      { method: "POST", headers: { "x-forwarded-for": "7.7.7.7" }, body: validBody },
      box.res,
      {
        env: { GEMINI_API_KEY: "test-key" },
        generate: async () => {
          throw new Error("RATE_LIMIT");
        },
      },
    );
    expect(box.read().status).toBe(429);
  });
});

describe("Gemini helpers", () => {
  it("reads the key from known env names and ignores blanks", () => {
    expect(getGeminiApiKey({})).toBeUndefined();
    expect(getGeminiApiKey({ GEMINI_API_KEY: "  " })).toBeUndefined();
    expect(getGeminiApiKey({ GEMINI_API_KEY: " abc " })).toBe("abc");
    expect(getGeminiApiKey({ GOOGLE_GENERATIVE_AI_API_KEY: "alt" })).toBe("alt");
  });

  it("uses the default model unless GOOGLE_MODEL is set", () => {
    expect(getModelId({})).toBe(DEFAULT_MODEL);
    expect(getModelId({ GOOGLE_MODEL: "gemini-2.5-flash" })).toBe("gemini-2.5-flash");
  });

  it("posts contents to Gemini and returns the text", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain(`models/${DEFAULT_MODEL}:generateContent`);
      const payload = JSON.parse(String(init?.body)) as {
        systemInstruction: { parts: { text: string }[] };
        contents: GeminiContent[];
      };
      expect(payload.systemInstruction.parts[0]?.text).toBe(SYSTEM_PROMPT);
      expect(payload.contents[0]?.parts[0]?.text).toBe("Hi");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-api-key")).toBe("test-key");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const text = await callGemini([{ role: "user", parts: [{ text: "Hi" }] }], DEFAULT_MODEL, "test-key", fetchFn);
    expect(text).toBe("Hello from Gemini");
  });

  it("throws a generic error on a failed or empty Gemini response and never includes the key", async () => {
    const failed = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(callGemini([], DEFAULT_MODEL, "secret-key", failed)).rejects.toThrow(/unavailable/i);
    const empty = vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(callGemini([], DEFAULT_MODEL, "secret-key", empty)).rejects.toThrow(/empty/i);
    const limited = vi.fn(async () => new Response("slow", { status: 429 })) as unknown as typeof fetch;
    await expect(callGemini([], DEFAULT_MODEL, "secret-key", limited)).rejects.toThrow("RATE_LIMIT");
  });
});

describe("requestChat client", () => {
  it("returns the reply from a successful API call", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ reply: "Sure.", model: DEFAULT_MODEL }), { status: 200 })) as unknown as typeof fetch;
    const result = await requestChat("Hello", [], fetchFn);
    expect(result).toEqual({ ok: true, status: 200, reply: "Sure.", model: DEFAULT_MODEL });
  });

  it("maps HTTP errors and network failures to clear messages", async () => {
    const limited = vi.fn(async () => new Response(JSON.stringify({ error: "ignored" }), { status: 429 })) as unknown as typeof fetch;
    const limitedResult = await requestChat("Hello", [], limited);
    expect(limitedResult.ok).toBe(false);
    expect(limitedResult.error).toMatch(/wait a minute/i);

    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const downResult = await requestChat("Hello", [], down);
    expect(downResult.status).toBe(0);
    expect(downResult.error).toMatch(/connection/i);
  });
});
