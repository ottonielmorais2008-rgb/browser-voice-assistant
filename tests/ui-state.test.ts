import { describe, expect, it } from "vitest";
import { describeHttpError, describeNetworkError, SPEECH_FALLBACK_NOTICE } from "../src/lib/errors.js";
import { allow, clientIp, resetRateLimit } from "../src/lib/rate-limit.js";
import { canUseTextFallback, chromeNote, micButtonLabel, speechFallbackNotice, statusLabel } from "../src/lib/ui-state.js";

describe("UI status labels", () => {
  it("describes listening, thinking, speaking and idle states", () => {
    expect(statusLabel("listening", true)).toBe("Listening…");
    expect(statusLabel("thinking", true)).toBe("Thinking…");
    expect(statusLabel("speaking", true)).toBe("Speaking…");
    expect(statusLabel("idle", true)).toBe("Ready to listen");
    expect(statusLabel("idle", false)).toBe("Type a question to begin");
  });

  it("labels the microphone button for each state", () => {
    expect(micButtonLabel("idle", true)).toBe("Start listening");
    expect(micButtonLabel("listening", true)).toBe("Stop listening");
    expect(micButtonLabel("thinking", true)).toBe("Waiting for a reply");
    expect(micButtonLabel("idle", false)).toBe("Voice input unavailable");
  });

  it("always offers a text fallback and mentions Chrome in the notice", () => {
    expect(canUseTextFallback()).toBe(true);
    expect(chromeNote()).toBe("Works best in Chrome.");
    expect(speechFallbackNotice()).toBe(SPEECH_FALLBACK_NOTICE);
    expect(speechFallbackNotice()).toMatch(/Chrome/);
    expect(speechFallbackNotice()).toMatch(/type/i);
  });
});

describe("HTTP error copy", () => {
  it("explains rate limits, oversized input, missing config and failures", () => {
    expect(describeHttpError(429)).toMatch(/wait a minute/i);
    expect(describeHttpError(413)).toMatch(/too long/i);
    expect(describeHttpError(503)).toMatch(/not configured/i);
    expect(describeHttpError(502)).toMatch(/could not reply/i);
    expect(describeHttpError(0)).toMatch(/connection/i);
    expect(describeHttpError(400, "A message is required.")).toBe("A message is required.");
    expect(describeNetworkError()).toMatch(/connection/i);
  });
});

describe("rate limiter", () => {
  it("allows a burst and then blocks until the window passes", () => {
    resetRateLimit();
    const now = 1_000_000;
    expect(allow("ip", 2, 1_000, now)).toBe(true);
    expect(allow("ip", 2, 1_000, now + 10)).toBe(true);
    expect(allow("ip", 2, 1_000, now + 20)).toBe(false);
    expect(allow("ip", 2, 1_000, now + 1_001)).toBe(true);
  });

  it("reads the client IP from forwarding headers", () => {
    expect(clientIp({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toBe("1.1.1.1");
    expect(clientIp({ "x-real-ip": "8.8.8.8" })).toBe("8.8.8.8");
    expect(clientIp({}, "fallback")).toBe("fallback");
  });
});
