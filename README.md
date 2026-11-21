# Browser Voice Assistant

Speak or type a question in the browser. A short reply from Gemini is read aloud with the Web Speech API.

**Live demo:** https://browser-voice-assistant.vercel.app

Works best in Chrome. Firefox and some other browsers do not support speech recognition; the text box still works there.

## Features

- Push-to-talk or click the microphone to dictate a question (`SpeechRecognition` / `webkitSpeechRecognition`)
- Gemini replies through a Vercel serverless function; only the transcript is sent
- Short conversation history is included so follow-up questions keep context
- Replies are spoken with `speechSynthesis`, with a voice picker, speaking rate, and a stop button
- Text input is always available as a fallback when the microphone is missing or unsupported
- Clear errors for a denied microphone, an unsupported browser, API failures and rate limits

## Tech stack

- [Vite](https://vite.dev) + [React](https://react.dev) + TypeScript
- Web Speech API for recognition and speech synthesis
- Gemini (`gemini-3.5-flash-lite` by default) on a Vercel serverless function
- Vitest unit tests (API handler, prompt and history building, speech feature detection, UI states)
- GitHub Actions CI (lint, type check, tests, build) with no secrets
- Deployed on [Vercel](https://vercel.com)

## How it works

1. The browser turns speech into text, or you type the question.
2. The app posts the new message and a short history to `/api/chat`.
3. The server checks the payload size, applies a simple per-IP rate limit, and calls Gemini with a system prompt that asks for concise, speakable answers.
4. The reply is shown in the conversation and, if speech synthesis is available, read aloud.

The Gemini API key lives only in Vercel environment variables (`GEMINI_API_KEY`) and is never committed.

## Running it yourself

Requires Node.js 20.9+.

```bash
npm install
npm test
cp .env.example .env
# Set GEMINI_API_KEY in .env — never commit the real key
npm run dev
```

The Vite dev server also serves `/api/chat`. Leave the key unset if you only want to inspect the interface; sending a message will then report that the assistant is not configured.

## Browser support

| Capability | Typical support |
|---|---|
| Speech recognition | Chrome, Edge and other Chromium browsers. Not available in Firefox. Safari support varies. |
| Speech synthesis | Most modern browsers |
| Text input | All modern browsers |

Microphone permission is required for voice input. If it is blocked, the app explains how to continue by typing.

## License

[MIT](LICENSE)
