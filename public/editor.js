// Editor.js — Tiptap editor logic for Corvus Dashboard

let currentDraft = null;
let editor = null;
let saveTimeout = null;

// Initialize the editor
function initEditor() {
  const element = document.getElementById('editor');
  
  editor = new Tiptap.Editor({
    element,
    extensions: [
      TiptapCore.StarterKit,
      TiptapCore.Highlight.configure({ multicolor: true }),
      TiptapCore.Color,
      TiptapCore.TextStyle,
    ],
    content: '',
    onUpdate: ({ editor: e }) => {
      scheduleSave(e.getHTML());
    },
  });

  // Toolbar buttons
  document.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.command;
      applyFormat(cmd);
    });
  });

  // Toggle sidebar
  document.getElementById('toggleSidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  // Toggle chat panel
  document.getElementById('toggleChat').addEventListener('click', toggleChatPanel);
  document.getElementById('toggleChatClose').addEventListener('click', toggleChatPanel);
}

// Apply formatting command
function applyFormat(command) {
  if (!editor) return;
  const chain = editor.chain().focus();
  switch (command) {
    case 'bold': chain.toggleBold().run(); break;
    case 'italic': chain.toggleItalic().run(); break;
    case 'strike': chain.toggleStrike().run(); break;
    case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
    case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
    case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
    case 'bulletList': chain.toggleBulletList().run(); break;
    case 'orderedList': chain.toggleOrderedList().run(); break;
    case 'blockquote': chain.toggleBlockquote().run(); break;
    case 'codeBlock': chain.toggleCodeBlock().run(); break;
  }
}

// Load draft list
async function loadDrafts() {
  try {
    const res = await fetch('/api/drafts');
    const drafts = await res.json();
    const list = document.getElementById('draftList');
    
    if (!drafts || drafts.length === 0) {
      list.innerHTML = '<div class="loading">No drafts found.<br><small>Check that the Content Drafts folder is accessible.</small></div>';
      return;
    }

    list.innerHTML = drafts.map(d => `
      <div class="draft-item" data-path="${d.path}">
        <div class="draft-name">${d.name}</div>
        <div class="draft-date">${d.date}</div>
      </div>
    `).join('');

    list.querySelectorAll('.draft-item').forEach(item => {
      item.addEventListener('click', () => openDraft(item.dataset.path));
    });
  } catch (e) {
    document.getElementById('draftList').innerHTML = `<div class="loading">Error loading drafts: ${e.message}</div>`;
  }
}

// Open a draft
async function openDraft(draftPath) {
  if (currentDraft === draftPath) return;
  
  // Save current draft first
  if (currentDraft && editor) {
    await saveDraftImmediately();
  }

  try {
    const res = await fetch(`/api/draft/${draftPath}`);
    const data = await res.json();
    
    currentDraft = draftPath;
    
    // Update active state in sidebar
    document.querySelectorAll('.draft-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === draftPath);
    });

    // Load content into editor — convert markdown-ish to HTML
    const html = markdownToHtml(data.content);
    editor.commands.setContent(html);
    
    document.getElementById('draftTitle').textContent = draftPath;
    document.getElementById('saveStatus').textContent = 'Loaded';

    // Load comments for this draft
    loadComments(draftPath);
    
    // Update chat context
    updateChatDraft(draftPath, data.content);
  } catch (e) {
    console.error('Error opening draft:', e);
  }
}

// Convert markdown to HTML (basic)
function markdownToHtml(text) {
  if (!text) return '';
  
  let html = text
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    // Paragraphs
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p)
    .map(p => {
      if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<blockquote') || p.startsWith('<li') || p.startsWith('<hr')) {
        return p.replace(/<li>/g, '<ul><li>').replace(/<\/li>/g, '</li></ul>').replace(/<ul><li>/g, '<ul><li>');
      }
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  // Fix list wrapping
  html = html.replace(/(<li>.*?<\/li>)+/g, (match) => `<ul>${match}</ul>`);
  
  return html;
}

// Convert HTML back to markdown for saving
function htmlToMarkdown(html) {
  let text = html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n')
    .replace(/<blockquote>(.*?)<\/blockquote>/gi, '> $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
  return text;
}

// Auto-save with debounce
function scheduleSave(content) {
  document.getElementById('saveStatus').textContent = 'Unsaved...';
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveDraft(content);
  }, 1500);
}

// Save draft to server
async function saveDraft(content) {
  if (!currentDraft) return;
  try {
    const markdown = htmlToMarkdown(content);
    await fetch(`/api/draft/${currentDraft}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: markdown })
    });
    document.getElementById('saveStatus').textContent = 'Saved';
    updateChatDraft(currentDraft, markdown);
  } catch (e) {
    document.getElementById('saveStatus').textContent = 'Save failed';
    console.error(e);
  }
}

// Save immediately (for switching drafts)
async function saveDraftImmediately() {
  if (!currentDraft || !editor) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  const content = editor.getHTML();
  const markdown = htmlToMarkdown(content);
  try {
    await fetch(`/api/draft/${currentDraft}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: markdown })
    });
  } catch (e) { console.error(e); }
}

// Toggle chat panel visibility
function toggleChatPanel() {
  const panel = document.getElementById('chatPanel');
  panel.classList.toggle('hidden');
}

// Update chat panel's understanding of current draft
function updateChatDraft(draftPath, content) {
  if (window.CorvusChat) {
    window.CorvusChat.updateDraft(draftPath, content);
  }
}

// Apply an AI edit suggestion to the document
function applyEdit(replacement) {
  if (!editor) return;
  editor.commands.insertContent(replacement);
}

// Expose to global
window.CorvusEditor = {
  init: initEditor,
  loadDrafts,
  openDraft,
  applyEdit,
  getContent: () => editor ? editor.getHTML() : '',
  getMarkdown: () => editor ? htmlToMarkdown(editor.getHTML()) : ''
};

document.addEventListener('DOMContentLoaded', initEditor);