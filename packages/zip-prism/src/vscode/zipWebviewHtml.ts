import * as crypto from 'crypto';

export function buildZipWebviewHtml(archiveDisplayName: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const escapedTitle = escapeHtml(archiveDisplayName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .app {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-wrap: wrap;
    }
    .archive-title {
      font-weight: 600;
      white-space: nowrap;
    }
    .archive-stats {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .search-group {
      display: flex;
      gap: 8px;
      flex: 1;
      min-width: 260px;
      justify-content: flex-end;
    }
    input[type="search"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      padding: 4px 8px;
      min-width: 170px;
      flex: 1;
      max-width: 280px;
      outline: none;
    }
    input[type="search"]:focus {
      border-color: var(--vscode-focusBorder);
    }
    button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid transparent;
      border-radius: 3px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.9em;
      white-space: nowrap;
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .workspace {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    .sidebar {
      width: 34%;
      min-width: 240px;
      max-width: 520px;
      border-right: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      overflow-y: auto;
      padding: 6px 0;
    }
    .tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .tree-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .tree-row.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .tree-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tree-meta {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
    }
    .tree-row.selected .tree-meta {
      color: var(--vscode-list-activeSelectionForeground);
      opacity: 0.85;
    }
    .preview-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .preview-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorGroupHeader-tabsBackground);
    }
    .preview-path {
      flex: 1;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .preview-body {
      flex: 1;
      overflow: auto;
      padding: 12px;
    }
    .banner {
      padding: 6px 10px;
      margin-bottom: 10px;
      border-radius: 3px;
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      font-size: 0.9em;
    }
    .code-view {
      margin: 0;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
      white-space: pre;
      tab-size: 2;
    }
    .table-wrap {
      overflow: auto;
      max-height: 100%;
    }
    table.csv-table {
      border-collapse: collapse;
      width: 100%;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }
    table.csv-table th, table.csv-table td {
      border: 1px solid var(--vscode-panel-border);
      padding: 4px 8px;
      text-align: left;
      white-space: nowrap;
    }
    table.csv-table th {
      position: sticky;
      top: 0;
      background: var(--vscode-sideBar-background);
      font-weight: 600;
    }
    .image-preview {
      max-width: 100%;
      max-height: 80vh;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    .empty-state {
      color: var(--vscode-descriptionForeground);
      padding: 24px 12px;
      text-align: center;
    }
    .search-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 10px 8px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .search-hit {
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      cursor: pointer;
    }
    .search-hit:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .search-hit-file {
      font-weight: 600;
      font-size: 0.9em;
      margin-bottom: 2px;
      word-break: break-all;
    }
    .search-hit-line {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="toolbar">
      <span class="archive-title">${escapedTitle}</span>
      <span class="archive-stats" id="archiveStats">Loading…</span>
      <div class="search-group">
        <input type="search" id="nameFilter" placeholder="Filter file names…" />
        <input type="search" id="contentSearch" placeholder="Search inside files (Enter)…" />
        <button id="contentSearchBtn">Search</button>
      </div>
    </header>

    <main class="workspace">
      <aside class="sidebar" id="sidebar"></aside>
      <section class="preview-pane">
        <div class="preview-header" id="previewHeader" style="display: none;">
          <span class="preview-path" id="previewPath"></span>
          <button id="toggleTabularBtn" style="display: none;">Raw Text</button>
          <button id="copyBtn">Copy</button>
          <button id="openEditorBtn" class="primary">Open in Editor</button>
        </div>
        <div class="preview-body" id="previewBody">
          <div class="empty-state">Select a file on the left to preview it, or double-click to open it in a VS Code tab.</div>
        </div>
      </section>
    </main>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const state = {
      tree: [],
      expanded: new Set(),
      selectedPath: null,
      nameFilter: '',
      searchResult: null,
      currentPreview: null,
      tabularMode: true,
    };

    const sidebarEl = document.getElementById('sidebar');
    const statsEl = document.getElementById('archiveStats');
    const nameFilterEl = document.getElementById('nameFilter');
    const contentSearchEl = document.getElementById('contentSearch');
    const contentSearchBtn = document.getElementById('contentSearchBtn');
    const previewHeaderEl = document.getElementById('previewHeader');
    const previewPathEl = document.getElementById('previewPath');
    const previewBodyEl = document.getElementById('previewBody');
    const toggleTabularBtn = document.getElementById('toggleTabularBtn');
    const copyBtn = document.getElementById('copyBtn');
    const openEditorBtn = document.getElementById('openEditorBtn');

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function escapeText(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function filterTreeNodes(nodes, query) {
      if (!query) return nodes;
      const lower = query.toLowerCase();
      const out = [];
      for (const node of nodes) {
        if (node.isDirectory) {
          const filteredChildren = filterTreeNodes(node.children, query);
          if (filteredChildren.length > 0 || node.name.toLowerCase().includes(lower)) {
            out.push({ ...node, children: filteredChildren });
          }
        } else if (node.path.toLowerCase().includes(lower)) {
          out.push(node);
        }
      }
      return out;
    }

    function renderSidebar() {
      if (state.searchResult) {
        renderSearchResults(state.searchResult);
        return;
      }

      const visibleTree = filterTreeNodes(state.tree, state.nameFilter);
      if (visibleTree.length === 0) {
        sidebarEl.innerHTML = '<div class="empty-state">No matching files.</div>';
        return;
      }

      const rows = [];
      const walk = (nodes, depth) => {
        for (const node of nodes) {
          const isExpanded = state.nameFilter.length > 0 || state.expanded.has(node.path);
          const indent = 10 + depth * 14;
          const icon = node.isDirectory ? (isExpanded ? '▾ 📁' : '▸ 📁') : '📄';
          const selectedClass = state.selectedPath === node.path ? ' selected' : '';
          const meta = node.isDirectory
            ? node.fileCount + ' files'
            : formatBytes(node.uncompressedSize);

          rows.push(
            '<div class="tree-row' + selectedClass + '" ' +
              'data-path="' + escapeText(node.path) + '" ' +
              'data-dir="' + (node.isDirectory ? '1' : '0') + '" ' +
              'style="padding-left:' + indent + 'px;">' +
              '<span>' + icon + '</span>' +
              '<span class="tree-name" title="' + escapeText(node.path) + '">' + escapeText(node.name) + '</span>' +
              '<span class="tree-meta">' + escapeText(meta) + '</span>' +
            '</div>'
          );

          if (node.isDirectory && isExpanded) {
            walk(node.children, depth + 1);
          }
        }
      };

      walk(visibleTree, 0);
      sidebarEl.innerHTML = rows.join('');
    }

    function renderSearchResults(result) {
      const header =
        '<div class="search-header">' +
          '<span>' + result.matches.length + ' match(es) in ' + result.filesScanned + ' file(s)' +
            (result.limitReached ? ' (capped)' : '') +
          '</span>' +
          '<button id="clearSearchBtn">Back to Tree</button>' +
        '</div>';

      if (result.matches.length === 0) {
        sidebarEl.innerHTML = header + '<div class="empty-state">No content matches for "' + escapeText(result.query) + '".</div>';
        return;
      }

      const items = result.matches.map((m) =>
        '<div class="search-hit" data-hit-path="' + escapeText(m.entryPath) + '" data-hit-line="' + m.line + '">' +
          '<div class="search-hit-file">' + escapeText(m.entryPath) + ':' + m.line + '</div>' +
          '<div class="search-hit-line">' + escapeText(m.previewLine) + '</div>' +
        '</div>'
      );

      sidebarEl.innerHTML = header + items.join('');
    }

    function renderPreview(preview) {
      state.currentPreview = preview;
      previewHeaderEl.style.display = 'flex';
      previewPathEl.textContent = preview.entry.path + ' (' + formatBytes(preview.entry.uncompressedSize) + ')';

      const isTabular = preview.kind === 'tabular' && preview.tabular;
      toggleTabularBtn.style.display = isTabular ? 'inline-block' : 'none';
      toggleTabularBtn.textContent = state.tabularMode ? 'Raw Text' : 'Table View';
      copyBtn.style.display = preview.textContent !== undefined ? 'inline-block' : 'none';
      openEditorBtn.style.display = preview.kind !== 'binary' && preview.kind !== 'image' ? 'inline-block' : 'none';

      let html = '';
      if (preview.truncated) {
        html += '<div class="banner">Preview truncated to 2 MB. Use "Open in Editor" to inspect up to 10 MB natively.</div>';
      }

      if (preview.kind === 'binary') {
        html +=
          '<div class="empty-state">' +
            '<p><strong>Binary file</strong></p>' +
            '<p>Size: ' + formatBytes(preview.entry.uncompressedSize) +
            ' (compressed: ' + formatBytes(preview.entry.compressedSize) + ')</p>' +
            '<p>Last modified: ' + escapeText(preview.entry.lastModified) + '</p>' +
          '</div>';
      } else if (preview.kind === 'image') {
        if (preview.imageDataUri) {
          html += '<img class="image-preview" src="' + preview.imageDataUri + '" alt="' + escapeText(preview.entry.name) + '" />';
        } else {
          html += '<div class="empty-state">Image exceeds the 2 MB inline preview limit.</div>';
        }
      } else if (isTabular && state.tabularMode) {
        const headers = preview.tabular.headers.map((h) => '<th>' + escapeText(h) + '</th>').join('');
        const bodyRows = preview.tabular.rows
          .map((row) => '<tr>' + row.map((c) => '<td>' + escapeText(c) + '</td>').join('') + '</tr>')
          .join('');
        html +=
          '<div class="table-wrap"><table class="csv-table">' +
            '<thead><tr>' + headers + '</tr></thead>' +
            '<tbody>' + bodyRows + '</tbody>' +
          '</table></div>';
      } else {
        html += '<pre class="code-view">' + escapeText(preview.textContent ?? '') + '</pre>';
      }

      previewBodyEl.innerHTML = html;
    }

    sidebarEl.addEventListener('click', (event) => {
      const clearBtn = event.target.closest('#clearSearchBtn');
      if (clearBtn) {
        state.searchResult = null;
        contentSearchEl.value = '';
        renderSidebar();
        return;
      }

      const hitEl = event.target.closest('.search-hit');
      if (hitEl) {
        const entryPath = hitEl.dataset.hitPath;
        const line = Number(hitEl.dataset.hitLine || '1');
        vscode.postMessage({ type: 'openInEditor', entryPath, line });
        return;
      }

      const rowEl = event.target.closest('.tree-row');
      if (!rowEl) return;

      const entryPath = rowEl.dataset.path;
      const isDir = rowEl.dataset.dir === '1';

      if (isDir) {
        if (state.expanded.has(entryPath)) {
          state.expanded.delete(entryPath);
        } else {
          state.expanded.add(entryPath);
        }
        renderSidebar();
      } else {
        state.selectedPath = entryPath;
        state.tabularMode = true;
        renderSidebar();
        previewBodyEl.innerHTML = '<div class="empty-state">Loading preview…</div>';
        vscode.postMessage({ type: 'requestPreview', entryPath });
      }
    });

    sidebarEl.addEventListener('dblclick', (event) => {
      const rowEl = event.target.closest('.tree-row');
      if (!rowEl || rowEl.dataset.dir === '1') return;
      vscode.postMessage({ type: 'openInEditor', entryPath: rowEl.dataset.path });
    });

    nameFilterEl.addEventListener('input', () => {
      state.nameFilter = nameFilterEl.value;
      if (state.searchResult) {
        state.searchResult = null;
      }
      renderSidebar();
    });

    const triggerContentSearch = () => {
      const query = contentSearchEl.value.trim();
      if (!query) {
        state.searchResult = null;
        renderSidebar();
        return;
      }
      sidebarEl.innerHTML = '<div class="empty-state">Searching inside archive…</div>';
      vscode.postMessage({ type: 'searchContent', query });
    };

    contentSearchBtn.addEventListener('click', triggerContentSearch);
    contentSearchEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        triggerContentSearch();
      }
    });

    toggleTabularBtn.addEventListener('click', () => {
      state.tabularMode = !state.tabularMode;
      if (state.currentPreview) {
        renderPreview(state.currentPreview);
      }
    });

    copyBtn.addEventListener('click', () => {
      if (state.currentPreview && state.currentPreview.textContent !== undefined) {
        vscode.postMessage({ type: 'copyText', text: state.currentPreview.textContent });
      }
    });

    openEditorBtn.addEventListener('click', () => {
      if (state.selectedPath) {
        vscode.postMessage({ type: 'openInEditor', entryPath: state.selectedPath });
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'init') {
        state.tree = msg.tree;
        // Auto-expand top-level folders if there are few of them
        if (state.tree.length <= 5) {
          for (const root of state.tree) {
            if (root.isDirectory) state.expanded.add(root.path);
          }
        }
        statsEl.textContent =
          msg.fileCount + ' files • ' +
          formatBytes(msg.totalUncompressed) + ' (' +
          formatBytes(msg.totalCompressed) + ' compressed)';
        renderSidebar();
      } else if (msg.type === 'preview') {
        renderPreview(msg.preview);
      } else if (msg.type === 'searchResults') {
        state.searchResult = msg.result;
        renderSidebar();
      } else if (msg.type === 'error') {
        previewBodyEl.innerHTML = '<div class="banner">' + escapeText(msg.message) + '</div>';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}