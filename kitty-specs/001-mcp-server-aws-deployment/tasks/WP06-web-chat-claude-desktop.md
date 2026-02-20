---
work_package_id: WP06
title: Web Chat UI & Claude Desktop Config
lane: "done"
dependencies: []
base_branch: 001-mcp-server-aws-deployment-WP04
base_commit: 89d90a6e924f9ad2b1048b7eed7f5ab25b55fbeb
created_at: '2026-02-19T01:59:58.060040+00:00'
subtasks: [T028, T029, T030, T031, T032]
shell_pid: "55304"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-12'
  event: Created
  agent: spec-kitty.tasks
---

# WP06: Web Chat UI & Claude Desktop Config

**Implement with**: `spec-kitty implement WP06 --base WP04`

## Objective

Build a lightweight web chat UI for mobile/AFK access to Claude with MCP tools, and document Claude Desktop MCP client configuration. After this work package, team members can access all MCP capabilities from a phone browser or desktop Claude client.

## Context

- **Dependencies**: WP01 (containers), WP04 (health endpoints for status display)
- **Users**: Internal team — primary use case is checking on projects from a phone
- **Stack**: Vanilla HTML/CSS/JS — no frameworks, no build tools, keep it minimal
- **URL**: `https://ai.example.com/chat`
- **Reference**: See `spec.md` Scenario 2 (Mobile/AFK Access) and `plan.md` Project Structure (web-chat/)

## Subtasks

### T028: Build Lightweight Web Chat UI

**Purpose**: Create a clean, minimal chat interface that works in any browser.

**Steps**:
1. Create `web-chat/index.html`:
   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Joyus AI — Chat</title>
     <link rel="stylesheet" href="src/styles.css">
   </head>
   <body>
     <div id="app">
       <header>
         <h1>Joyus AI</h1>
         <div id="status-indicator" class="status"></div>
       </header>
       <main id="messages"></main>
       <footer>
         <form id="chat-form">
           <textarea id="input" placeholder="Ask anything..." rows="1"></textarea>
           <button type="submit">Send</button>
         </form>
       </footer>
     </div>
     <script src="src/chat.js"></script>
   </body>
   </html>
   ```

2. Design principles:
   - No build step — serve HTML/CSS/JS directly via nginx
   - Auto-resize textarea as user types
   - Scroll to bottom on new messages
   - Show typing indicator during API call
   - Display tool call results inline (e.g., Jira search results, Slack posts)
   - Support markdown rendering in responses (use a lightweight library or regex-based)
   - Status indicator shows green/yellow/red based on `/health` endpoint

3. Create `web-chat/src/styles.css`:
   - Dark theme (easier on eyes for mobile use)
   - Messages styled as chat bubbles (user right, assistant left)
   - Monospace font for code blocks
   - Smooth scrolling
   - Loading animation for assistant typing

**Files**:
- `web-chat/index.html` (new, ~40 lines)
- `web-chat/src/styles.css` (new, ~150 lines)

**Validation**:
- [ ] Page loads without errors in Chrome, Safari, Firefox
- [ ] Input textarea is functional and auto-resizes
- [ ] Messages display in chat bubble format
- [ ] Status indicator visible and updates based on health endpoint
- [ ] No framework dependencies (zero npm install needed to serve)

---

### T029: Integrate Claude API for Chat Completions

**Purpose**: Connect the chat UI to the Claude API, streaming responses back to the user.

**Steps**:
1. Create `web-chat/src/chat.js`:
   ```javascript
   const API_URL = '/api/chat';  // Proxied by nginx to platform:3001

   async function sendMessage(text) {
     const response = await fetch(API_URL, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${getToken()}`
       },
       body: JSON.stringify({ message: text })
     });

     // Handle streaming response
     const reader = response.body.getReader();
     const decoder = new TextDecoder();

     while (true) {
       const { done, value } = await reader.read();
       if (done) break;
       const chunk = decoder.decode(value);
       appendToCurrentMessage(chunk);
     }
   }
   ```

2. Create a server-side chat endpoint in the Platform container (`joyus-ai-mcp-server/src/` or new file):
   - POST `/api/chat` — accepts `{ message: string }`, calls Claude API with MCP tools attached
   - Streams response back via chunked transfer or Server-Sent Events (SSE)
   - Includes all MCP tools in the Claude API call so Claude can use Jira, Slack, etc.

3. Handle tool use in the response:
   - When Claude makes a tool call, execute it server-side
   - Return tool results as part of the streamed response
   - Display tool call name and result in the chat UI

4. Error handling:
   - Network errors: show retry button
   - API errors: display error message inline
   - Rate limiting: show "Please wait..." message

**Files**:
- `web-chat/src/chat.js` (new, ~150 lines)
- New chat endpoint in `joyus-ai-mcp-server/src/` (~100 lines)

**Validation**:
- [ ] Message sent and response received
- [ ] Response streams incrementally (not all-at-once)
- [ ] Tool calls execute and results display
- [ ] Error messages shown on failure
- [ ] Chat history maintained during session (in-memory, cleared on refresh)

**Edge Cases**:
- Long responses may take 30+ seconds — show progress indication
- Tool calls within tool calls (nested) — handle gracefully
- Claude API rate limits — backoff and retry
- CORS: nginx must allow the chat page origin to call `/api/chat`

---

### T030: Add Simple Token-Based Authentication

**Purpose**: Prevent unauthorized access to the web chat.

**Steps**:
1. Implement token-based auth for the chat endpoint:
   - Use `WEB_CHAT_TOKEN` environment variable (or reuse `MCP_BEARER_TOKEN`)
   - On first visit, show a simple login form asking for the token
   - Store token in `localStorage` after successful auth
   - Send token as `Authorization: Bearer <token>` header on all API calls

2. Server-side validation:
   ```javascript
   // In chat endpoint middleware
   const token = req.headers.authorization?.replace('Bearer ', '');
   if (token !== process.env.WEB_CHAT_TOKEN) {
     return res.status(401).json({ error: 'Unauthorized' });
   }
   ```

3. Login UI:
   - Simple form: token input + submit button
   - "Remember me" checkbox (uses localStorage)
   - Clear error on invalid token

**Files**:
- Updates to `web-chat/src/chat.js` (auth logic)
- Updates to `web-chat/index.html` (login form)
- Server-side auth middleware (~20 lines)

**Validation**:
- [ ] Cannot access chat without valid token
- [ ] Token stored in localStorage persists across refreshes
- [ ] Invalid token shows error message
- [ ] API calls include Authorization header
- [ ] Logout clears stored token

---

### T031: Ensure Responsive Design for Mobile Browsers

**Purpose**: The chat UI must be fully usable on iPhone and Android browsers.

**Steps**:
1. CSS considerations:
   - Viewport meta tag with `width=device-width, initial-scale=1.0`
   - Touch-friendly button sizes (minimum 44x44px tap targets)
   - Keyboard pushes content up (not over) on mobile
   - Safe area insets for notched phones:
     ```css
     body {
       padding-bottom: env(safe-area-inset-bottom);
     }
     ```
   - Full-height layout without unnecessary scrolling

2. Input handling:
   - Textarea auto-focuses on load (desktop only — avoid on mobile to prevent keyboard popup)
   - Enter key sends on desktop, Shift+Enter for newline
   - Send button always visible above keyboard on mobile
   - Prevent iOS zoom on input focus:
     ```css
     textarea { font-size: 16px; }  /* Prevents iOS auto-zoom */
     ```

3. Test on:
   - iPhone Safari (primary — Alex's use case)
   - Chrome Android
   - Desktop Chrome/Firefox/Safari

**Files**:
- Updates to `web-chat/src/styles.css` (responsive additions)
- Updates to `web-chat/index.html` (viewport meta, touch handling)

**Validation**:
- [ ] Chat usable on iPhone Safari (no horizontal scroll, keyboard doesn't obscure input)
- [ ] Chat usable on Chrome Android
- [ ] Touch targets are large enough (44px minimum)
- [ ] Text is readable without zooming
- [ ] Send button accessible above mobile keyboard

---

### T032: Configure Claude Desktop MCP Client Connection [P]

**Purpose**: Document how team members connect Claude Desktop to the deployed MCP server.

**Steps**:
1. Create `deploy/claude-desktop-config.md` with setup instructions:
   ```markdown
   # Claude Desktop MCP Configuration

   Add this to your Claude Desktop MCP config:

   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   ```json
   {
     "mcpServers": {
       "joyus-ai": {
         "url": "https://ai.example.com/mcp",
         "headers": {
           "Authorization": "Bearer <YOUR_MCP_BEARER_TOKEN>"
         }
       }
     }
   }
   ```

   ## Verify Connection

   1. Restart Claude Desktop
   2. Check the MCP indicator (bottom of chat window)
   3. Try: "Search Jira for recent bugs"
   4. You should see tool calls executing against the deployed server

   ## Troubleshooting

   - **Connection refused**: Check that `https://ai.example.com/health` returns 200
   - **401 Unauthorized**: Verify your bearer token matches MCP_BEARER_TOKEN
   - **Timeout**: MCP server may be restarting — wait 30 seconds and retry
   ```

2. Also update `quickstart.md` (already has basic config — verify it matches)

**Files**:
- `deploy/claude-desktop-config.md` (new, ~50 lines)
- Verify `quickstart.md` Claude Desktop section is accurate

**Validation**:
- [ ] Config JSON is valid and correct
- [ ] Instructions cover both macOS and Windows paths
- [ ] Troubleshooting section addresses common issues
- [ ] Bearer token placeholder clearly marked

## Definition of Done

- [ ] Web chat UI loads at `https://ai.example.com/chat`
- [ ] Can send message and receive Claude response with tool call results
- [ ] Token authentication prevents unauthorized access
- [ ] Chat works on iPhone Safari and Chrome Android
- [ ] Claude Desktop configuration documented with troubleshooting
- [ ] Claude Desktop connects and shows MCP tools available

## Risks

- **Claude API streaming**: May need specific CORS and Content-Type handling in nginx. Test early.
- **Mobile keyboard**: iOS and Android handle virtual keyboards differently. The viewport meta and CSS safe-area-inset approach should handle most cases.
- **Token security**: Bearer token in localStorage is acceptable for internal tool. Not suitable for public-facing deployment (Phase 3 would need proper auth).
- **Claude API costs**: Each web chat message consumes API credits. Consider adding a simple usage counter/warning.

## Activity Log

- 2026-02-19T02:01:34Z – unknown – shell_pid=55304 – lane=for_review – Web chat UI, Claude Desktop config
- 2026-02-19T02:01:43Z – unknown – shell_pid=55304 – lane=done – Review passed: web chat, auth, responsive CSS, Claude Desktop docs
