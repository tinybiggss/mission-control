// comments.js — Comment/annotation + highlighter system for Corvus Dashboard
//
// Exposes: window.CorvusComments = { currentComments, currentHighlights, loadComments, saveComments, getSelectedText, applyHighlight, getEditor, HIGHLIGHT_COLORS }

const HIGHLIGHT_COLORS = [
  { id: 'yellow',  color: '#FFEB3B', label: 'Yellow' },
  { id: 'green',   color: '#A5D6A7', label: 'Green' },
  { id: 'pink',    color: '#F48FB1', label: 'Pink' },
  { id: 'blue',    color: '#90CAF9', label: 'Blue' },
  { id: 'orange',  color: '#FFAB91', label: 'Orange' },
];

let currentComments = [];
let currentHighlights = []; // { id, color, text, timestamp }
let selectedQuote = null;

function getEditor() {
  // Bundle.js keeps the editor as a module-level let; we read it via the exposed getter.
  return window.CorvusEditor?.editor || null;
}

// Read selected text from TipTap (more reliable than window.getSelection() inside a contenteditable).
function getSelectedText() {
  const editor = getEditor();
  if (editor) {
    const { from, to, empty } = editor.state.selection;
    if (!empty) {
      try {
        return editor.state.doc.textBetween(from, to, ' ').trim();
      } catch (e) {
        // fall through
      }
    }
  }
  // Fallback: native selection (works for non-editor selections)
  const sel = window.getSelection();
  return sel ? sel.toString().trim() : '';
}

// Apply a highlight color to the current selection using TipTap's Highlight extension.
function applyHighlight(color /* string like '#FFEB3B' or null to remove */) {
  const editor = getEditor();
  if (!editor) return false;
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;

  const text = editor.state.doc.textBetween(from, to, ' ');

  if (!color) {
    // Remove highlight
    editor.chain().focus().unsetHighlight().run();
  } else {
    editor.chain().focus().toggleHighlight({ color }).run();
    // Record the highlight in our store
    currentHighlights.push({
      id: 'h' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      color,
      text,
      timestamp: new Date().toISOString(),
    });
    saveComments();
    renderHighlightsSidebar();
  }
  return true;
}

// Load comments (and highlights) for a draft
async function loadComments(draftPath) {
  try {
    const res = await fetch(`/api/comments/${draftPath}.json`);
    const data = await res.json();
    currentComments = data.comments || [];
    currentHighlights = data.highlights || [];
    renderCommentHighlights();
    renderCommentsSidebar();
    renderHighlightsSidebar();
  } catch (e) {
    currentComments = [];
    currentHighlights = [];
  }
}

// Save comments + highlights
async function saveComments() {
  if (!window.CorvusEditor?.currentDraft) return;
  const draftPath = window.CorvusEditor.currentDraft;
  try {
    await fetch(`/api/comments/${draftPath}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft: draftPath,
        comments: currentComments,
        highlights: currentHighlights,
      })
    });
  } catch (e) {
    console.error('Failed to save comments:', e);
  }
}

// Add comment button in toolbar
document.getElementById('addCommentBtn')?.addEventListener('click', () => {
  const selectedText = getSelectedText();
  
  if (!selectedText) {
    alert('Please select some text in the editor first.');
    return;
  }
  
  selectedQuote = selectedText;
  document.getElementById('commentQuote').textContent = `"${selectedText}"`;
  document.getElementById('commentText').value = '';
  document.getElementById('commentModal').classList.remove('hidden');
  document.getElementById('commentText').focus();
});

// Save comment
document.getElementById('saveComment')?.addEventListener('click', () => {
  const text = document.getElementById('commentText').value.trim();
  if (!text || !selectedQuote) return;
  
  const comment = {
    id: 'c' + Date.now(),
    quote: selectedQuote,
    text,
    timestamp: new Date().toISOString(),
    resolved: false
  };
  
  currentComments.push(comment);
  saveComments();
  renderCommentHighlights();
  renderCommentsSidebar();
  renderHighlightsSidebar();
  
  document.getElementById('commentModal').classList.add('hidden');
  selectedQuote = null;
});

// Cancel comment
document.getElementById('cancelComment')?.addEventListener('click', () => {
  document.getElementById('commentModal').classList.add('hidden');
  selectedQuote = null;
});

// Render comment highlights in the editor
function renderCommentHighlights() {
  if (!getEditor()) return;
  const editorEl = document.getElementById('editor');
  
  // Remove existing highlights
  editorEl.querySelectorAll('.comment-highlight').forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  
  // Add new highlights for unresolved comments
  currentComments.filter(c => !c.resolved).forEach(comment => {
    highlightCommentQuote(comment.quote, comment.id);
  });
  
  // Auto-show sidebar if there are comments or highlights
  const sidebar = document.getElementById('commentsSidebar');
  if (sidebar && (currentComments.length > 0 || currentHighlights.length > 0)) {
    sidebar.classList.remove('hidden');
  }
}
  });
}

// Highlight a quote in the editor
function highlightCommentQuote(quote, commentId) {
  const editorEl = document.getElementById('editor');
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  const text = quote.trim();
  
  let node;
  while (node = walker.nextNode()) {
    // Skip text nodes that are already inside a highlight mark (TipTap's <mark>)
    if (node.parentElement && node.parentElement.tagName === 'MARK') continue;
    if (node.nodeValue.includes(text)) {
      const span = document.createElement('span');
      span.className = 'comment-highlight';
      span.dataset.commentId = commentId;
      span.title = 'Click to view comment';
      
      const range = document.createRange();
      const startIdx = node.nodeValue.indexOf(text);
      range.setStart(node, startIdx);
      range.setEnd(node, startIdx + text.length);
      
      span.appendChild(range.extractContents());
      node.parentNode.insertBefore(span, node.nextSibling);
      break;
    }
  }
  
  // Add click handler
  editorEl.querySelectorAll(`.comment-highlight[data-comment-id="${commentId}"]`).forEach(el => {
    el.addEventListener('click', () => showCommentThread(commentId));
  });
}

// Show comment thread
function showCommentThread(commentId) {
  const comment = currentComments.find(c => c.id === commentId);
  if (!comment) return;
  
  // Highlight the comment in the sidebar
  document.querySelectorAll('.comment-thread').forEach(el => {
    el.classList.remove('active');
  });
  const threadEl = document.querySelector(`.comment-thread[data-id="${commentId}"]`);
  if (threadEl) {
    threadEl.classList.add('active');
    threadEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  // Show comments sidebar
  document.getElementById('commentsSidebar').classList.remove('hidden');
}

// Render comments in sidebar
function renderCommentsSidebar() {
  const list = document.getElementById('commentsList');
  
  if (currentComments.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-dim);font-size:13px;">No comments yet. Select text in the editor and click "💬 Comment" to add one.</div>';
    return;
  }
  
  list.innerHTML = currentComments.map(c => `
    <div class="comment-thread" data-id="${c.id}">
      <div class="ct-quote">"${escapeHtml(c.quote)}"</div>
      <div class="ct-text">${escapeHtml(c.text)}</div>
      <div class="ct-meta">
        <span>${new Date(c.timestamp).toLocaleDateString()}</span>
        <div class="ct-actions">
          ${!c.resolved ? `<button onclick="window.CorvusComments.toggleResolve('${c.id}')">✓ Resolve</button>` : '<span style="color:#4caf50">Resolved</span>'}
          <button onclick="window.CorvusComments.deleteComment('${c.id}')">✕ Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Render the highlight reference list in the comments sidebar (if present)
function renderHighlightsSidebar() {
  const list = document.getElementById('highlightsList');
  if (!list) return;
  if (currentHighlights.length === 0) {
    list.innerHTML = '<div style="padding:8px 16px;color:var(--text-dim);font-size:12px;">No highlights yet. Select text and pick a color from the toolbar.</div>';
    return;
  }
  list.innerHTML = `
    <div class="highlights-header">Highlighted text (${currentHighlights.length})</div>
    ${currentHighlights.map(h => `
      <div class="highlight-item" data-color="${h.color}">
        <span class="hl-swatch" style="background:${h.color}"></span>
        <span class="hl-text">"${escapeHtml(h.text)}"</span>
        <button class="hl-remove" title="Remove" onclick="window.CorvusComments.removeHighlight('${h.id}')">✕</button>
      </div>
    `).join('')}
  `;
}

// Remove a highlight by id (re-renders the editor content from the draft to wipe mark nodes)
function removeHighlight(id) {
  currentHighlights = currentHighlights.filter(h => h.id !== id);
  saveComments();
  renderHighlightsSidebar();
}

// Toggle resolve comment
function toggleResolve(commentId) {
  const comment = currentComments.find(c => c.id === commentId);
  if (comment) {
    comment.resolved = !comment.resolved;
    saveComments();
    renderCommentHighlights();
    renderCommentsSidebar();
  }
}

// Delete comment
function deleteComment(commentId) {
  currentComments = currentComments.filter(c => c.id !== commentId);
  saveComments();
  renderCommentHighlights();
  renderCommentsSidebar();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// Close comments sidebar
document.getElementById('closeComments')?.addEventListener('click', () => {
  document.getElementById('commentsSidebar').classList.add('hidden');
});

// For clicking on highlighted text (event delegation)
document.addEventListener('click', (e) => {
  const hl = e.target.closest('.comment-highlight');
  if (hl) {
    const commentId = hl.dataset.commentId;
    showCommentThread(commentId);
  }
});

// Expose globally for chat.js, bundle.js, and inline onclick handlers
window.CorvusComments = {
  currentComments,
  currentHighlights,
  HIGHLIGHT_COLORS,
  getSelectedText,
  applyHighlight,
  loadComments,
  saveComments,
  renderCommentHighlights,
  renderCommentsSidebar,
  renderHighlightsSidebar,
  toggleResolve,
  deleteComment,
  removeHighlight,
};
