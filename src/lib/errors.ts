export function describeHttpError(status: number, fallback?: string): string {
  if (status === 429) return "Too many requests. Please wait a minute and try again.";
  if (status === 413) return "That message is too long. Please shorten it and try again.";
  if (status === 503) return "The assistant is not configured on this deployment.";
  if (status === 502 || status === 500) return "The assistant could not reply. Please try again in a moment.";
  if (status === 405) return "The assistant could not be reached. Please try again.";
  if (status === 0 || status === 408) return "The request failed. Check your connection and try again.";
  if (fallback && fallback.trim()) return fallback.trim();
  return "The assistant could not reply. Please try again in a moment.";
}

export function describeNetworkError(): string {
  return "The request failed. Check your connection and try again.";
}

export const CHROME_NOTE = "Works best in Chrome.";
export const SPEECH_FALLBACK_NOTICE =
  "Voice input is not supported in this browser. It works best in Chrome. You can type your question instead.";
