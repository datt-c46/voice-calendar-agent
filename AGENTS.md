# Voice Calendar Agent

## Project

Desktop Voice Agent for Google Calendar.

## Stack

- Electron
- React
- TypeScript
- Vite
- pnpm

## Architecture

- React Renderer handles UI.
- Electron Main Process handles privileged operations.
- Preload exposes a minimal IPC API.
- Google Calendar integration must run outside the renderer.
- Secrets must never be exposed to React renderer code.

## Coding Rules

- Use TypeScript.
- Prefer small modules.
- Avoid any unless necessary.
- Keep business logic outside React components.
- Use interfaces for external services.
- Use async/await.
- Validate external data.
- Add error handling for IPC and API calls.

## Voice Architecture

Microphone
-> VAD
-> STT
-> Intent/Entity Extraction
-> Calendar Service
-> TTS

## AI Architecture

AI providers must be replaceable.

Use interfaces such as:

- SpeechToText
- LanguageModel
- TextToSpeech

## Calendar Architecture

Google Calendar operations must be isolated inside a calendar service.

## Development Strategy

Build the MVP incrementally.

Do not implement:

- wake word
- long-term memory
- streaming
- background listening

until the basic Calendar CRUD flow works.
