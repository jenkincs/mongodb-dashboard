/* global JSONEditor */
(function () {
  const state = {
    connected: false,
    currentDb: null,
    currentColl: null,
    selectedDoc: null,
    documents: [],
  };

  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const status = qs('#status');

  function setStatus(text, type = 'info') {
    const map = { info: 'text-gray-700', success: 'text-emerald-700', error: 'text-red-700' };
    status.className = `mb-4 text-sm ${map[type] || map.info}`;
    status.textContent = text || '';
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  function renderList(el, items, onClick, key = 'name') {
    el.innerHTML = '';
    items.forEach((it) => {
      const li = document.createElement('li');
      li.innerHTML = `<button class="w-full text-left px-2 py-1 rounded hover:bg-gray-100">${it[key] || it}</button>`;
      li.querySelector('button').addEventListener('click', () => onClick(it));
      el.appendChild(li);
    });
  }

  let editor = null;
  function initEditor() {
    const container = qs('#editor');
    editor = new JSONEditor(container, {
      modes: ['tree', 'code'],
      mainMenuBar: false,
      navigationBar: false,
    });
  }

  function getEjsonTextOrEmpty(el) {
    const v = el.value.trim();
    if (!v) return undefined;
    return v;
  }

  async function connect() {
    const uri = qs('#uri').value.trim();
    if (!uri) return setStatus('Please enter a MongoDB connection URI', 'error');
    try {
      setStatus('Connecting...');
      await api('/api/connect', { method: 'POST', body: JSON.stringify({ uri }) });
      state.connected = true;
      qs('#connectBtn').classList.add('hidden');
      qs('#disconnectBtn').classList.remove('hidden');
      await refreshDatabases();
      setStatus('Connected', 'success');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function disconnect() {
    try {
      await api('/api/disconnect', { method: 'POST' });
    } catch (_) {}
    state.connected = false;
    state.currentDb = null;
    state.currentColl = null;
    qs('#dbList').innerHTML = '';
    qs('#collList').innerHTML = '';
    qs('#connectBtn').classList.remove('hidden');
    qs('#disconnectBtn').classList.add('hidden');
    setStatus('Disconnected');
  }

  async function refreshDatabases() {
    if (!state.connected) return;
    try {
      const data = await api('/api/databases');
      renderList(qs('#dbList'), data.databases, (db) => selectDb(db.name));
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function selectDb(dbName) {
    state.currentDb = dbName;
    state.currentColl = null;
    qs('#collList').innerHTML = '';
    try {
      const data = await api(`/api/databases/${encodeURIComponent(dbName)}/collections`);
      renderList(qs('#collList'), data.collections, (c) => selectColl(c.name));
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function selectColl(collName) {
    state.currentColl = collName;
    state.selectedDoc = null;
    editor.set({});
    await runQuery();
  }

  async function runQuery() {
    if (!state.currentDb || !state.currentColl) return setStatus('Select a database and collection first', 'error');
    const filter = getEjsonTextOrEmpty(qs('#filterInput'));
    const sort = getEjsonTextOrEmpty(qs('#sortInput'));
    const projection = getEjsonTextOrEmpty(qs('#projInput'));
    const skip = Number(qs('#skipInput').value || '0');
    const limit = Number(qs('#limitInput').value || '50');
    const params = new URLSearchParams();
    if (filter) params.set('filter', filter);
    if (sort) params.set('sort', sort);
    if (projection) params.set('projection', projection);
    params.set('skip', String(skip));
    params.set('limit', String(limit));
    try {
      setStatus('Querying...');
      const data = await api(`/api/databases/${encodeURIComponent(state.currentDb)}/collections/${encodeURIComponent(state.currentColl)}/documents?${params.toString()}`);
      state.documents = data.documents || [];
      renderResults(state.documents);
      setStatus(`Loaded ${state.documents.length} documents`, 'success');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  function renderResults(docs) {
    const container = qs('#results');
    container.innerHTML = '';
    if (!docs.length) {
      container.innerHTML = '<div class="text-sm text-gray-600">No documents</div>';
      return;
    }
    docs.forEach((doc, idx) => {
      const card = document.createElement('div');
      card.className = 'border border-gray-200 rounded p-3 mb-2 hover:bg-gray-50';
      const id = doc._id && (doc._id.$oid || doc._id);
      const title = id ? String(id) : `(index ${idx})`;
      const pre = document.createElement('pre');
      pre.className = 'text-xs whitespace-pre-wrap text-gray-800 max-h-48 overflow-auto';
      pre.textContent = JSON.stringify(doc, null, 2);
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between';
      const left = document.createElement('div');
      left.className = 'font-mono text-xs text-gray-700 truncate';
      left.textContent = title;
      const btns = document.createElement('div');
      btns.className = 'space-x-2';
      const editBtn = document.createElement('button');
      editBtn.className = 'text-brand text-sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => selectDoc(doc));
      const delBtn = document.createElement('button');
      delBtn.className = 'text-red-600 text-sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteDoc(doc));
      btns.appendChild(editBtn);
      btns.appendChild(delBtn);
      row.appendChild(left);
      row.appendChild(btns);
      card.appendChild(row);
      card.appendChild(pre);
      container.appendChild(card);
    });
  }

  function selectDoc(doc) {
    state.selectedDoc = doc;
    editor.set(doc);
  }

  async function saveSelected() {
    if (!state.currentDb || !state.currentColl) return;
    const doc = editor.get();
    const id = doc && doc._id && (doc._id.$oid || doc._id);
    try {
      if (id) {
        await api(`/api/databases/${encodeURIComponent(state.currentDb)}/collections/${encodeURIComponent(state.currentColl)}/documents/${encodeURIComponent(id)}`,
          { method: 'PUT', body: JSON.stringify(doc) });
        setStatus('Updated document', 'success');
      } else {
        const res = await api(`/api/databases/${encodeURIComponent(state.currentDb)}/collections/${encodeURIComponent(state.currentColl)}/documents`,
          { method: 'POST', body: JSON.stringify(doc) });
        setStatus(`Inserted document ${res.insertedId}`, 'success');
      }
      await runQuery();
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function deleteDoc(doc) {
    if (!state.currentDb || !state.currentColl) return;
    const id = doc && doc._id && (doc._id.$oid || doc._id);
    if (!id) return setStatus('Cannot delete document without _id', 'error');
    if (!confirm('Delete this document?')) return;
    try {
      await api(`/api/databases/${encodeURIComponent(state.currentDb)}/collections/${encodeURIComponent(state.currentColl)}/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setStatus('Deleted document', 'success');
      if (state.selectedDoc && (state.selectedDoc._id && (state.selectedDoc._id.$oid || state.selectedDoc._id)) === id) {
        state.selectedDoc = null;
        editor.set({});
      }
      await runQuery();
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  function addDoc() {
    state.selectedDoc = null;
    editor.set({});
  }

  function showImportModal(show) {
    const modal = qs('#importModal');
    modal.classList.toggle('hidden', !show);
    modal.classList.toggle('flex', show);
  }

  async function importDocs() {
    if (!state.currentDb || !state.currentColl) return;
    const text = qs('#importTextarea').value.trim();
    if (!text) return showImportModal(false);
    try {
      const data = JSON.parse(text);
      await api(`/api/databases/${encodeURIComponent(state.currentDb)}/collections/${encodeURIComponent(state.currentColl)}/import`, {
        method: 'POST',
        body: JSON.stringify(Array.isArray(data) ? data : data.documents || []),
      });
      setStatus('Imported documents', 'success');
      showImportModal(false);
      await runQuery();
    } catch (e) {
      setStatus('Invalid JSON: ' + e.message, 'error');
    }
  }

  async function exportDocs() {
    if (!state.currentDb || !state.currentColl) return;
    const filter = getEjsonTextOrEmpty(qs('#filterInput'));
    const params = new URLSearchParams();
    if (filter) params.set('filter', filter);
    const url = `/api/databases/${encodeURIComponent(state.currentDb)}/collections/${encodeURIComponent(state.currentColl)}/export?${params.toString()}`;
    window.open(url, '_blank');
  }

  function bind() {
    qs('#connectBtn').addEventListener('click', connect);
    qs('#disconnectBtn').addEventListener('click', disconnect);
    qs('#refreshDbs').addEventListener('click', refreshDatabases);
    qs('#refreshCollections').addEventListener('click', () => state.currentDb && selectDb(state.currentDb));
    qs('#runQuery').addEventListener('click', runQuery);
    qs('#saveDocBtn').addEventListener('click', saveSelected);
    qs('#addDocBtn').addEventListener('click', addDoc);
    qs('#deleteDocBtn').addEventListener('click', () => state.selectedDoc && deleteDoc(state.selectedDoc));
    qs('#importBtn').addEventListener('click', () => showImportModal(true));
    qs('#closeImport').addEventListener('click', () => showImportModal(false));
    qs('#confirmImport').addEventListener('click', importDocs);
  }

  // init
  initEditor();
  bind();
  setStatus('Enter a MongoDB URI and click Connect');
})();

