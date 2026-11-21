import { CHROME_NOTE, SPEECH_FALLBACK_NOTICE } from "./errors.js";

export type AssistantStatus = "idle" | "listening" | "thinking" | "speaking";

export function statusLabel(status: AssistantStatus, speechSupported: boolean): string {
  switch (status) {
    case "listening":
      return "Listening…";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking…";
    default:
      return speechSupported ? "Ready to listen" : "Type a question to begin";
  }
}

export function micButtonLabel(status: AssistantStatus, speechSupported: boolean): string {
  if (!speechSupported) return "Voice input unavailable";
  if (status === "listening") return "Stop listening";
  if (status === "thinking") return "Waiting for a reply";
  return "Start listening";
}

export function speechFallbackNotice(): string {
  return SPEECH_FALLBACK_NOTICE;
}

export function chromeNote(): string {
  return CHROME_NOTE;
}

export function canUseTextFallback(): boolean {
  return true;
}
