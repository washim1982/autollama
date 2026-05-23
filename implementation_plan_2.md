# Implementation Plan - Dedicated Inference Chat Page

This plan details the design and implementation of a dedicated, high-fidelity Inference Chat Page in AutoLLAMA. The page will provide a model chat playground featuring system prompts, model parameter tuning, message history management, and real-time streaming token generation.

## User Review Required

> [!IMPORTANT]
> The chat interface will use real-time token streaming via fetch and standard SSE (`text/event-stream`) parsing in React to create a smooth, modern typewriter effect. It will connect to the active model server running on the API Gateway proxy port.

## Proposed Changes

### Frontend State Management

#### [MODIFY] [store.ts](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src/store.ts)
- Update `DashboardState['activeTab']` to include `'inference'`.
- Set `'inference'` as the default tab (or keep `'server'` as default, adding `'inference'` as a key navigation option).

### React UI & Chat Interface

#### [MODIFY] [App.tsx](file:///c:/Users/shahl/workspace/python/AUTOLLAMA/autollama/src/App.tsx)
- Import `MessageSquare` and `Bot` icons from `lucide-react` for navigation.
- Add an "Inference Chat" navigation item in the Sidebar.
- Implement the `activeTab === 'inference'` view:
  - **Left Sidebar**: Parameter Configuration panel.
    - System Prompt textbox.
    - Temperature slider (`0.1` - `1.5`).
    - Max Tokens slider (`128` - `4096`).
    - Top P slider (`0.0` - `1.0`).
    - Clear chat history button.
  - **Main Area**: Chat Interface.
    - **Header**: Active model name, connection port status.
    - **Message Stream**: List of message bubbles (User, Assistant, System).
      - Style Assistant bubbles with a premium bot avatar/background.
      - Add code block styling and syntax scannability for Markdown-style responses.
    - **Input Dock**: Bottom fixed text input with send button (supporting `Enter` to submit and `Shift + Enter` for new lines) and streaming generation status.

## Verification Plan

### Automated Tests
- Run `npm run build` or `npx tsc --noEmit` to verify type safety.

### Manual Verification
- Deploy a model profile.
- Navigate to the **Inference Chat** tab.
- Set a System Prompt (e.g., "You are a poetic assistant").
- Submit a chat query and verify that tokens stream in real-time.
- Verify that clearing chat works and that parameter changes affect generation.
