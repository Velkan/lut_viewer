/**
 * Main App — LUT Batch Preview
 * Features: persistence, photo delete in drop zone, favorites list
 */
(function () {
  'use strict';

  // ====================================================================
  // Photo persistence API
  // ====================================================================
  const LutUploadAPI = {
    async save(file) {
      var b64 = await new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result.split(',')[1]); };
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      var res = await fetch('/api/upload-lut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: b64, date: new Date().toISOString().slice(0, 10) }),
      });
      var j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Upload failed');
      return j.path;
    },
  };

  const PhotoAPI = {
    async save(file) {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: b64 }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'Upload failed');
      return j.id;
    },

    async loadAll() {
      const res = await fetch('/api/photos');
      return (await res.json()).photos || [];
    },

    async delete(id) {
      await fetch('/api/photo/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    async clearAll() {
      await fetch('/api/clear-photos', { method: 'POST' });
    },
  };

  // ====================================================================
  // State
  // ====================================================================
  const state = {
    photos: [],    // {id, name, img, url}
    luts: [],
    renderedRows: new Set(),
    totalLuts: 0,
    renderQueue: [],
    draining: false,
    observer: null,
    maxPhotos: 5,
    previewWidth: 400,
    favorites: [],
    showOriginal: false,
  };

  

  // ====================================================================
  // DOM
  // ====================================================================
  const $ = id => document.getElementById(id);
  const photoInput = $('photo-input');
  const lutInput = $('lut-input');
  const photoDropZone = $('photo-drop-zone');
  const lutDropZone = $('lut-drop-zone');
  const photoStrip = $('photo-strip');
  const photoCount = $('photo-count');
  const lutCount = $('lut-count');
  const gridContainer = $('grid-container');
  const gridHeader = $('grid-header');
  const gridBody = $('grid-body');
  const progressBar = $('progress-bar');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const statusText = $('status-text');
  const dropArea = $('workspace-row');
  const favList = $('fav-list');

  // ====================================================================
  // Processor
  // ====================================================================
  let processor = null;
  function getProc() {
    if (!processor) { processor = new WebGLProcessor(); processor.init(); }
    return processor;
  }

  // ====================================================================
  // Helpers
  // ====================================================================
  let toastTimer = null;
  function toast(msg, type) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 3000);
  }

  function setStatus(m) { statusText.textContent = m; }

  // Upload progress bar helpers
  function showUploadProgress(total) {
    const bar = $('upload-progress-bar');
    const fill = $('upload-progress-fill');
    const text = $('upload-progress-text');
    bar.hidden = false;
    fill.style.width = '0%';
    text.textContent = '0 / ' + total;
  }

  function updateUploadProgress(done, total) {
    const fill = $('upload-progress-fill');
    const text = $('upload-progress-text');
    fill.style.width = Math.round((done / total) * 100) + '%';
    text.textContent = done + ' / ' + total;
  }

  function hideUploadProgress() {
    $('upload-progress-bar').hidden = true;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Cannot load: ' + src.slice(0, 60)));
      img.src = src;
    });
  }

  // RAW file extensions for server-side conversion via macOS sips
  const RAW_EXTENSIONS = [
    '.cr2', '.cr3', '.crw',    // Canon
    '.nef', '.nrw',             // Nikon
    '.arw', '.srf', '.sr2',     // Sony
    '.raf',                     // Fujifilm
    '.orf',                     // Olympus
    '.rw2',                     // Panasonic
    '.dng',                     // Adobe / Leica
    '.pef',                     // Pentax
    '.x3f',                     // Sigma
    '.3fr', '.fff',             // Hasselblad
    '.rwl',                     // Leica
    '.gpr',                     // GoPro
  ];

  function isRawFile(file) {
    const i = file.name.lastIndexOf('.');
    if (i < 0) return false;
    return RAW_EXTENSIONS.includes('.' + file.name.slice(i + 1).toLowerCase());
  }

  // ====================================================================
  // Photo CRUD
  // ====================================================================
  async function downsample(file, maxW) {
  const img = await loadImage(URL.createObjectURL(file));
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise(function (resolve) {
    c.toBlob(function (blob) {
      blob.name = file.name;
      resolve(blob);
    }, 'image/jpeg', 0.85);
  });
}

async function addPhotos(files) {
    const valid = Array.from(files).filter(function (f) {
      return f.type.startsWith('image/') || isRawFile(f);
    });
    const canAdd = state.maxPhotos - state.photos.length;
    if (canAdd <= 0) { toast('最多 ' + state.maxPhotos + ' 张照片', 'error'); return; }
    const batch = valid.slice(0, canAdd);
    showUploadProgress(batch.length);
    for (let fi = 0; fi < batch.length; fi++) {
      const file = batch[fi];
      try {
        let id, blobUrl, img;
        if (isRawFile(file)) {
          // RAW: upload full file to server for conversion
          const b64 = await new Promise(function (resolve, reject) {
            const r = new FileReader();
            r.onload = function () { resolve(r.result.split(',')[1]); };
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          const res = await fetch('/api/upload-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, data: b64 }),
          });
          const j = await res.json();
          if (!j.ok) throw new Error(j.error || 'Upload failed');
          id = j.id;
          const serverUrl = 'photo-uploads/' + id;
          img = await loadImage(serverUrl);
          blobUrl = serverUrl;
        } else {
          const smallBlob = await downsample(file, 1920);
          id = await PhotoAPI.save(smallBlob);
          blobUrl = URL.createObjectURL(smallBlob);
          img = await loadImage(blobUrl);
        }
        state.photos.push({ id: id, name: file.name, img: img, url: blobUrl });
      } catch (e) {
        console.error('Upload err:', file.name, e);
        toast('上传失败: ' + file.name, 'error');
      }
      updateUploadProgress(fi + 1, batch.length);
    }
    hideUploadProgress();
    updatePhotoUI();
    rebuildGrid();
  }

  async function removePhoto(idx) {
    const p = state.photos[idx];
    if (!p) return;
    try { await PhotoAPI.delete(p.id); } catch (e) { /* ignore */ }
    if (p.url && p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
    state.photos.splice(idx, 1);
    if (processor && processor.photoCache) processor.photoCache.clear();
    updatePhotoUI();
    rebuildGrid();
  }

  async function clearPhotos() {
    for (const p of state.photos) {
      try { await PhotoAPI.delete(p.id); } catch (e) { /* ignore */ }
      if (p.url && p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
    }
    if (processor && processor.photoCache) processor.photoCache.clear();
    state.photos = [];
    updatePhotoUI();
    rebuildGrid();
  }

  // ====================================================================
  // Favorites
  // ====================================================================
  function saveFavorites() {
    /* page-level only, no persistence */
  }

  async function toggleFavorite(lutTitle, lutName, lutPath) {
    const idx = state.favorites.findIndex(f => f.title === lutTitle);
    if (idx >= 0) {
      const removed = state.favorites[idx];
      if (removed.path) {
        try {
          await fetch('/api/delete-lut', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: removed.path }),
          });
        } catch (e) {}
      }
      state.favorites.splice(idx, 1);
    } else {
      var path = lutPath;
      var lut = state.luts.find(function (l) { return l.title === lutTitle; });
      if (lut && lut._fileText) {
        var blob = new Blob([lut._fileText], { type: 'text/plain' });
        blob.name = lut.title;
        try {
          path = await LutUploadAPI.save(blob);
        } catch (e) {}
      }
      state.favorites.push({ title: lutTitle, name: lutName, path: path });
    }
    saveFavorites();
    renderFavorites();
    document.querySelectorAll('.star-btn[data-lut]').forEach(el => {
      if (el.dataset.lut === lutTitle) {
        el.classList.toggle('starred', idx < 0);
        el.textContent = idx < 0 ? '\u2605' : '\u2606';
      }
    });
  }

  function renderFavorites() {
    favList.innerHTML = '';
    if (!state.favorites.length) {
      favList.innerHTML = '<div class="fav-empty">暂无收藏</div>';
      // Remove copy button if exists
      var cb = document.getElementById('fav-open-btn');
      if (cb) cb.remove();
      return;
    }
    // Ensure copy button exists
    var cb = document.getElementById('fav-open-btn');
    if (!cb) {
      cb = document.createElement('button');
      cb.id = 'fav-open-btn';
      cb.className = 'btn btn-sm';
      cb.textContent = '打开目录';
      cb.title = '打开 lut-uploads/ 文件夹';
      cb.addEventListener('click', function () {
        fetch('/api/open-lut-dir').then(function (r) { return r.json(); }).then(function (j) {
          if (!j.ok) toast('打开失败', 'error');
        }).catch(function () { toast('请求失败', 'error'); });
      });
      var titleEl = document.querySelector('.fav-section-title');
      if (titleEl) {
        var actions = titleEl.querySelector('.fav-section-actions');
        if (!actions) {
          actions = document.createElement('div');
          actions.className = 'fav-section-actions';
          titleEl.appendChild(actions);
        }
        actions.appendChild(cb);
      }
    }
    state.favorites.forEach(function (f, fi) {
      const d = document.createElement('div');
      d.className = 'fav-item';
      d.title = f.title;
      const inner = document.createElement('div');
      inner.className = 'fav-item-inner';
      const nl = document.createElement('div');
      nl.className = 'fav-name';
      nl.textContent = f.title;
      const pl = document.createElement('div');
      pl.className = 'fav-path';
      pl.textContent = f.path || f.title;
      inner.appendChild(nl); inner.appendChild(pl);
      d.appendChild(inner);
      const del = document.createElement('button');
      del.className = 'photo-thumb-del';
      del.style.position = 'static';
      del.style.opacity = '1';
      del.innerHTML = '×';
      del.title = '取消收藏';
      del.addEventListener('click', function () { toggleFavorite(f.title, f.name || f.title); });
      d.appendChild(del);
      favList.appendChild(d);
    });
  }

  // ====================================================================
  // Photo UI — thumbnails in drop zone
  // ====================================================================
  function updatePhotoUI() {
    photoCount.textContent = state.photos.length + ' 照片';
    photoStrip.innerHTML = '';
    state.photos.forEach((p, i) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'photo-thumb-wrap';
      wrapper.dataset.idx = i;
      const img = document.createElement('img');
      img.className = 'photo-thumb';
      img.src = p.img.src;
      img.alt = p.name;
      img.title = p.name;
      const label = document.createElement('div');
      label.className = 'photo-thumb-label';
      label.textContent = (i + 1) + '. ' + p.name;
      const del = document.createElement('button');
      del.className = 'photo-thumb-del';
      del.innerHTML = '\u00d7';
      del.title = '删除此照片';
      del.addEventListener('click', async function (e) {
        e.stopPropagation();
        await removePhoto(i);
      });
      wrapper.appendChild(img);
      wrapper.appendChild(del);
      wrapper.appendChild(label);
      photoStrip.appendChild(wrapper);
    });
  }

  // ====================================================================
  // Persisted photo loading
  // ====================================================================
  async function loadPersistedPhotos() {
    try {
      const list = await PhotoAPI.loadAll();
      if (!list.length) { setStatus('上传照片并选择 LUT 文件以开始预览'); return; }
      setStatus('正在恢复 ' + list.length + ' 张照片...');
      let ok = 0;
      for (const item of list) {
        try {
          const serverUrl = 'photo-uploads/' + item.id;
          const img = await loadImage(serverUrl);
          state.photos.push({ id: item.id, name: item.name || item.id, img, url: serverUrl });
          ok++;
        } catch (e) {
          console.warn('跳过无法读取的照片:', item.name, e.message);
          try { await PhotoAPI.delete(item.id); } catch (_) { /* ignore */ }
        }
      }
      if (ok > 0) {
        updatePhotoUI();
        setStatus('已恢复 ' + ok + ' 张照片，添加 LUT 后开始预览');
      } else {
        setStatus('上传照片并选择 LUT 文件以开始预览');
      }
    } catch (e) {
      console.warn('加载持久化照片失败:', e.message);
      toast('服务器连接失败，请确保服务器已启动', 'error');
      setStatus('上传照片并选择 LUT 文件以开始预览');
    }
  }

  // ====================================================================
  // LUT loading
  // ====================================================================
  async function loadLuts(files) {
        const valid = Array.from(files).filter(function (f) { return /\.(cube|3dl|look)$/i.test(f.name); });
        if (!valid.length) { toast('没有选择有效的 .cube 文件', 'error'); return; }
    if (state.luts.length + valid.length > 999) { toast('最多 999 个 LUT', 'error'); return; }
    setStatus('正在解析 ' + valid.length + ' 个 LUT...');
        var parseResults = await Promise.all(valid.map(function (f) {
      return f.text().then(async function (t) {
        try {
          var p = LutParser.parse(t, f.name);
                    state.luts.push(p);
                    // Store original text for on-demand upload
                    try { p._fileText = t; } catch (e) {}
        } catch (e) {
          console.error('Parse ERR:', f.name, e.message);
        }
      }).catch(function (e) {
        console.error('Read ERR:', f.name, e.message);
      });
    }));
        state.luts.sort(function (a, b) { return a.title.localeCompare(b.title); });
    updateLutUI();
    if (state.luts.length > 0) {
      toast('已加载 ' + state.luts.length + ' 个 LUT', 'success');
      rebuildGrid();
    } else {
      toast('解析失败，请检查 .cube 文件格式', 'error');
    }
  }

  function updateLutUI() { lutCount.textContent = state.luts.length + ' LUT'; }

  // ====================================================================
  // Grid
  // ====================================================================
  function rebuildGrid() {
        if (!gridContainer) return;
    if (state.photos.length === 0) {
      gridContainer.hidden = true;
      dropArea.hidden = false;
      if (state.observer) { state.observer.disconnect(); state.observer = null; }
      state.renderedRows.clear();
      state.renderQueue = [];
      state.totalLuts = 0;
      gridBody.innerHTML = '';
      gridHeader.innerHTML = '';
      progressBar.hidden = true;
      return;
    }
    if (!gridContainer || !dropArea) return;
    dropArea.hidden = true;
    gridContainer.hidden = false;
    state.renderedRows.clear();
    state.renderQueue = [];
    if (state.observer) state.observer.disconnect();
    gridBody.innerHTML = '';
    buildHeader();
    if (state.luts.length === 0) {
      setStatus('已加载 ' + state.photos.length + ' 张照片，添加 LUT 开始预览');
      return;
    }
    state.totalLuts = state.luts.length;
    setStatus('已加载 ' + state.totalLuts + ' 个 LUT');
        const rows = [];
    for (let i = 0; i < state.totalLuts; i++) {
      rows.push(createRow(i));
    }
        rows.forEach(r => gridBody.appendChild(r));
        state.observer = new IntersectionObserver(function (entries) {
      let needed = false;
      for (const e of entries) {
        if (e.isIntersecting) {
          const idx = parseInt(e.target.dataset.index, 10);
          if (!state.renderedRows.has(idx)) {
            state.renderedRows.add(idx);
            state.renderQueue.push(idx);
            needed = true;
          }
        }
      }
      if (needed) drainQueue();
    }, { root: gridContainer, rootMargin: '400px' });
        rows.forEach(r => state.observer.observe(r));
        for (let i = 0; i < Math.min(10, state.totalLuts); i++) {
      if (!state.renderedRows.has(i)) { state.renderedRows.add(i); state.renderQueue.push(i); }
    }
        drainQueue();
      }

  function buildHeader() {
    gridHeader.innerHTML = '';
    const nc = document.createElement('div');
    nc.className = 'grid-cell name-cell';
    nc.textContent = 'LUT 文件';
    gridHeader.appendChild(nc);
    state.photos.forEach(function (_, i) {
      const c = document.createElement('div');
      c.className = 'grid-cell name-cell';
      if (state.showOriginal) {
        c.style.cssText = 'flex:1;width:auto;min-width:0;padding:0;display:flex;gap:1px;background:var(--border);border-radius:2px;overflow:hidden';
        const ol = document.createElement('div');
        ol.style.cssText = 'flex:1;text-align:center;padding:3px 0;font-size:10px;color:var(--text-dim);background:var(--surface)';
        ol.textContent = '原图';
        const rl = document.createElement('div');
        rl.style.cssText = 'flex:1;text-align:center;padding:3px 0;font-size:10px;color:var(--text-dim);background:var(--surface)';
        rl.textContent = 'LUT';
        c.appendChild(ol);
        c.appendChild(rl);
      } else {
        c.style.cssText = 'flex:1;justify-content:center;width:auto;min-width:0';
        c.textContent = 'LUT';
      }
      gridHeader.appendChild(c);
    });
  }
  // Row factory
  // ====================================================================
  function createRow(idx) {
    const row = document.createElement('div');
    row.className = 'grid-body-row grid-row';
    row.dataset.index = idx;
    const lut = state.luts[idx];
    const nc = document.createElement('div');
    nc.className = 'grid-cell name-cell';
    nc.style.cssText = 'gap:4px';
    const star = document.createElement('button');
    star.className = 'star-btn';
    star.dataset.lut = lut.title;
    const isFav = state.favorites.some(function (f) { return f.title === lut.title; });
    star.textContent = isFav ? '\u2605' : '\u2606';
    star.title = isFav ? '取消收藏' : '收藏此 LUT';
    star.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFavorite(lut.title, lut.title.replace(/\.cube$/i, ''), './' + lut.title);
    });
    nc.appendChild(star);
    const ns = document.createElement('span');
    ns.className = 'lut-name';
    ns.title = lut.title;
    ns.textContent = lut.title.replace(/\.cube$/i, '');
    nc.appendChild(ns);
    row.appendChild(nc);
    for (let p = 0; p < state.photos.length; p++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell preview-cell';
      if (state.showOriginal) {
        // Two sub-cells: original + LUT-applied
        const orig = document.createElement('div');
        orig.className = 'preview-sub preview-original';
        const origImg = document.createElement('img');
        origImg.src = state.photos[p].img.src;
        origImg.alt = '原图';
        orig.appendChild(origImg);
        cell.appendChild(orig);
        // Right: LUT-applied placeholder
        const applied = document.createElement('div');
        applied.className = 'preview-sub preview-applied';
        const ph = document.createElement('div');
        ph.className = 'cell-placeholder';
        applied.appendChild(ph);
        cell.appendChild(applied);
      } else {
        // Single cell: just LUT-applied result
        const ph = document.createElement('div');
        ph.className = 'cell-placeholder';
        cell.appendChild(ph);
      }
      row.appendChild(cell);
    }
    return row;
  }

// ====================================================================
  // Render queue
  // ====================================================================
  async function drainQueue() {
        if (state.draining) return;
    state.draining = true;
    progressBar.hidden = false;
    while (state.renderQueue.length > 0) {
      const batch = state.renderQueue.splice(0, 5);
            const proc = getProc();
      if (!proc) { state.draining = false; return; }
      for (const idx of batch) {
        const lut = state.luts[idx];
        if (!lut) continue;
        const canvases = [];
        for (let p = 0; p < state.photos.length; p++) {
          try {
            canvases.push(proc.renderPreview(state.photos[p].img, lut.data, lut.size, state.previewWidth));
          } catch (e) { canvases.push(null); }
        }
                const row = gridBody.querySelector('[data-index="' + idx + '"]');
        if (row) {
          const cells = row.querySelectorAll('.preview-cell');
          canvases.forEach(function (cv, ci) {
            if (cells[ci] && cv) {
              if (state.showOriginal) {
                const appliedDiv = cells[ci].querySelector('.preview-applied');
                if (appliedDiv) {
                  const img = document.createElement('img');
                  img.src = cv.toDataURL();
                  appliedDiv.innerHTML = '';
                  appliedDiv.appendChild(img);
                }
              } else {
                cells[ci].innerHTML = '';
                const img = document.createElement('img');
                img.src = cv.toDataURL();
                cells[ci].appendChild(img);
              }
            }
          });
        }
const done = state.renderedRows.size;
        progressFill.style.width = Math.round((done / state.totalLuts) * 100) + '%';
        progressText.textContent = done + ' / ' + state.totalLuts;
        setStatus(done + ' / ' + state.totalLuts);
        await new Promise(function (r) { setTimeout(r, 0); });
      }
    }
    state.draining = false;
    progressBar.hidden = true;
    setStatus('完成 \u2014 ' + state.totalLuts + ' 个 LUT');
  }

  // ====================================================================
  // Clear all
  // ====================================================================
  async function clearAll() {
    for (const p of state.photos) {
      try { await PhotoAPI.delete(p.id); } catch (e) { /* ignore */ }
      if (p.url && p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
    }
    try { await PhotoAPI.clearAll(); } catch (e) { /* ignore */ }
    state.luts = [];
    state.renderedRows.clear();
    state.renderQueue = [];
    state.totalLuts = 0;
    state.draining = false;
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (processor) { processor.photoCache = new Map(); processor.lutCache = new Map(); }
    state.photos = [];
    photoStrip.innerHTML = '';
    photoCount.textContent = '0 照片';
    lutCount.textContent = '0 LUT';
    gridBody.innerHTML = '';
    gridHeader.innerHTML = '';
    if (gridContainer) gridContainer.hidden = true;
    progressBar.hidden = true;
    dropArea.hidden = false;
    progressFill.style.width = '0%';
    setStatus('已清空');
  }

  // ====================================================================
  // Drag & Drop — single window-level handler
  // ====================================================================
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('dragenter', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    var files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    var target = e.target.closest('.drop-zone');
    if (target && target.id === 'photo-drop-zone') {
      addPhotos(files);
    } else if (target && target.id === 'lut-drop-zone') {
      loadLuts(files);
    } else {
      // Drop outside zones
      var imgs = files.filter(function (f) { return f.type.startsWith('image/') || isRawFile(f); });
      var luts = files.filter(function (f) { return /\.(cube|3dl|look)$/i.test(f.name); });
      if (imgs.length) addPhotos(imgs);
      if (luts.length) loadLuts(luts);
    }
  });

  // Visual feedback on drop zones
  document.addEventListener('dragover', function (e) {
    var zone = e.target.closest('.drop-zone');
    if (zone) zone.classList.add('drag-over');
  });
  document.addEventListener('dragleave', function (e) {
    var zone = e.target.closest('.drop-zone');
    if (zone) zone.classList.remove('drag-over');
  });
  document.addEventListener('drop', function (e) {
    var zone = e.target.closest('.drop-zone');
    if (zone) zone.classList.remove('drag-over');
  });

  // Click to open file picker
  photoDropZone.addEventListener('click', function () { photoInput.click(); });
  lutDropZone.addEventListener('click', function () { lutInput.click(); });

  // ====================================================================
  // Init
  // ====================================================================
  async function init() {
    $('btn-photos').addEventListener('click', function () { photoInput.click(); });
    photoInput.addEventListener('change', function (e) {
      if (e.target.files.length) { addPhotos(e.target.files); e.target.value = ''; }
    });
    $('btn-luts').addEventListener('click', function () { lutInput.click(); });
    lutInput.addEventListener('change', function (e) {
      if (e.target.files.length) { loadLuts(e.target.files); e.target.value = ''; }
    });
    $('btn-clear').addEventListener('click', clearAll);
    $('btn-toggle-orig').addEventListener('click', function () {
      state.showOriginal = !state.showOriginal;
      this.classList.toggle('btn-active', state.showOriginal);
      this.innerHTML = state.showOriginal
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> 已展示原图'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> 未展示原图'
      rebuildGrid();
    });

    renderFavorites();
    await loadPersistedPhotos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
