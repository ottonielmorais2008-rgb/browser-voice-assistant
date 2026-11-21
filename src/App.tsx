import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { requestChat } from "./lib/chat";
import { appendMessage, type ChatMessage } from "./lib/conversation";
import { SPEECH_FALLBACK_NOTICE } from "./lib/errors";
import {
  clampRate,
  createRecognizer,
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
  type SpeechRecognitionLike,
} from "./lib/speech";
import { micButtonLabel, statusLabel, type AssistantStatus } from "./lib/ui-state";

const HOLD_MS = 180;

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speechSupported] = useState(() => isSpeechRecognitionSupported());
  const [synthesisSupported] = useState(() => isSpeechSynthesisSupported());

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdActiveRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const selectedVoice = voices.find((voice) => voice.voiceURI === voiceURI);

  const loadVoices = useCallback(() => {
    const next = listVoices();
    setVoices(next);
    setVoiceURI((current) => {
      if (current && next.some((voice) => voice.voiceURI === current)) return current;
      return preferVoice(next)?.voiceURI ?? "";
    });
  }, []);

  useEffect(() => {
    if (!synthesisSupported) return;
    loadVoices();
    const synth = window.speechSynthesis;
    synth.addEventListener("voiceschanged", loadVoices);
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, [loadVoices, synthesisSupported]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, interim, status]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  const speakReply = useCallback(
    (text: string) => {
      if (!autoSpeak || !synthesisSupported) {
        setStatus("idle");
        return;
      }
      setStatus("speaking");
      speak(
        text,
        {
          voice: selectedVoice,
          rate,
          onend: () => setStatus((current) => (current === "speaking" ? "idle" : current)),
        },
      );
    },
    [autoSpeak, rate, selectedVoice, synthesisSupported],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (!trimmed) return;
      stopSpeaking();
      setError(null);
      setInterim("");
      setDraft("");
      const history = messages;
      setMessages((current) => appendMessage(current, "user", trimmed));
      setStatus("thinking");
      const result = await requestChat(
        trimmed,
        history.map(({ role, text: body }) => ({ role, text: body })),
      );
      if (!result.ok || !result.reply) {
        setError(result.error ?? "The assistant could not reply. Please try again in a moment.");
        setStatus("idle");
        return;
      }
      setMessages((current) => appendMessage(current, "assistant", result.reply!));
      speakReply(result.reply);
    },
    [messages, speakReply],
  );

  const stopListening = useCallback((submit = true) => {
    listeningRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      /* already stopped */
    }
    setInterim((current) => {
      const leftover = current;
      if (submit && leftover) void send(leftover);
      else setStatus((statusNow) => (statusNow === "listening" ? "idle" : statusNow));
      return "";
    });
  }, [send]);

  const startListening = useCallback(() => {
    if (!speechSupported || listeningRef.current || status === "thinking") return;
    const ctor = getSpeechRecognitionCtor();
    if (!ctor) {
      setError(SPEECH_FALLBACK_NOTICE);
      return;
    }
    setError(null);
    stopSpeaking();
    const recognition = createRecognizer(ctor);
    recognitionRef.current = recognition;
    listeningRef.current = true;
    setStatus("listening");
    setInterim("");

    recognition.onresult = (event) => {
      const { interim: nextInterim, final: nextFinal } = extractTranscript(event);
      if (nextFinal) {
        listeningRef.current = false;
        setInterim("");
        try {
          recognition.stop();
        } catch {
          /* already stopping */
        }
        void send(nextFinal);
        return;
      }
      setInterim(nextInterim);
    };

    recognition.onerror = (event) => {
      const message = recognitionErrorMessage(event.error);
      if (message) setError(message);
      listeningRef.current = false;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (listeningRef.current) {
        listeningRef.current = false;
        setStatus((current) => (current === "listening" ? "idle" : current));
      }
    };

    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      setStatus("idle");
      setError(SPEECH_FALLBACK_NOTICE);
    }
  }, [send, speechSupported, status]);

  function onMicPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!speechSupported || status === "thinking") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    holdActiveRef.current = false;
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      holdActiveRef.current = true;
      if (!listeningRef.current) startListening();
    }, HOLD_MS);
  }

  function onMicPointerUp() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      if (listeningRef.current) stopListening(true);
      return;
    }
    if (listeningRef.current) stopListening(true);
    else startListening();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (listeningRef.current) stopListening(false);
    void send(draft);
  }

  function onStopSpeaking() {
    stopSpeaking();
    setStatus((current) => (current === "speaking" ? "idle" : current));
  }

  function onClear() {
    if (listeningRef.current) stopListening(false);
    stopSpeaking();
    setMessages([]);
    setDraft("");
    setInterim("");
    setError(null);
    setStatus("idle");
  }

  const busy = status === "thinking";

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Browser voice · Gemini</p>
            <h1>Voice Assistant</h1>
          </div>
        </div>
        <p className="chrome-note">Works best in Chrome</p>
      </header>

      <p className="lede">
        Click or hold the microphone to talk, or type a question. A short Gemini reply is read aloud in the
        browser. Speech recognition works best in Chrome; Firefox and some other browsers can use the text box
        instead.
      </p>

      {!speechSupported && (
        <aside className="banner warn" role="status">
          {SPEECH_FALLBACK_NOTICE}
        </aside>
      )}

      {error && (
        <aside className="banner error" role="alert">
          {error}
        </aside>
      )}

      <section className="stage" aria-label="Conversation">
        <span className="crop tl" aria-hidden="true" />
        <span className="crop tr" aria-hidden="true" />
        <span className="crop bl" aria-hidden="true" />
        <span className="crop br" aria-hidden="true" />

        <div className="stage-head">
          <div>
            <p className="eyebrow">{statusLabel(status, speechSupported)}</p>
            <h2>Conversation</h2>
          </div>
          <button type="button" className="ghost" onClick={onClear} disabled={messages.length === 0 && !draft}>
            Clear
          </button>
        </div>

        <div className="thread" ref={threadRef} role="log" aria-live="polite">
          {messages.length === 0 && !interim && status !== "listening" && (
            <p className="empty">
              {speechSupported
                ? "Click or hold the microphone, or type a question to begin."
                : "Type a question to begin."}
            </p>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`bubble bubble-${message.role}`}>
              <p className="bubble-role">{message.role === "user" ? "You" : "Assistant"}</p>
              <p className="bubble-text">{message.text}</p>
            </article>
          ))}
          {interim && (
            <article className="bubble bubble-user is-interim">
              <p className="bubble-role">You</p>
              <p className="bubble-text">{interim}</p>
            </article>
          )}
          {status === "thinking" && (
            <article className="bubble bubble-assistant is-pending">
              <p className="bubble-role">Assistant</p>
              <p className="bubble-text">Thinking…</p>
            </article>
          )}
        </div>

        <div className="composer">
          <button
            type="button"
            className={`mic ${status === "listening" ? "is-live" : ""} ${busy ? "is-busy" : ""}`}
            onPointerDown={onMicPointerDown}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerUp}
            disabled={!speechSupported || busy}
            aria-pressed={status === "listening"}
            aria-label={micButtonLabel(status, speechSupported)}
          >
            <span className="mic-ring" aria-hidden="true" />
            <MicIcon />
          </button>

          <form className="text-form" onSubmit={onSubmit}>
            <label htmlFor="draft" className="sr-only">
              Type a question
            </label>
            <input
              id="draft"
              name="draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={speechSupported ? "Or type a question" : "Type a question"}
              autoComplete="off"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </div>

        <div className="controls">
          <label className="control">
            <span>Voice</span>
            <select
              value={voiceURI}
              onChange={(event) => setVoiceURI(event.target.value)}
              disabled={!synthesisSupported || voices.length === 0}
            >
              {voices.length === 0 && <option value="">No voices available</option>}
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voiceLabel(voice)}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            <span>Rate {rate.toFixed(2)}</span>
            <input
              type="range"
              min="0.7"
              max="1.5"
              step="0.05"
              value={rate}
              onChange={(event) => setRate(clampRate(Number(event.target.value)))}
              disabled={!synthesisSupported}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(event) => setAutoSpeak(event.target.checked)}
              disabled={!synthesisSupported}
            />
            <span>Speak replies</span>
          </label>
          <button type="button" className="ghost" onClick={onStopSpeaking} disabled={status !== "speaking"}>
            Stop speaking
          </button>
        </div>
      </section>

      <footer className="foot">
        <p>Replies are generated by Gemini. Speech stays in the browser; only the transcript is sent to the API.</p>
        <p>Push-to-talk or click the mic. Text input is always available.</p>
      </footer>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="10" rx="3" fill="currentColor" />
      <path
        d="M7 11.5a5 5 0 0 0 10 0M12 16.5v3.2M8.5 19.7h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  );
}
