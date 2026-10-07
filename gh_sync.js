/* ===== GITHUB AUTO-SYNC cho TestPoint =====
 * Cấu hình: điền username/repo + token 1 lần (lưu localStorage).
 * Chức năng:
 *  - Upload ảnh thẳng vào images/ trên repo qua GitHub API (Contents)
 *  - Tự cập nhật data.json (append entry) + commit
 *  - Xem danh sách entry hiện có, xóa entry
 */
const GH_CFG_KEY = 'gh_sync_cfg';
const GH_DB_KEY = 'testpoint_db';

function ghGetCfg() {
  try { return JSON.parse(localStorage.getItem(GH_CFG_KEY) || '{}'); } catch(e) { return {}; }
}
function ghSaveCfg(cfg) {
  localStorage.setItem(GH_CFG_KEY, JSON.stringify(cfg));
}
function ghApiUrl(cfg, path, ref) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}${ref ? '?ref=' + ref : ''}`;
}
function ghHeaders(cfg) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + cfg.token,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function ghTestConnection() {
  const cfg = ghGetCfg();
  const msg = document.getElementById('ghMsg');
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    ghShowMsg('⚠ Nhập đủ Username, Repo và Token trước!', '#f85149');
    return;
  }
  ghShowMsg('⏳ Đang kiểm tra kết nối...', '#d29922');
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: ghHeaders(cfg) });
    if (r.ok) {
      const j = await r.json();
      ghShowMsg(`✅ Kết nối OK — repo: ${j.full_name} (${j.private ? 'private' : 'public'})`, '#7ee787');
    } else if (r.status === 401) {
      ghShowMsg('❌ Token sai hoặc hết hạn (401)', '#f85149');
    } else if (r.status === 404) {
      ghShowMsg('❌ Không tìm thấy repo (404) — kiểm tra tên/owner', '#f85149');
    } else {
      ghShowMsg('❌ Lỗi HTTP ' + r.status, '#f85149');
    }
  } catch(e) {
    ghShowMsg('❌ Lỗi mạng: ' + e.message, '#f85149');
  }
}

// Upload 1 file nhị phân/text vào repo (Contents API). Tạo commit tự động.
async function ghUploadFile(cfg, path, contentBase64, message) {
  // Kiểm file đã tồn tại để lấy sha (cần cho overwrite)
  let sha = undefined;
  const check = await fetch(ghApiUrl(cfg, path), { headers: ghHeaders(cfg) });
  if (check.ok) {
    const j = await check.json();
    sha = j.sha;
  }
  const body = {
    message: message,
    content: contentBase64,
    branch: cfg.branch || 'main'
  };
  if (sha) body.sha = sha;
  const r = await fetch(ghApiUrl(cfg, path), {
    method: 'PUT',
    headers: ghHeaders(cfg),
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Upload ${path} lỗi HTTP ${r.status}: ${errText.slice(0, 200)}`);
  }
  return await r.json();
}

// Đọc data.json hiện tại trên repo
async function ghReadDataJson(cfg) {
  const r = await fetch(ghApiUrl(cfg, 'data.json'), { headers: ghHeaders(cfg) });
  if (!r.ok) throw new Error('Không đọc được data.json (HTTP ' + r.status + ')');
  const j = await r.json();
  const text = atob(j.content.replace(/\n/g, ''));
  let data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('data.json trên GitHub không phải JSON hợp lệ!'); }
  return { sha: j.sha, data: data };
}

// Ghi data.json mới
async function ghWriteDataJson(cfg, sha, data, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const body = {
    message: message,
    content: content,
    branch: cfg.branch || 'main'
  };
  if (sha) body.sha = sha;
  const r = await fetch(ghApiUrl(cfg, 'data.json'), {
    method: 'PUT',
    headers: ghHeaders(cfg),
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('Ghi data.json lỗi HTTP ' + r.status + ': ' + t.slice(0, 200));
  }
  return await r.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result: "data:image/png;base64,XXXX" — cắt bỏ prefix
      const b64 = reader.result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== AUTO SYNC: chọn file + nhập info → 1 nút bấm → upload + cập nhật data.json =====
async function ghAutoSync() {
  const cfg = ghGetCfg();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    ghShowMsg('⚠ Cấu hình GitHub chưa xong! Điền ở khung trên rồi Test kết nối.', '#f85149');
    return;
  }

  const model = document.getElementById('brandModel').value.trim();
  const title = document.getElementById('displayName').value.trim();
  const fileInput = document.getElementById('imageFile');
  const manualName = document.getElementById('imageFileName').value.trim();

  if (!title) { ghShowMsg('⚠ Chưa nhập Tên hiển thị!', '#f85149'); return; }

  const statusEl = document.getElementById('ghSyncStatus');
  statusEl.style.display = 'block';

  try {
    let fileName, fileObj = null;
    if (fileInput.files && fileInput.files[0]) {
      fileObj = fileInput.files[0];
      fileName = fileObj.name;
    } else if (manualName) {
      fileName = manualName;
    } else {
      ghShowMsg('⚠ Chưa chọn file ảnh hoặc gõ tên file!', '#f85149');
      statusEl.style.display = 'none';
      return;
    }

    // Bước 1: Upload ảnh (nếu có file chọn)
    if (fileObj) {
      statusEl.textContent = '⏳ [1/2] Đang upload ảnh ' + fileName + ' lên GitHub...';
      const b64 = await fileToBase64(fileObj);
      await ghUploadFile(cfg, 'images/' + fileName, b64, 'Thêm ảnh testpoint: ' + fileName);
    } else {
      // Không có file: kiểm file đã tồn tại trên repo chưa
      statusEl.textContent = '⏳ [1/2] Kiểm tra ảnh đã có trên GitHub...';
      const check = await fetch(ghApiUrl(cfg, 'images/' + fileName), { headers: ghHeaders(cfg) });
      if (!check.ok) {
        throw new Error('Ảnh "' + fileName + '" chưa có trên repo! Hãy chọn file từ máy để upload.');
      }
    }

    // Bước 2: Đọc + cập nhật data.json
    statusEl.textContent = '⏳ [2/2] Đang cập nhật data.json...';
    const { sha, data } = await ghReadDataJson(cfg);
    const safeImagePath = 'images/' + encodeURI(fileName);
    // Trùng entry thì cập nhật, chưa có thì thêm
    const existing = data.find(x => x.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      existing.image = safeImagePath;
      if (model) existing.keyword = model.toLowerCase();
      if (model) existing.id = model;
    } else {
      data.push({
        id: model || title.toLowerCase().replace(/\s+/g, '_'),
        title: title,
        keyword: (model || title).toLowerCase(),
        image: safeImagePath
      });
    }
    await ghWriteDataJson(cfg, sha, data, 'Cập nhật testpoint: ' + title);

    statusEl.textContent = '✅ XONG! ' + title + ' đã lên GitHub. Chờ 1-2 phút rồi tra cứu được.';
    statusEl.style.color = '#7ee787';
    ghShowMsg('✅ Đã đồng bộ thành công!', '#7ee787');
    // Reset form + refresh local db
    document.getElementById('brandModel').value = '';
    document.getElementById('displayName').value = '';
    document.getElementById('imageFile').value = '';
    document.getElementById('imageFileName').value = '';
    updatePreview();
    if (typeof renderDatabase === 'function') renderDatabase();
    if (typeof ghRenderEntries === 'function') ghRenderEntries();
    setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
  } catch(e) {
    statusEl.textContent = '❌ Lỗi: ' + e.message;
    statusEl.style.color = '#f85149';
  }
}

// Xem + xóa entry trong data.json trên GitHub
async function ghRenderEntries() {
  const cfg = ghGetCfg();
  const listEl = document.getElementById('ghEntryList');
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    listEl.innerHTML = '<div class="gh-entry-empty">Chưa cấu hình GitHub.</div>';
    return;
  }
  listEl.innerHTML = '<div class="gh-entry-empty">⏳ Đang tải...</div>';
  try {
    const { data } = await ghReadDataJson(cfg);
    if (!data.length) {
      listEl.innerHTML = '<div class="gh-entry-empty">data.json trống.</div>';
      return;
    }
    listEl.innerHTML = '';
    data.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'gh-entry';
      row.innerHTML = `
        <span class="gh-entry-title">${i + 1}. ${item.title}</span>
        <span class="gh-entry-img">${item.image}</span>
        <button class="gh-del" data-i="${i}">✕</button>`;
      row.querySelector('.gh-del').onclick = () => ghDeleteEntry(i);
      listEl.appendChild(row);
    });
  } catch(e) {
    listEl.innerHTML = '<div class="gh-entry-empty">❌ ' + e.message + '</div>';
  }
}

async function ghDeleteEntry(idx) {
  const cfg = ghGetCfg();
  if (!confirm('Xóa entry #' + (idx + 1) + ' khỏi data.json?')) return;
  const statusEl = document.getElementById('ghSyncStatus');
  statusEl.style.display = 'block';
  try {
    statusEl.textContent = '⏳ Đang xóa...';
    const { sha, data } = await ghReadDataJson(cfg);
    const removed = data.splice(idx, 1);
    await ghWriteDataJson(cfg, sha, data, 'Xóa testpoint: ' + (removed[0] ? removed[0].title : ''));
    statusEl.textContent = '✅ Đã xóa!';
    statusEl.style.color = '#7ee787';
    ghRenderEntries();
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  } catch(e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.style.color = '#f85149';
  }
}

function ghShowMsg(text, color) {
  const msg = document.getElementById('ghMsg');
  msg.textContent = text;
  msg.style.color = color || 'inherit';
}

// Nạp config đã lưu khi mở trang
function ghLoadCfgForm() {
  const cfg = ghGetCfg();
  if (cfg.owner) document.getElementById('ghOwner').value = cfg.owner;
  if (cfg.repo) document.getElementById('ghRepo').value = cfg.repo;
  if (cfg.token) document.getElementById('ghToken').value = cfg.token;
  if (cfg.branch) document.getElementById('ghBranch').value = cfg.branch;
}
function ghSaveCfgForm() {
  ghSaveCfg({
    owner: document.getElementById('ghOwner').value.trim(),
    repo: document.getElementById('ghRepo').value.trim(),
    token: document.getElementById('ghToken').value.trim(),
    branch: document.getElementById('ghBranch').value.trim() || 'main'
  });
  ghShowMsg('✅ Đã lưu cấu hình vào trình duyệt (localStorage)', '#7ee787');
}
