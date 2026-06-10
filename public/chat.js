// chat.js — AI Chat panel for Corvus Dashboard

// Phase command detection — parse user messages that look like direct
// editorial phase moves. When matched, we dispatch `corvus:phase-set`
// (handled in bundle.js by CorvusPhase) and short-circuit the AI call
// so the user gets instant feedback and the file is updated immediately.
//
// This is intentionally conservative: we only intercept very clear, short
// imperative commands. Anything ambiguous falls through to the AI so Mike
// can still ask "should I promote this?" without it auto-promoting.
const PHASE_IDS = ['PASS 0', 'PASS 1', 'PASS 2', 'PASS 3', 'PASS 4', 'PASS 5'];

function detectPhaseCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > 120) return null; // skip long messages
  const lower = t.toLowerCase();

  // Explicit "set phase to X" / "move to X" / "phase X" patterns.
  // Match the most specific forms first.
  let m = lower.match(/\b(?:set|change|update|move|switch|jump|go|advance|push|promote)\s+(?:the\s+)?(?:phase|pass|step)\s+to\s+(pass\s*\d+)/i);
  if (m) {
    const norm = 'PASS ' + m[1].match(/\d+/)[0];
    if (PHASE_IDS.includes(norm)) return { action: 'set', phase: norm };
  }
  m = lower.match(/^(?:phase|pass)\s+(pass\s*\d+|\d+)\s*$/i);
  if (m) {
    const num = m[1].match(/\d+/)[0];
    const norm = 'PASS ' + num;
    if (PHASE_IDS.includes(norm)) return { action: 'set', phase: norm };
  }
  m = lower.match(/^(?:move|advance|push|jump|switch|go|set)\s+to\s+(pass\s*\d+|\d+)\s*$/i);
  if (m) {
    const num = m[1].match(/\d+/)[0];
    const norm = 'PASS ' + num;
    if (PHASE_IDS.includes(norm)) return { action: 'set', phase: norm };
  }

  // Promote / advance / next / ship it — increment current phase.
  if (/^(?:promote|advance|next\s*phase|move\s*(?:it\s*)?forward|ship\s*it|next\s*step|bump\s*it\s*up)\s*[\.!]?$/i.test(lower)) {
    return { action: 'next' };
  }

  // Demote / back / previous — decrement current phase.
  if (/^(?:demote|back(?:up)?|previous\s*phase|prev\s*phase|move\s*(?:it\s*)?back|step\s*back|revert\s*phase)\s*[\.!]?$/i.test(lower) ||
      /^back\s+up\s*[\.!]?$/i.test(lower)) {
    return { action: 'prev' };
  }

  return null;
}

const CorvusChat = {
  currentDraft: null,
  currentContent: '',
  chatHistory: [],

  updateDraft(draftPath, content) {
    this.currentDraft = draftPath;
    this.currentContent = content;
    // Add a system message when switching drafts
    if (this.chatHistory.length > 0) {
      this.addMessage('system', `Draft changed to: ${draftPath}`);
    }
  },

  addMessage(role, text) {
    const container = document.getElementById('chatMessages');
    
    // Remove welcome message on first real message
    if (this.chatHistory.length === 0 && role !== 'system') {
      const welcome = container.querySelector('.chat-welcome');
      if (welcome) welcome.remove();
    }

    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    const meta = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Corvus';
    div.innerHTML = `
      <div class="msg-meta">${meta}</div>
      <div class="msg-bubble">${this.formatMessage(text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    
    this.chatHistory.push({ role, text });
  },

  formatMessage(text) {
    // Basic formatting: bold, italic, code, line breaks
    return text
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  },

  async send(message) {
    if (!message.trim()) return;

    this.addMessage('user', message);

    // Intercept direct phase commands. We handle the indicator update
    // locally and skip the AI call so the user gets an instant response
    // (and so we don't burn an AI call on what is effectively a UI action).
    const cmd = detectPhaseCommand(message);
    if (cmd) {
      const target = await this.resolvePhaseTarget(cmd);
      if (target) {
        document.dispatchEvent(new CustomEvent('corvus:phase-set', { detail: { phase: target } }));
        this.addMessage('corvus', `Done. Moved to **${target}**.`);
      } else {
        this.addMessage('corvus', `I couldn't resolve that phase move. Open a draft first, or use a clearer command like "promote", "demote", or "move to PASS 4".`);
      }
      return;
    }

    const sendBtn = document.getElementById('sendChat');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Thinking...';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          draftPath: this.currentDraft || null,
          draftContent: this.currentContent,
          comments: window.CorvusComments?.currentComments || [],
          highlights: window.CorvusComments?.currentHighlights || []
        })
      });

      const data = await res.json();
      this.addMessage('corvus', data.response || 'No response from Corvus.');
    } catch (e) {
      this.addMessage('corvus', `Error: ${e.message}`);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  },

  // Resolve a phase command to a concrete target phase string. For
  // "set" actions the phase is already known; for "next"/"prev" we look
  // up the current phase via CorvusPhase's currentPhase (set on every
  // render) and shift it. Returns null if no draft is open (caller will
  // surface a helpful error to the user).
  async resolvePhaseTarget(cmd) {
    if (!window.CorvusPhase) return null;
    // The chat module used to track its own `currentDraft`, but it was
    // never wired up to the editor (no caller invokes `updateDraft`).
    // Read the live currentDraft from the editor module so the chat
    // knows which file to operate on.
    const liveDraft = window.CorvusEditor && window.CorvusEditor.currentDraft;
    if (cmd.action === 'set') {
      if (liveDraft) {
        await window.CorvusPhase.load(liveDraft);
        return cmd.phase;
      }
      return null;
    }
    if (liveDraft) {
      await window.CorvusPhase.load(liveDraft);
    } else {
      return null;
    }
    // Read currentPhase from the rendered pill (the phase module keeps
    // its own currentPhase in a closure, but we don't expose it directly).
    const pill = document.getElementById('phasePill');
    if (!pill) return null;
    const current = (pill.textContent || '').trim().toUpperCase();
    const idx = PHASE_IDS.indexOf(current);
    if (idx === -1) return null;
    if (cmd.action === 'next') return idx < PHASE_IDS.length - 1 ? PHASE_IDS[idx + 1] : null;
    if (cmd.action === 'prev') return idx > 0 ? PHASE_IDS[idx - 1] : null;
    return null;
  }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendChat');

  const doSend = () => {
    const msg = input.value.trim();
    if (msg) {
      CorvusChat.send(msg);
      input.value = '';
    }
  };

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
});

// Expose globally
window.CorvusChat = CorvusChat;