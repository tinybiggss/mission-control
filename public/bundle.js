// Simpler version - try immediately, handle errors gracefully
console.log('Bundle loading...');

const tiptap = window.TiptapEditor;
console.log('TiptapEditor:', typeof tiptap);
console.log('Editor:', typeof (tiptap && tiptap.Editor));
console.log('StarterKit:', typeof (tiptap && tiptap.StarterKit));

const { Editor, StarterKit, Highlight, Color, TextStyle } = tiptap || {};

let currentDraft = null;
let editor = null;
let saveTimeout = null;
let allDrafts = [];
let allScripts = [];
let currentFilter = 'all';

function initEditor() {
  console.log('initEditor called, Editor:', !!Editor);
  
  const element = document.getElementById('editor');
  if (!element) {
    console.error('#editor not found');
    document.getElementById('draftItems').innerHTML = '<div class="loading">Editor element missing</div>';
    return;
  }
  
  if (!Editor || !StarterKit) {
    console.error('Editor/StarterKit missing');
    document.getElementById('draftItems').innerHTML = '<div class="loading">Tiptap not loaded: Editor=' + !!Editor + ' StarterKit=' + !!StarterKit + '</div>';
    return;
  }
  
  try {
    editor = new Editor({
      element,
      extensions: [StarterKit, Highlight.configure({ multicolor: true }), Color, TextStyle],
      content: '',
      onUpdate: ({ editor: e }) => scheduleSave(e.getHTML()),
    });
    console.log('Editor created successfully');
  } catch (e) {
    console.error('Editor creation failed:', e);
    document.getElementById('draftItems').innerHTML = '<div class="loading">Error: ' + e.message + '</div>';
    return;
  }

  // Highlighter color buttons (delegated; bound once after init)
  document.querySelectorAll('.highlighter-btn[data-highlight]').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.highlight || null;
      if (!window.CorvusComments) return;
      const ok = window.CorvusComments.applyHighlight(color === 'none' ? null : color);
      if (!ok) {
        const sel = window.CorvusComments.getSelectedText();
        if (!sel) alert('Please select some text in the editor first.');
      }
    });
  });

  // Event listeners
  document.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
    btn.addEventListener('click', () => applyFormat(btn.dataset.command));
  });
  
  document.getElementById('toggleSidebar')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
  document.getElementById('toggleChat')?.addEventListener('click', toggleChatPanel);
  document.getElementById('toggleChatClose')?.addEventListener('click', toggleChatPanel);

  document.querySelectorAll('.draft-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.draft-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderDrafts();
    });
  });

  // Phase indicator: cache DOM, render empty state. The phase list is needed
  // by the Prev/Promote buttons to know the order of phases. The server is
  // the source of truth (it ships the full list with every GET response),
  // but we mirror it here so the buttons can compute next/prev without
  // waiting for a draft to be opened.
  window.CorvusPhaseList = [
    { id: 'PASS 0', label: 'Idea/Research' },
    { id: 'PASS 1', label: 'Outline' },
    { id: 'PASS 2', label: 'Rough Draft' },
    { id: 'PASS 3', label: 'Review & Approve' },
    { id: 'PASS 4', label: 'Final Edit' },
    { id: 'PASS 5', label: 'Published' }
  ];
  window.CorvusPhase.init();

  loadAllContent();
}

function renderDrafts() {
  const list = document.getElementById('draftItems');
  let items = currentFilter === 'all' ? [...allDrafts, ...allScripts] 
             : currentFilter === 'video-script' ? allScripts 
             : allDrafts.filter(d => d.contentType === currentFilter);
  
  items.sort((a, b) => b.date.localeCompare(a.date));
  
  if (items.length === 0) {
    list.innerHTML = '<div class="loading">No drafts found</div>';
    return;
  }
  
  const labels = {'article-outline':'📝 Article','text-draft':'✍️ Text','visual-brief':'🎨 Visual','video-script':'🎬 Video'};
  
  list.innerHTML = items.map(d => `
    <div class="draft-item" data-path="${d.path}" data-type="${d.contentType||'video-script'}">
      <div class="draft-name">${d.name}</div>
      <div class="draft-date">${d.date}</div>
      <div class="draft-type">${labels[d.contentType]||d.contentType||'Video'}</div>
    </div>`).join('');
  
  list.querySelectorAll('.draft-item').forEach(item => {
    item.addEventListener('click', () => {
      item.dataset.type === 'video-script' ? openScript(item.dataset.path) : openDraft(item.dataset.path);
    });
  });
}

function applyFormat(cmd) {
  if (!editor) return;
  const chain = editor.chain().focus();
  const commands = {bold:'toggleBold',italic:'toggleItalic',strike:'toggleStrike',h1:'toggleHeading',h2:'toggleHeading',h3:'toggleHeading',bulletList:'toggleBulletList',orderedList:'toggleOrderedList',blockquote:'toggleBlockquote',codeBlock:'toggleCodeBlock'};
  if (commands[cmd]) chain[commands[cmd]](cmd.startsWith('h')?{level:+cmd[1]}:{}).run();
}

async function loadAllContent() {
  try {
    const [dr, sc] = await Promise.all([fetch('/api/drafts'), fetch('/api/scripts')]);
    allDrafts = await dr.json();
    allScripts = await sc.json();
    console.log('Loaded:', allDrafts.length, 'drafts,', allScripts.length, 'scripts');
    renderDrafts();
  } catch (e) {
    console.error('Load error:', e);
    document.getElementById('draftItems').innerHTML = '<div class="loading">Error: ' + e.message + '</div>';
  }
}

async function openDraft(path) {
  if (currentDraft === path) return;
  if (currentDraft && editor) await saveDraftImmediately();
  try {
    const data = await (await fetch('/api/draft/' + path)).json();
    currentDraft = path;
    document.querySelectorAll('.draft-item').forEach(el => el.classList.toggle('active', el.dataset.path === path));
    editor.commands.setContent(mdToHtml(data.content));
    document.getElementById('draftTitle').textContent = path;
    document.getElementById('saveStatus').textContent = 'Loaded';
    // Load comments/highlights for this draft
    if (window.CorvusComments?.loadComments) {
      await window.CorvusComments.loadComments(path);
    }
    // Refresh the phase indicator for the newly-opened draft.
    if (window.CorvusPhase?.load) {
      await window.CorvusPhase.load(path);
    }
  } catch (e) { console.error(e); }
}

async function openScript(path) {
  if (currentDraft === path) return;
  if (currentDraft && editor) await saveDraftImmediately();
  try {
    const data = await (await fetch('/api/script/' + path)).json();
    currentDraft = path;
    document.querySelectorAll('.draft-item').forEach(el => el.classList.toggle('active', el.dataset.path === path));
    editor.commands.setContent(mdToHtml(data.content));
    document.getElementById('draftTitle').textContent = path;
    document.getElementById('saveStatus').textContent = 'Loaded (read-only)';
    // Load comments/highlights for this script
    if (window.CorvusComments?.loadComments) {
      await window.CorvusComments.loadComments(path);
    }
    // Refresh the phase indicator for the newly-opened script.
    // (Scripts in Content Adapted are read-only here, but the indicator
    //  still surfaces where they are in the pipeline.)
    if (window.CorvusPhase?.load) {
      await window.CorvusPhase.load(path);
    }
  } catch (e) { console.error(e); }
}

function mdToHtml(text) {
  if (!text) return '';
  // Convert ==highlighted== markdown back into <mark> tags so TipTap preserves them.
  // (The Highlight extension parses these via parseHTML + parseMarkdown.)
  return text.replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/==([^=]+)==/g,'<mark>$1</mark>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/^---$/gm,'<hr>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm,'<li>$2</li>')
    .split('\n\n').map(p=>p.trim()).filter(p=>p)
    .map(p=>p.startsWith('<')?p:`<p>${p.replace(/\n/g,'<br>')}</p>`).join('\n');
}

function htmlToMd(html) {
  // Convert TipTap highlight marks <mark data-color="...">X</mark> → ==X==
  // (color is re-applied on load from the highlights JSON, see comments.js).
  return html
    .replace(/<mark[^>]*data-color="[^"]*"[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==')
    .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi,'# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi,'## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi,'### $1\n\n')
    .replace(/<strong>(.*?)<\/strong>/gi,'**$1**')
    .replace(/<em>(.*?)<\/em>/gi,'*$1*')
    .replace(/<code>(.*?)<\/code>/gi,'`$1`')
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi,'```\n$1\n```\n')
    .replace(/<blockquote>(.*?)<\/blockquote>/gi,'> $1\n')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/p>/gi,'\n\n')
    .replace(/<[^>]+>/g,'').trim();
}

function scheduleSave(content) {
  document.getElementById('saveStatus').textContent = 'Unsaved...';
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveDraft(content), 1500);
}

async function saveDraft(content) {
  if (!currentDraft) return;
  try {
    await fetch('/api/draft/' + currentDraft, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({content: htmlToMd(content)})
    });
    document.getElementById('saveStatus').textContent = 'Saved';
  } catch (e) { document.getElementById('saveStatus').textContent = 'Save failed'; }
}

async function saveDraftImmediately() {
  if (!currentDraft || !editor) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  await saveDraft(editor.getHTML());
}

function toggleChatPanel() {
  document.getElementById('chatPanel').classList.toggle('hidden');
}

// CorvusPhase — drives the phase indicator above the AI chat panel.
// Reads `/api/drafts/:path/phase` for the currently-open draft and reflects
// the result in the indicator UI. Promote / Prev buttons POST to the same
// endpoint and refresh in place. Chat commands like "promote" or
// "move to pass 4" are routed in via the `corvus:phase-set` custom event
// (dispatched from chat.js), keeping chat and indicator in sync.
const CorvusPhase = (() => {
  let currentPath = null;
  let currentPhase = null;
  let isSaving = false;
  const els = {};

  function cacheEls() {
    els.docTitle  = document.getElementById('phaseDocTitle');
    els.pill      = document.getElementById('phasePill');
    els.label     = document.getElementById('phaseLabel');
    els.goal      = document.getElementById('phaseGoal');
    els.prev      = document.getElementById('phasePrev');
    els.promote   = document.getElementById('phasePromote');
    els.nextRow   = document.getElementById('phaseNextRow');
    els.next      = document.getElementById('phaseNext');
    els.flag      = document.getElementById('phaseDefaultFlag');
    return !!els.pill;
  }

  function shortDocName(path) {
    if (!path) return 'No draft';
    // "2026-06-09/draft-media-server-off-ramp.md" → "media-server-off-ramp"
    const base = path.split('/').pop() || path;
    return base.replace(/^draft-/, '').replace(/\.md$/i, '');
  }

  function renderEmpty() {
    if (!cacheEls()) return;
    els.docTitle.textContent = 'No draft selected';
    els.pill.textContent = 'PASS —';
    els.label.textContent = '—';
    els.goal.textContent = 'Open a draft to see its phase.';
    els.next.textContent = '—';
    els.flag.classList.add('hidden');
    els.prev.disabled = true;
    els.promote.disabled = true;
  }

  function render(state) {
    if (!cacheEls()) return;
    if (!state) { renderEmpty(); return; }
    currentPath = state.path;
    currentPhase = state.phase;
    els.docTitle.textContent = shortDocName(state.path);
    els.pill.textContent = state.phase || 'PASS —';
    els.label.textContent = state.label || '—';
    els.goal.textContent = state.goal || '';
    els.next.textContent = state.next || '— (final)';
    // Note: we deliberately do NOT factor `isSaving` into the disabled state
    // here. `setPhase()` manages the disabled bit itself for the duration of
    // the in-flight request, and calls `render` only after isSaving is back
    // to false (see the finally block in setPhase). If we mixed isSaving in
    // here, render() called from inside the try-block would leave the button
    // stuck-disabled after the finally cleared the flag.
    els.prev.disabled = !state.prev;
    els.promote.disabled = !state.next;
    if (state.phaseDefault) {
      els.flag.classList.remove('hidden');
      els.flag.textContent = 'default';
    } else {
      els.flag.classList.add('hidden');
    }
  }

  async function load(path) {
    if (!path) { renderEmpty(); return null; }
    try {
      const res = await fetch('/api/drafts/' + encodeURI(path) + '/phase');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[phase] load failed:', err.error || res.status);
        renderEmpty();
        return null;
      }
      const state = await res.json();
      render(state);
      return state;
    } catch (e) {
      console.error('[phase] load error:', e);
      renderEmpty();
      return null;
    }
  }

  async function setPhase(targetPhase) {
    if (!currentPath) {
      console.warn('[phase] no draft open');
      return null;
    }
    if (!targetPhase) return null;
    isSaving = true;
    // Disable both buttons while the request is in flight so a double-click
    // can't fire two POSTs. We re-enable in the finally block based on the
    // current state.
    if (els.promote) { els.promote.disabled = true; els.promote.classList.add('saving'); }
    if (els.prev) { els.prev.disabled = true; els.prev.classList.add('saving'); }
    try {
      const res = await fetch('/api/drafts/' + encodeURI(currentPath) + '/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: targetPhase })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('[phase] set failed:', data.error);
        alert('Could not change phase: ' + (data.error || res.status));
        return null;
      }
      // Refresh from the server so we get the canonical state (with updated
      // next/prev/label/goal). The POST already returns everything we need,
      // so we render directly from `data` to avoid a second round-trip.
      render({
        path: data.path,
        phase: data.phase,
        label: data.label,
        goal: data.goal,
        next: data.next,
        prev: data.prev,
        phaseDefault: false
      });
      return data;
    } catch (e) {
      console.error('[phase] set error:', e);
      alert('Could not change phase: ' + e.message);
      return null;
    } finally {
      isSaving = false;
      if (els.promote) els.promote.classList.remove('saving');
      if (els.prev) els.prev.classList.remove('saving');
      // Re-enable the buttons based on the current state. The `disabled`
      // flags were set true above for the duration of the request, and
      // `render()` clears the saving-class but doesn't touch `disabled`
      // (we split that responsibility). Now that isSaving is back to false
      // we can let render recompute the proper enabled/disabled state.
      if (currentPhase) {
        const idx = (window.CorvusPhaseList || []).findIndex(p => p.id === currentPhase);
        if (els.prev) els.prev.disabled = !(idx > 0);
        if (els.promote) els.promote.disabled = !(idx >= 0 && idx < (window.CorvusPhaseList || []).length - 1);
      } else {
        if (els.prev) els.prev.disabled = true;
        if (els.promote) els.promote.disabled = true;
      }
    }
  }

  function init() {
    if (!cacheEls()) return;
    els.promote?.addEventListener('click', async () => {
      if (!currentPhase) return;
      const idx = (window.CorvusPhaseList || []).findIndex(p => p.id === currentPhase);
      if (idx === -1 || idx >= (window.CorvusPhaseList || []).length - 1) return;
      await setPhase(window.CorvusPhaseList[idx + 1].id);
    });
    els.prev?.addEventListener('click', async () => {
      if (!currentPhase) return;
      const idx = (window.CorvusPhaseList || []).findIndex(p => p.id === currentPhase);
      if (idx <= 0) return;
      await setPhase(window.CorvusPhaseList[idx - 1].id);
    });
    // Chat commands dispatch `corvus:phase-set` with detail.phase = target.
    document.addEventListener('corvus:phase-set', async (e) => {
      const target = e.detail && e.detail.phase;
      if (!target) return;
      await setPhase(target);
    });
    renderEmpty();
  }

  return { init, load, setPhase, render, renderEmpty };
})();
window.CorvusPhase = CorvusPhase;

// Expose editor + currentDraft via getters so comments.js and chat.js can read them
// (the variables are module-scoped `let` bindings that can't be reassigned through
// a plain object property — getters are the cleanest way).
window.CorvusEditor = {
  init: initEditor,
  loadAllContent,
  openDraft,
  openScript,
  get editor() { return editor; },
  get currentDraft() { return currentDraft; },
  set currentDraft(v) { currentDraft = v; },
};

// Auto-init on load
document.addEventListener('DOMContentLoaded', initEditor);
setTimeout(() => { if (!editor) initEditor(); }, 500);

console.log('Bundle script ready');

// chat.js and comments.js are loaded as separate <script> tags in index.html —
// see public/comments.js and public/chat.js.
