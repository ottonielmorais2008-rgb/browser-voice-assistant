import { describe, expect, it, vi } from "vitest";
import {
  MIC_DENIED,
  NO_MICROPHONE,
  NO_SPEECH,
  REC_NETWORK,
  clampRate,
  extractTranscript,
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  listVoices,
  preferVoice,
  recognitionErrorMessage,
  speak,
  stopSpeaking,
  voiceLabel,
  type SpeechHost,
  type SpeechRecognitionEventLike,
} from "../src/lib/speech.js";

function recognitionEvent(parts: { transcript: string; isFinal: boolean }[]): SpeechRecognitionEventLike {
  return {
    results: parts.map((part) => ({
      isFinal: part.isFinal,
      0: { transcript: part.transcript },
      length: 1,
    })),
  };
}

describe("speech feature detection", () => {
  it("detects the standard SpeechRecognition constructor", () => {
    const ctor = function SpeechRecognition() {};
    const host = { SpeechRecognition: ctor } as unknown as SpeechHost;
    expect(isSpeechRecognitionSupported(host)).toBe(true);
    expect(getSpeechRecognitionCtor(host)).toBe(ctor);
  });

  it("falls back to webkitSpeechRecognition", () => {
    const ctor = function webkitSpeechRecognition() {};
    const host = { webkitSpeechRecognition: ctor } as unknown as SpeechHost;
    expect(isSpeechRecognitionSupported(host)).toBe(true);
    expect(getSpeechRecognitionCtor(host)).toBe(ctor);
  });

  it("reports unsupported when neither constructor exists", () => {
    const host: SpeechHost = {};
    expect(isSpeechRecognitionSupported(host)).toBe(false);
    expect(getSpeechRecognitionCtor(host)).toBeUndefined();
  });

  it("detects speechSynthesis and the utterance constructor", () => {
    expect(isSpeechSynthesisSupported({})).toBe(false);
    expect(
      isSpeechSynthesisSupported({
        speechSynthesis: { getVoices: () => [], cancel() {}, speak() {}, paused: false, speaking: false },
        SpeechSynthesisUtterance: function SpeechSynthesisUtterance(this: void) {} as unknown as typeof SpeechSynthesisUtterance,
      }),
    ).toBe(true);
  });
});

describe("extractTranscript", () => {
  it("separates interim and final results", () => {
    const extracted = extractTranscript(
      recognitionEvent([
        { transcript: "Hello ", isFinal: true },
        { transcript: "there", isFinal: false },
      ]),
    );
    expect(extracted.final).toBe("Hello");
    expect(extracted.interim).toBe("there");
  });

  it("joins multiple final parts and trims whitespace", () => {
    const extracted = extractTranscript(
      recognitionEvent([
        { transcript: "  What  ", isFinal: true },
        { transcript: " time is it  ", isFinal: true },
      ]),
    );
    expect(extracted.final).toBe("What time is it");
    expect(extracted.interim).toBe("");
  });
});

describe("recognitionErrorMessage", () => {
  it("explains a denied microphone clearly", () => {
    expect(recognitionErrorMessage("not-allowed")).toBe(MIC_DENIED);
    expect(recognitionErrorMessage("service-not-allowed")).toBe(MIC_DENIED);
  });

  it("explains silence, a missing microphone and a network drop", () => {
    expect(recognitionErrorMessage("no-speech")).toBe(NO_SPEECH);
    expect(recognitionErrorMessage("audio-capture")).toBe(NO_MICROPHONE);
    expect(recognitionErrorMessage("network")).toBe(REC_NETWORK);
  });

  it("hides aborted errors and uses a generic fallback otherwise", () => {
    expect(recognitionErrorMessage("aborted")).toBeNull();
    expect(recognitionErrorMessage("audio-busy")).toMatch(/type your question/i);
  });
});

describe("speech synthesis helpers", () => {
  it("clamps the speaking rate to a comfortable range", () => {
    expect(clampRate(1)).toBe(1);
    expect(clampRate(0.2)).toBe(0.6);
    expect(clampRate(3)).toBe(1.6);
    expect(clampRate(Number.NaN)).toBe(1);
  });

  it("lists voices from the synthesis engine", () => {
    const voices = [{ name: "Zoe", lang: "en-US", localService: true, default: true, voiceURI: "zoe" }] as SpeechSynthesisVoice[];
    expect(listVoices({ getVoices: () => voices })).toEqual(voices);
    expect(listVoices(undefined)).toEqual([]);
  });

  it("prefers a local English voice and labels it", () => {
    const voices = [
      { name: "Remote", lang: "en-GB", localService: false, default: false, voiceURI: "r" },
      { name: "Local", lang: "en-US", localService: true, default: false, voiceURI: "l" },
      { name: "Other", lang: "pt-PT", localService: true, default: false, voiceURI: "o" },
    ] as SpeechSynthesisVoice[];
    const preferred = preferVoice(voices);
    expect(preferred?.name).toBe("Local");
    expect(voiceLabel(preferred!)).toBe("Local (en-US, local)");
    expect(voiceLabel(voices[0]!)).toContain("remote");
  });

  it("cancels current speech, then speaks at the requested rate", () => {
    const spoken: SpeechSynthesisUtterance[] = [];
    const cancel = vi.fn();
    class FakeUtterance {
      text: string;
      rate = 1;
      voice: SpeechSynthesisVoice | undefined;
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const host: SpeechHost = {
      SpeechSynthesisUtterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
      speechSynthesis: {
        getVoices: () => [],
        cancel,
        speak(utterance) {
          spoken.push(utterance);
        },
        paused: false,
        speaking: false,
      },
    };
    const voice = { name: "Zoe", lang: "en-US", localService: true, default: true, voiceURI: "zoe" } as SpeechSynthesisVoice;
    const utterance = speak("  Hello there  ", { voice, rate: 1.25 }, host);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(utterance?.text).toBe("Hello there");
    expect(utterance?.rate).toBe(1.25);
    expect(utterance?.voice).toBe(voice);
    expect(spoken).toHaveLength(1);
    expect(speak("   ", {}, host)).toBeNull();
    stopSpeaking(host);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
