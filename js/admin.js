/**
 * 管理員審核頁面邏輯
 */

let applications = [];
let devices = [];
let adminFilter = 'all';
let currentReviewId = null;

document.addEventListener('DOMContentLoaded', async () => {
    initAdminPage();      // 先依角色調整 UI，避免閃爍
    await loadData();
    renderAdminList();
});

// ===== 頁面初始化：依角色調整 UI =====
function initAdminPage() {
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    // 標題和導覽列已由 inline script + CSS 處理，不需再手動切換
    // 非管理員隱藏統計徽章中的審核操作提示
    if (!isAdmin) {
        const statsDiv = document.querySelector('.header-right .admin-stats');
        if (statsDiv) statsDiv.style.display = 'none';

        // 隱藏搜尋框（一般使用者只看自己的申請）
        const searchInput = document.getElementById('adminSearch');
        if (searchInput) searchInput.style.display = 'none';

        // 隱藏管理員專用的篩選 tab（待審核數量對一般使用者無意義）
        // 但保留 全部 / 已通過 / 已拒絕 / 已上架 供一般使用者查看自己的進度
        const pendingTab = document.querySelector('.tab-btn[data-filter="pending"]');
        if (pendingTab) pendingTab.style.display = 'none';
    }
}

function isCurrentUserAdmin() {
    return typeof Auth !== 'undefined' && Auth.isAdmin();
}

// ===== 資料管理 (Firestore) =====
async function loadData() {
    applications = await DB.getApplications();
    devices = await DB.getDevices() || [];
}

async function saveApplications() {
    await DB.saveApplications(applications);
}

async function saveDevices() {
    await DB.saveDevices(devices);
}

function getNextDeviceId() {
    return devices.length > 0 ? Math.max(...devices.map(d => d.id)) + 1 : 1;
}

// ===== 篩選 =====
function setAdminFilter(filter, btn) {
    adminFilter = filter;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAdminList();
}

// ===== 渲染列表 =====
async function renderAdminList() {
    await loadData(); // 重新載入確保最新
    const search = document.getElementById('adminSearch').value.toLowerCase();
    const userIsAdmin = isCurrentUserAdmin();

    let filtered = [...applications].reverse();

    // 一般使用者只能看到自己的申請
    if (!userIsAdmin) {
        const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
        if (currentUser) {
            filtered = filtered.filter(a =>
                a.submittedBy === currentUser.uid ||
                a.submittedBy === currentUser.username ||
                (!a.submittedBy && a.applicantName === currentUser.displayName)
            );
        }
    }

    // 狀態篩選
    if (adminFilter !== 'all') {
        filtered = filtered.filter(a => a.status === adminFilter);
    }

    // 搜尋
    if (search) {
        filtered = filtered.filter(a =>
            a.applicantName.toLowerCase().includes(search) ||
            a.applicantUnit.toLowerCase().includes(search) ||
            a.deviceName.toLowerCase().includes(search) ||
            String(a.id).includes(search)
        );
    }

    // 更新計數
    updateCounts();

    const list = document.getElementById('adminList');
    list.innerHTML = '';

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>${search ? '找不到符合的紀錄' : '此分類下尚無申請紀錄'}</p>
            </div>`;
        return;
    }

    filtered.forEach(app => {
        const card = document.createElement('div');
        card.className = 'admin-card';

        const statusInfo = getStatusInfo(app.status);
        const cabinetLabel = app.assignedCabinet !== null
            ? `機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
            : (app.preferCabinet !== '' ? `希望: 機櫃 ${CABINET_NAMES[app.preferCabinet]}` : '未指定');

        const userIsAdmin = isCurrentUserAdmin();
        let actionsHTML = '';
        if (userIsAdmin && app.status === 'pending') {
            actionsHTML = `
                <button class="btn btn-success btn-xs" onclick="openAssignModal(${app.id})">
                    <i class="fas fa-check"></i> 核准
                </button>
                <button class="btn btn-danger btn-xs" onclick="rejectApplication(${app.id})">
                    <i class="fas fa-times"></i> 拒絕
                </button>
            `;
        } else if (userIsAdmin && app.status === 'approved') {
            actionsHTML = `
                <button class="btn btn-primary btn-xs" onclick="installDevice(${app.id})">
                    <i class="fas fa-server"></i> 確認上架
                </button>
            `;
        }

        actionsHTML += `
            <button class="btn btn-secondary btn-xs" onclick="openReviewModal(${app.id})">
                <i class="fas fa-eye"></i> 詳情
            </button>
        `;

        card.innerHTML = `
            <div class="admin-card-main">
                <div class="admin-card-status">
                    <span class="status-badge status-${app.status}">${statusInfo.icon} ${statusInfo.label}</span>
                    <div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">#${app.id}</div>
                </div>
                <div class="admin-card-info">
                    <div class="info-group">
                        <label>申請人</label>
                        <span>${app.applicantName}</span>
                    </div>
                    <div class="info-group">
                        <label>單位</label>
                        <span>${app.applicantUnit}</span>
                    </div>
                    <div class="info-group">
                        <label>設備</label>
                        <span>${app.deviceName} (${app.uSize}U)</span>
                    </div>
                    <div class="info-group">
                        <label>位置</label>
                        <span>${cabinetLabel}</span>
                    </div>
                    <div class="info-group">
                        <label>申請日期</label>
                        <span>${formatDate(app.submitDate)}</span>
                    </div>
                    <div class="info-group">
                        <label>上架日期</label>
                        <span>${app.startDate}</span>
                    </div>
                </div>
                <div class="admin-card-actions">
                    ${actionsHTML}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function updateCounts() {
    // 一般使用者只統計自己的申請
    let pool = applications;
    if (!isCurrentUserAdmin()) {
        const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
        if (currentUser) {
            pool = applications.filter(a =>
                a.submittedBy === currentUser.uid ||
                a.submittedBy === currentUser.username ||
                (!a.submittedBy && a.applicantName === currentUser.displayName)
            );
        }
    }

    const all = pool.length;
    const pending = pool.filter(a => a.status === 'pending').length;
    const approved = pool.filter(a => a.status === 'approved').length;
    const rejected = pool.filter(a => a.status === 'rejected').length;
    const installed = pool.filter(a => a.status === 'installed').length;

    document.getElementById('tabAll').textContent = all;
    document.getElementById('tabPending').textContent = pending;
    document.getElementById('tabApproved').textContent = approved;
    document.getElementById('tabRejected').textContent = rejected;
    document.getElementById('tabInstalled').textContent = installed;

    document.getElementById('pendingCount').textContent = `${pending} 待審核`;
    document.getElementById('approvedCount').textContent = `${approved} 已通過`;
    document.getElementById('rejectedCount').textContent = `${rejected} 已拒絕`;
}

// ===== 審核詳情彈窗 =====
function openReviewModal(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;
    currentReviewId = appId;

    const content = document.getElementById('reviewContent');
    const statusInfo = getStatusInfo(app.status);

    content.innerHTML = `
        <div style="text-align:center;margin-bottom:16px;">
            <span class="status-badge status-${app.status}" style="font-size:0.9rem;padding:6px 16px;">
                ${statusInfo.icon} ${statusInfo.label}
            </span>
            <div style="color:#94a3b8;font-size:0.8rem;margin-top:6px;">申請編號 #${app.id}</div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-user"></i> 申請人資訊</div>
            <div class="detail-row"><span class="detail-label">姓名</span><span class="detail-value">${app.applicantName}</span></div>
            <div class="detail-row"><span class="detail-label">單位</span><span class="detail-value">${app.applicantUnit}</span></div>
            <div class="detail-row"><span class="detail-label">信箱</span><span class="detail-value">${app.applicantEmail}</span></div>
            <div class="detail-row"><span class="detail-label">電話</span><span class="detail-value">${app.applicantPhone || '-'}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-server"></i> 設備資訊</div>
            <div class="detail-row"><span class="detail-label">設備名稱</span><span class="detail-value">${app.deviceName}</span></div>
            <div class="detail-row"><span class="detail-label">型號</span><span class="detail-value">${app.deviceModel || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">大小</span><span class="detail-value">${app.uSize}U</span></div>
            <div class="detail-row"><span class="detail-label">預估用電</span><span class="detail-value">${app.power ? app.power + 'W' : '-'}</span></div>
            <div class="detail-row"><span class="detail-label">IP 需求</span><span class="detail-value">${app.ipNeed === 'need' ? '需分配' : app.ipNeed === 'have' ? '已有: ' + app.existingIP : '不需要'}</span></div>
            <div class="detail-row"><span class="detail-label">用途</span><span class="detail-value">${app.purpose}</span></div>
            <div class="detail-row"><span class="detail-label">備註</span><span class="detail-value">${app.notes || '-'}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-calendar"></i> 時程</div>
            <div class="detail-row"><span class="detail-label">申請日期</span><span class="detail-value">${formatDate(app.submitDate)}</span></div>
            <div class="detail-row"><span class="detail-label">上架日期</span><span class="detail-value">${app.startDate}</span></div>
            <div class="detail-row"><span class="detail-label">使用到期日</span><span class="detail-value">${app.endDate || (app.duration === 0 ? '長期' : app.duration + ' 個月')}</span></div>
            <div class="detail-row"><span class="detail-label">希望位置</span><span class="detail-value">${app.preferCabinet !== '' ? '機櫃 ' + CABINET_NAMES[app.preferCabinet] : '不指定'}</span></div>
        </div>
        ${app.assignedCabinet !== null ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-map-marker-alt"></i> 指派結果</div>
            <div class="detail-row"><span class="detail-label">機櫃位置</span><span class="detail-value">機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}</span></div>
            <div class="detail-row"><span class="detail-label">分配 IP</span><span class="detail-value">${app.assignedIP || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">費用</span><span class="detail-value">NT$ ${app.fee.toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">審核日期</span><span class="detail-value">${formatDate(app.reviewDate)}</span></div>
            <div class="detail-row"><span class="detail-label">管理員備註</span><span class="detail-value">${app.adminNotes || '-'}</span></div>
        </div>` : ''}
    `;

    // 底部按鈕（審核操作僅管理員可見）
    const actions = document.getElementById('reviewActions');
    let btns = '';
    if (isCurrentUserAdmin()) {
        if (app.status === 'pending') {
            btns = `
                <button class="btn btn-success" onclick="closeReviewModalDirect();openAssignModal(${app.id})">
                    <i class="fas fa-check"></i> 核准
                </button>
                <button class="btn btn-danger" onclick="closeReviewModalDirect();rejectApplication(${app.id})">
                    <i class="fas fa-times"></i> 拒絕
                </button>
            `;
        } else if (app.status === 'approved') {
            btns = `
                <button class="btn btn-primary" onclick="closeReviewModalDirect();installDevice(${app.id})">
                    <i class="fas fa-server"></i> 確認上架
                </button>
            `;
        }
    }
    btns += `<button class="btn btn-secondary" onclick="closeReviewModalDirect()">關閉</button>`;
    actions.innerHTML = btns;

    document.getElementById('reviewModal').classList.add('active');
}

function closeReviewModal(e) {
    if (e.target === document.getElementById('reviewModal')) closeReviewModalDirect();
}
function closeReviewModalDirect() {
    document.getElementById('reviewModal').classList.remove('active');
}

// ===== 核准：開啟指派位置彈窗 =====
function openAssignModal(appId) {
    if (!isCurrentUserAdmin()) { alert('僅管理員可執行此操作'); return; }
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    document.getElementById('assignAppId').value = appId;
    document.getElementById('assignCabinet').value = app.preferCabinet || '';
    document.getElementById('assignStartU').value = '';
    document.getElementById('assignIP').value = app.existingIP || '';
    document.getElementById('assignAdminNotes').value = '';

    // 自動計算費用: 使用比例計算
    const endDate = app.endDate || (() => {
        // 相容舊資料: 從 duration 推算 endDate
        const months = app.duration === 0 ? 12 : app.duration;
        const d = new Date(app.startDate);
        d.setMonth(d.getMonth() + months);
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    })();
    const feeResult = calculateProRatedFee(app.startDate, endDate, app.uSize);
    document.getElementById('assignFee').value = feeResult.fee;
    document.getElementById('feeCalcHint').textContent = 
        `${app.uSize}U × $${PRICE_PER_U_PER_MONTH}/U/月 × ${feeResult.months.toFixed(2)} 個月 = NT$ ${feeResult.fee.toLocaleString()}\n明細: ${feeResult.breakdown}`;

    updateAssignHint();
    document.getElementById('assignModal').classList.add('active');
}

function closeAssignModal(e) {
    if (e.target === document.getElementById('assignModal')) closeAssignModalDirect();
}
function closeAssignModalDirect() {
    document.getElementById('assignModal').classList.remove('active');
}

function updateAssignHint() {
    const cabinetIdx = parseInt(document.getElementById('assignCabinet').value);
    const hint = document.getElementById('assignHint');
    if (isNaN(cabinetIdx)) {
        hint.textContent = '';
        return;
    }

    // devices 已在 loadData 中載入
    const cabinetDevices = devices.filter(d => d.cabinet === cabinetIdx);
    const occupied = new Set();
    cabinetDevices.forEach(d => {
        for (let u = d.startU; u < d.startU + d.uSize; u++) occupied.add(u);
    });

    const free = [];
    for (let u = 1; u <= TOTAL_U; u++) {
        if (!occupied.has(u)) free.push(u);
    }

    if (free.length === 0) {
        hint.textContent = '⚠️ 此機櫃已滿';
        hint.style.color = '#dc2626';
    } else {
        const ranges = [];
        let start = free[0], end = free[0];
        for (let i = 1; i < free.length; i++) {
            if (free[i] === end + 1) { end = free[i]; }
            else { ranges.push(start === end ? `U${start}` : `U${start}-U${end}`); start = end = free[i]; }
        }
        ranges.push(start === end ? `U${start}` : `U${start}-U${end}`);
        hint.textContent = `可用: ${ranges.join(', ')} (${free.length}U 空閒)`;
        hint.style.color = '#16a34a';
    }
}

async function handleAssignSubmit(e) {
    e.preventDefault();

    const appId = parseInt(document.getElementById('assignAppId').value);
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const cabinet = parseInt(document.getElementById('assignCabinet').value);
    const startU = parseInt(document.getElementById('assignStartU').value);
    const ip = document.getElementById('assignIP').value.trim();
    const fee = parseInt(document.getElementById('assignFee').value) || 0;
    const notes = document.getElementById('assignAdminNotes').value.trim();

    // 驗證
    if (startU < 1 || startU > TOTAL_U) {
        alert(`起始 U 位置必須在 1 ~ ${TOTAL_U} 之間`);
        return;
    }
    if (startU + app.uSize - 1 > TOTAL_U) {
        alert(`設備超出機櫃範圍`);
        return;
    }

    // 衝突偵測 (重新載入 devices)
    devices = await DB.getDevices() || [];
    const conflict = devices.find(d => {
        if (d.cabinet !== cabinet) return false;
        const dEnd = d.startU + d.uSize - 1;
        const newEnd = startU + app.uSize - 1;
        return !(newEnd < d.startU || startU > dEnd);
    });
    if (conflict) {
        alert(`位置衝突！與 "${conflict.name}" (U${conflict.startU}-U${conflict.startU + conflict.uSize - 1}) 重疊。`);
        return;
    }

    // 更新申請
    app.status = 'approved';
    app.reviewDate = new Date().toISOString();
    app.assignedCabinet = cabinet;
    app.assignedStartU = startU;
    app.assignedIP = ip;
    app.fee = fee;
    app.adminNotes = notes;
    if (fee > 0) {
        app.paymentStatus = 'unpaid';
    }

    await saveApplications();
    closeAssignModalDirect();
    renderAdminList();
    alert(`✅ 申請 #${appId} 已核准！\n位置：機櫃 ${CABINET_NAMES[cabinet]} U${startU}-U${startU + app.uSize - 1}`);
}

// ===== 拒絕 =====
async function rejectApplication(appId) {
    if (!isCurrentUserAdmin()) { alert('僅管理員可執行此操作'); return; }
    await loadData(); // 確保最新資料
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const reason = prompt(`拒絕申請 #${appId}「${app.deviceName}」\n請輸入拒絕原因：`);
    if (reason === null) return; // 取消

    app.status = 'rejected';
    app.reviewDate = new Date().toISOString();
    app.adminNotes = reason || '未說明原因';

    await saveApplications();
    renderAdminList();
    alert(`❌ 申請 #${appId} 已拒絕`);
}

// ===== 確認上架 =====
async function installDevice(appId) {
    if (!isCurrentUserAdmin()) { alert('僅管理員可執行此操作'); return; }
    await loadData(); // 確保最新資料
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    if (app.assignedCabinet === null) {
        alert('此申請尚未指派位置，請先核准並指派位置');
        return;
    }

    // 若有費用且尚未繳費
    if (app.fee > 0 && app.paymentStatus !== 'paid') {
        if (!confirm(`此申請尚有 NT$ ${app.fee.toLocaleString()} 未繳費，確定要先上架嗎？`)) {
            return;
        }
    }

    if (!confirm(`確認上架設備「${app.deviceName}」到機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}？\n\n此操作會將設備加入機櫃總覽。`)) {
        return;
    }

    // 只重新載入 devices
    devices = await DB.getDevices() || [];

    // 再次檢查衝突
    const conflict = devices.find(d => {
        if (d.cabinet !== app.assignedCabinet) return false;
        const dEnd = d.startU + d.uSize - 1;
        const newEnd = app.assignedStartU + app.uSize - 1;
        return !(newEnd < d.startU || app.assignedStartU > dEnd);
    });
    if (conflict) {
        alert(`位置衝突！機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${conflict.startU}-U${conflict.startU + conflict.uSize - 1} 已被「${conflict.name}」佔用。`);
        return;
    }

    // 新增設備到 devices
    const newDevice = {
        id: getNextDeviceId(),
        name: app.deviceName,
        cabinet: app.assignedCabinet,
        startU: app.assignedStartU,
        uSize: app.uSize,
        owner: app.applicantUnit,
        contact: app.applicantName,
        email: app.applicantEmail,
        ip: app.assignedIP,
        description: `${app.purpose}${app.deviceModel ? ' | 型號: ' + app.deviceModel : ''} | 申請 #${app.id}`
    };

    devices.push(newDevice);
    await saveDevices();

    app.status = 'installed';
    await saveApplications();

    renderAdminList();
    alert(`✅ 設備「${app.deviceName}」已成功上架！\n可至「機櫃總覽」查看。`);
}

// ===== 工具函式 =====
function getStatusInfo(status) {
    const map = {
        pending:   { label: '待審核', icon: '<i class="fas fa-clock"></i>' },
        approved:  { label: '已通過', icon: '<i class="fas fa-check-circle"></i>' },
        rejected:  { label: '已拒絕', icon: '<i class="fas fa-times-circle"></i>' },
        installed: { label: '已上架', icon: '<i class="fas fa-server"></i>' }
    };
    return map[status] || { label: status, icon: '' };
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ===== 使用者管理 =====
function initUserManagement() {
    if (typeof Auth !== 'undefined' && Auth.isAdmin()) {
        const section = document.getElementById('userMgmtSection');
        if (section) {
            section.style.display = 'block';
            renderUserTable();
        }
    }
}

async function renderUserTable() {
    const users = await Auth.getUsers();
    const tbody = document.getElementById('userTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    users.forEach(u => {
        const roleClass = u.role === 'admin' ? 'role-admin' : 'role-user';
        const roleLabel = u.role === 'admin' ? '管理員' : '使用者';
        const currentUser = Auth.getCurrentUser();
        const isSelf = currentUser && currentUser.uid === u.uid;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${u.displayName}</strong><br><small style="color:#94a3b8">${u.email || ''}</small></td>
            <td><span class="role-badge ${roleClass}">${roleLabel}</span></td>
            <td class="actions-cell">
                <button class="btn btn-primary btn-xs" onclick="editUser('${u.uid}')">
                    <i class="fas fa-edit"></i> 編輯
                </button>
                ${isSelf ? '' : `
                <button class="btn btn-danger btn-xs" onclick="deleteUserConfirm('${u.uid}', '${u.displayName}')">
                    <i class="fas fa-trash"></i> 刪除
                </button>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openUserModal(editUid) {
    const modal = document.getElementById('userModal');
    const title = document.getElementById('userModalTitle');
    const form = document.getElementById('userForm');
    const originalInput = document.getElementById('userEditOriginal');
    const emailInput = document.getElementById('userFormUsername');
    const passwordInput = document.getElementById('userFormPassword');
    form.reset();

    if (editUid) {
        // 編輯模式
        (async () => {
            const users = await Auth.getUsers();
            const user = users.find(u => u.uid === editUid);
            if (!user) return;
            title.innerHTML = '<i class="fas fa-user-edit"></i> 編輯使用者';
            originalInput.value = editUid;
            emailInput.value = user.email || '';
            emailInput.readOnly = true; // 編輯時不能改 email
            document.getElementById('userFormDisplayName').value = user.displayName;
            passwordInput.value = '';
            passwordInput.placeholder = '（無法從前端修改密碼）';
            passwordInput.disabled = true;
            passwordInput.required = false;
            document.getElementById('userFormRole').value = user.role;
            modal.classList.add('active');
        })();
        return;
    } else {
        title.innerHTML = '<i class="fas fa-user-plus"></i> 新增使用者';
        originalInput.value = '';
        emailInput.readOnly = false;
        emailInput.placeholder = '輸入電子郵件';
        passwordInput.disabled = false;
        passwordInput.required = true;
        passwordInput.placeholder = '輸入密碼（至少 6 字元）';
    }

    modal.classList.add('active');
}

function closeUserModal(e) {
    if (e.target === e.currentTarget) closeUserModalDirect();
}

function closeUserModalDirect() {
    document.getElementById('userModal').classList.remove('active');
}

function editUser(uid) {
    openUserModal(uid);
}

async function deleteUserConfirm(uid, displayLabel) {
    if (!confirm(`確定要刪除使用者「${displayLabel}」嗎？`)) return;
    const result = await Auth.deleteUser(uid);
    if (result.success) {
        if (result.message) alert(result.message);
        renderUserTable();
    } else {
        alert(result.message);
    }
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    const original = document.getElementById('userEditOriginal').value;
    const email = document.getElementById('userFormUsername').value.trim();
    const displayName = document.getElementById('userFormDisplayName').value.trim();
    const password = document.getElementById('userFormPassword').value;
    const role = document.getElementById('userFormRole').value;

    if (!displayName) {
        alert('請填寫顯示名稱');
        return;
    }

    let result;
    if (original) {
        // 編輯模式：只更新 Firestore profile
        result = await Auth.updateUser(original, role, displayName);
    } else {
        // 新增模式：建立 Firebase Auth 帳號 + Firestore profile
        if (!email || !password) {
            alert('請填寫電子郵件和密碼');
            return;
        }
        result = await Auth.addUser(email, password, role, displayName);
    }

    if (result.success) {
        closeUserModalDirect();
        renderUserTable();
    } else {
        alert(result.message);
    }
}

// 頁面載入時初始化使用者管理
document.addEventListener('DOMContentLoaded', () => {
    // 短暫延遲以確保 auth.js 已載入
    setTimeout(initUserManagement, 100);
});
