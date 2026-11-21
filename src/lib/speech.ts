export interface SpeechAlternativeLike {
  transcript?: string;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: SpeechAlternativeLike;
  length: number;
}

export interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorLike {
  error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechHost {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
  speechSynthesis?: Pick<SpeechSynthesis, "getVoices" | "cancel" | "speak" | "paused" | "speaking">;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

export function getSpeechRecognitionCtor(target: SpeechHost = globalThis as SpeechHost): SpeechRecognitionCtor | undefined {
  return target.SpeechRecognition ?? target.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(target: SpeechHost = globalThis as SpeechHost): boolean {
  return Boolean(getSpeechRecognitionCtor(target));
}

export function isSpeechSynthesisSupported(target: SpeechHost = globalThis as SpeechHost): boolean {
  return Boolean(target.speechSynthesis && target.SpeechSynthesisUtterance);
}

export function extractTranscript(event: SpeechRecognitionEventLike): { interim: string; final: string } {
  let interim = "";
  let finalText = "";
  const results = event.results;
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const piece = result[0]?.transcript ?? "";
    if (result.isFinal) finalText += piece;
    else interim += piece;
  }
  return { interim: interim.replace(/\s+/g, " ").trim(), final: finalText.replace(/\s+/g, " ").trim() };
}

export const MIC_DENIED = "Microphone access was denied. Allow the microphone in your browser settings and try again.";
export const NO_SPEECH = "I didn't catch that. Try again, or type your question.";
export const NO_MICROPHONE = "No microphone was found. Connect a microphone or type your question.";
export const REC_NETWORK = "Speech recognition lost its network connection. Check your connection and try again.";
export const REC_UNSUPPORTED = "Voice input is not supported in this browser. It works best in Chrome. You can type instead.";
export const REC_GENERIC = "Speech recognition failed. You can type your question instead.";

export function recognitionErrorMessage(error: string): string | null {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return MIC_DENIED;
    case "no-speech":
      return NO_SPEECH;
    case "audio-capture":
      return NO_MICROPHONE;
    case "network":
      return REC_NETWORK;
    case "aborted":
      return null;
    default:
      return REC_GENERIC;
  }
}

export function createRecognizer(
  ctor: SpeechRecognitionCtor,
  options: { lang?: string; continuous?: boolean } = {},
): SpeechRecognitionLike {
  const recognition = new ctor();
  recognition.lang = options.lang ?? "en-US";
  recognition.interimResults = true;
  recognition.continuous = options.continuous ?? false;
  recognition.maxAlternatives = 1;
  return recognition;
}

export interface SpeakOptions {
  voice?: SpeechSynthesisVoice;
  rate?: number;
  lang?: string;
  onend?: () => void;
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1.6, Math.max(0.6, rate));
}

export function listVoices(synth: Pick<SpeechSynthesis, "getVoices"> | undefined = (globalThis as SpeechHost).speechSynthesis): SpeechSynthesisVoice[] {
  if (!synth) return [];
  return synth.getVoices();
}

export function preferVoice(voices: SpeechSynthesisVoice[], langPrefix = "en"): SpeechSynthesisVoice | undefined {
  const local = voices.find((voice) => voice.lang.toLowerCase().startsWith(langPrefix) && voice.localService);
  if (local) return local;
  return voices.find((voice) => voice.lang.toLowerCase().startsWith(langPrefix)) ?? voices[0];
}

export function speak(
  text: string,
  options: SpeakOptions = {},
  target: SpeechHost = globalThis as SpeechHost,
): SpeechSynthesisUtterance | null {
  const trimmed = text.trim();
  if (!trimmed || !target.speechSynthesis || !target.SpeechSynthesisUtterance) return null;
  target.speechSynthesis.cancel();
  const utterance = new target.SpeechSynthesisUtterance(trimmed);
  utterance.rate = clampRate(options.rate ?? 1);
  if (options.voice) utterance.voice = options.voice;
  if (options.lang) utterance.lang = options.lang;
  else if (options.voice?.lang) utterance.lang = options.voice.lang;
  const finish = () => options.onend?.();
  utterance.onend = finish;
  utterance.onerror = finish;
  target.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking(target: SpeechHost = globalThis as SpeechHost): void {
  target.speechSynthesis?.cancel();
}

export function voiceLabel(voice: SpeechSynthesisVoice): string {
  const tag = voice.localService ? "local" : "remote";
  return `${voice.name} (${voice.lang}, ${tag})`;
}
