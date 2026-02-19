/**
 * Joyus AI — Web Chat Client
 * Connects to the platform server's /api/chat endpoint.
 */

const API_URL = '/api/chat';
const HEALTH_URL = '/health';

// --- Auth ---

function getToken() {
  return localStorage.getItem('joyus-ai-token') || '';
}

function setToken(token, remember) {
  if (remember) {
    localStorage.setItem('joyus-ai-token', token);
  } else {
    sessionStorage.setItem('joyus-ai-token', token);
  }
}

function clearToken() {
  localStorage.removeItem('joyus-ai-token');
  sessionStorage.removeItem('joyus-ai-token');
}

// --- DOM ---

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const loginForm = document.getElementById('login-form');
const tokenInput = document.getElementById('token-input');
const rememberMe = document.getElementById('remember-me');
const loginError = document.getElementById('login-error');
const chatForm = document.getElementById('chat-form');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const messages = document.getElementById('messages');
const statusIndicator = document.getElementById('status-indicator');

let chatHistory = [];

// --- Health Check ---

async function checkHealth() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    statusIndicator.className = `status ${data.status === 'ok' ? 'ok' : 'degraded'}`;
    statusIndicator.title = `Status: ${data.status}`;
  } catch {
    statusIndicator.className = 'status down';
    statusIndicator.title = 'Status: unreachable';
  }
}

// Check health every 30 seconds
setInterval(checkHealth, 30000);
checkHealth();

// --- Login ---

function showChat() {
  loginScreen.hidden = true;
  chatScreen.hidden = false;
  // Only auto-focus on desktop
  if (window.innerWidth > 600) {
    input.focus();
  }
}

function showLogin() {
  loginScreen.hidden = false;
  chatScreen.hidden = true;
}

// Auto-login if token exists
if (getToken()) {
  showChat();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) return;

  loginError.hidden = true;

  // Validate token by calling health with auth header
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ message: 'hello' }),
    });

    if (res.status === 401) {
      loginError.textContent = 'Invalid token. Please try again.';
      loginError.hidden = false;
      return;
    }

    setToken(token, rememberMe.checked);
    showChat();
  } catch {
    loginError.textContent = 'Could not connect to server.';
    loginError.hidden = false;
  }
});

// --- Chat ---

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = renderMarkdown(content);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function addToolCall(name) {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `<div class="tool-call">Using tool: ${escapeHtml(name)}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  // Simple markdown: code blocks, inline code, bold, italic, links
  return escapeHtml(text)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// Auto-resize textarea
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

// Enter to send (desktop), Shift+Enter for newline
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  // Add user message
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  showTyping();

  try {
    const token = getToken();
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: text,
        history: chatHistory.slice(-20), // Keep last 20 messages for context
      }),
    });

    removeTyping();

    if (res.status === 401) {
      clearToken();
      showLogin();
      return;
    }

    if (!res.ok) {
      addMessage('assistant', 'Something went wrong. Please try again.');
      return;
    }

    // Handle streaming response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';
    const bubble = addMessage('assistant', '');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      assistantText += chunk;
      bubble.innerHTML = renderMarkdown(assistantText);
      messages.scrollTop = messages.scrollHeight;
    }

    chatHistory.push({ role: 'assistant', content: assistantText });
  } catch (err) {
    removeTyping();
    addMessage('assistant', 'Network error. Please check your connection and try again.');
  } finally {
    sendBtn.disabled = false;
  }
});
