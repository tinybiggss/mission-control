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
  } catch (e) { console.error(e); }
}

function mdToHtml(text) {
  if (!text) return '';
  return text.replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
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
  return html.replace(/<h1[^>]*>(.*?)<\/h1>/gi,'# $1\n\n')
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

window.CorvusEditor = { init: initEditor, loadAllContent, openDraft, openScript };

// Auto-init on load
document.addEventListener('DOMContentLoaded', initEditor);
setTimeout(() => { if (!editor) initEditor(); }, 500);

console.log('Bundle script ready');
