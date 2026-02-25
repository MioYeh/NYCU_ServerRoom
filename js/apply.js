/**
 * 設備申請頁面邏輯
 */

let applications = [];

document.addEventListener('DOMContentLoaded', async () => {
    await populateUnitDropdown();
    await loadApplications();
    renderMyApplications();
    // 設定預設日期為今天
    document.getElementById('applyStartDate').valueAsDate = new Date();
    // 預設結束日期為一年後
    const defaultEnd = new Date();
    defaultEnd.setFullYear(defaultEnd.getFullYear() + 1);
    document.getElementById('applyEndDate').valueAsDate = defaultEnd;
    // 自動帶入登入使用者名稱
    prefillUserInfo();
    // 監聽日期和 U 數變化以更新預估費用
    document.getElementById('applyStartDate').addEventListener('change', updateFeeEstimate);
    document.getElementById('applyEndDate').addEventListener('change', updateFeeEstimate);
    document.getElementById('applyUSize').addEventListener('change', updateFeeEstimate);
    updateFeeEstimate();
});

// ===== 動態載入所屬單位下拉選單 =====
async function populateUnitDropdown() {
    const select = document.getElementById('applicantUnit');
    if (!select) return;

    // 填入選項的輔助函式（保留第一個預設選項）
    function fillOptions(names) {
        while (select.options.length > 1) select.remove(1);
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
    }

    // 先用 OWNER_COLORS 立即填入，確保下拉選單一定有內容
    fillOptions(Object.keys(OWNER_COLORS));

    // 再嘗試從 Firestore 載入自訂單位列表（覆蓋預設）
    try {
        if (typeof DB !== 'undefined') {
            const units = await DB.getOwnerUnits();
            if (units && units.length > 0) {
                fillOptions(units.map(u => u.name));
            }
        }
    } catch (e) {
        console.warn('載入 Firestore 單位列表失敗，使用預設值', e);
    }
}

// ===== 自動帶入使用者資料 =====
function prefillUserInfo() {
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        const user = Auth.getCurrentUser();
        if (user) {
            const nameInput = document.getElementById('applicantName');
            if (nameInput && !nameInput.value) {
                nameInput.value = user.displayName;
                nameInput.readOnly = true;
                nameInput.style.background = '#f1f5f9';
            }
        }
    }
}

// ===== 即時費用預估 =====
function updateFeeEstimate() {
    const startDate = document.getElementById('applyStartDate').value;
    const endDate = document.getElementById('applyEndDate').value;
    const uSize = parseInt(document.getElementById('applyUSize').value);
    const box = document.getElementById('feeEstimateBox');

    // 動態設定 endDate 最小值
    if (startDate) {
        document.getElementById('applyEndDate').min = startDate;
    }

    if (!startDate || !endDate || !uSize) {
        box.style.display = 'none';
        return;
    }

    // 確保 endDate 在 startDate 之後
    if (new Date(endDate) < new Date(startDate)) {
        box.style.display = 'none';
        return;
    }

    const result = calculateProRatedFee(startDate, endDate, uSize);
    document.getElementById('feeEstimateAmount').textContent = `NT$ ${result.fee.toLocaleString()}`;
    document.getElementById('feeEstimateDetail').textContent = 
        `${uSize}U × $${PRICE_PER_U_PER_MONTH}/U/月 × ${result.months.toFixed(2)} 個月\n明細: ${result.breakdown}`;
    box.style.display = 'block';
}

// ===== 資料管理 (Firestore) =====
async function loadApplications() {
    applications = await DB.getApplications();
}

async function saveApplications() {
    await DB.saveApplications(applications);
}

function getNextAppId() {
    return applications.length > 0 
        ? Math.max(...applications.map(a => a.id)) + 1 
        : 1001;
}

// ===== 送出申請 =====
async function handleApplySubmit(e) {
    e.preventDefault();

    // 取得目前登入使用者
    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;

    const app = {
        id: getNextAppId(),
        submittedBy: currentUser ? currentUser.uid : '',
        applicantName: document.getElementById('applicantName').value.trim(),
        applicantUnit: document.getElementById('applicantUnit').value.trim(),
        applicantEmail: document.getElementById('applicantEmail').value.trim(),
        applicantPhone: document.getElementById('applicantPhone').value.trim(),
        deviceName: document.getElementById('applyDeviceName').value.trim(),
        deviceModel: document.getElementById('applyDeviceModel').value.trim(),
        uSize: parseInt(document.getElementById('applyUSize').value),
        power: document.getElementById('applyPower').value ? parseInt(document.getElementById('applyPower').value) : null,
        preferCabinet: document.getElementById('applyPreferCabinet').value,
        ipNeed: document.getElementById('applyIP').value,
        existingIP: document.getElementById('applyExistingIP').value.trim(),
        startDate: document.getElementById('applyStartDate').value,
        endDate: document.getElementById('applyEndDate').value,
        purpose: document.getElementById('applyPurpose').value.trim(),
        notes: document.getElementById('applyNotes').value.trim(),
        // 系統欄位
        status: 'pending',       // pending, approved, rejected, installed
        submitDate: new Date().toISOString(),
        reviewDate: null,
        adminNotes: '',
        assignedCabinet: null,
        assignedStartU: null,
        assignedIP: '',
        fee: 0,
        paymentStatus: 'unpaid', // unpaid, paid, overdue
        paymentDate: null,
        paymentMethod: '',
        paymentRef: ''
    };

    applications.push(app);
    await saveApplications();

    // 顯示成功訊息
    showSuccessMessage();
    document.getElementById('applyForm').reset();
    document.getElementById('applyStartDate').valueAsDate = new Date();
    const defaultEnd = new Date();
    defaultEnd.setFullYear(defaultEnd.getFullYear() + 1);
    document.getElementById('applyEndDate').valueAsDate = defaultEnd;
    prefillUserInfo();
    updateFeeEstimate();
    renderMyApplications();
}

function showSuccessMessage() {
    const list = document.getElementById('myApplicationList');
    const msg = document.createElement('div');
    msg.className = 'success-msg';
    msg.innerHTML = '<i class="fas fa-check-circle"></i> 申請單已送出！等待管理員審核。';
    list.prepend(msg);
    setTimeout(() => msg.remove(), 4000);
}

// ===== 渲染我的申請紀錄 =====
function renderMyApplications() {
    const list = document.getElementById('myApplicationList');
    const search = document.getElementById('mySearchInput').value.toLowerCase();

    // 保留成功訊息
    const successMsgs = list.querySelectorAll('.success-msg');

    // 只顯示自己的申請（依 submittedBy 或 applicantName 比對）
    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
    let filtered = [...applications].reverse(); // 最新的在最上面
    if (currentUser) {
        filtered = filtered.filter(a => 
            a.submittedBy === currentUser.uid || 
            a.submittedBy === currentUser.username ||
            (!a.submittedBy && a.applicantName === currentUser.displayName)
        );
    }
    if (search) {
        filtered = filtered.filter(a =>
            a.deviceName.toLowerCase().includes(search) ||
            a.applicantName.toLowerCase().includes(search) ||
            a.applicantUnit.toLowerCase().includes(search) ||
            String(a.id).includes(search)
        );
    }

    list.innerHTML = '';
    // 放回成功訊息
    successMsgs.forEach(m => list.appendChild(m));

    if (filtered.length === 0) {
        list.innerHTML += `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>${search ? '找不到符合的申請紀錄' : '尚無申請紀錄'}</p>
            </div>`;
        return;
    }

    filtered.forEach(app => {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.onclick = () => showApplyDetail(app);

        const statusInfo = getStatusInfo(app.status);
        const cabinetLabel = app.assignedCabinet !== null 
            ? `機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}` 
            : (app.preferCabinet !== '' ? `希望: 機櫃 ${CABINET_NAMES[app.preferCabinet]}` : '未指定');

        card.innerHTML = `
            <div class="app-card-header">
                <div>
                    <div class="app-card-title">${app.deviceName}</div>
                    <div class="app-card-id">#${app.id}</div>
                </div>
                <span class="status-badge status-${app.status}">${statusInfo.icon} ${statusInfo.label}</span>
            </div>
            <div class="app-card-body">
                <div class="info-row"><span class="info-label">申請人</span><span>${app.applicantName} / ${app.applicantUnit}</span></div>
                <div class="info-row"><span class="info-label">大小</span><span>${app.uSize}U</span></div>
                <div class="info-row"><span class="info-label">位置</span><span>${cabinetLabel}</span></div>
            </div>
            <div class="app-card-footer">
                <span class="app-card-date"><i class="fas fa-calendar"></i> ${formatDate(app.submitDate)}</span>
                ${app.fee > 0 ? `<span class="status-badge status-${app.paymentStatus}">${app.paymentStatus === 'paid' ? '✓ 已繳費' : '$ 待繳費 NT$' + app.fee.toLocaleString()}</span>` : ''}
            </div>
        `;
        list.appendChild(card);
    });
}

// ===== 申請詳情彈窗 =====
function showApplyDetail(app) {
    const content = document.getElementById('applyDetailContent');
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
            <div class="detail-row"><span class="detail-label">用途</span><span class="detail-value">${app.purpose}</span></div>
            <div class="detail-row"><span class="detail-label">備註</span><span class="detail-value">${app.notes || '-'}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-calendar"></i> 時間 & 位置</div>
            <div class="detail-row"><span class="detail-label">申請日期</span><span class="detail-value">${formatDate(app.submitDate)}</span></div>
            <div class="detail-row"><span class="detail-label">上架日期</span><span class="detail-value">${app.startDate}</span></div>
            <div class="detail-row"><span class="detail-label">使用到期日</span><span class="detail-value">${app.endDate || (app.duration === 0 ? '長期' : app.duration + ' 個月')}</span></div>
            <div class="detail-row"><span class="detail-label">指派位置</span><span class="detail-value">${app.assignedCabinet !== null ? '機櫃 ' + CABINET_NAMES[app.assignedCabinet] + ' U' + app.assignedStartU + '-U' + (app.assignedStartU + app.uSize - 1) : '尚未指派'}</span></div>
            <div class="detail-row"><span class="detail-label">分配 IP</span><span class="detail-value">${app.assignedIP || '-'}</span></div>
        </div>
        ${app.fee > 0 ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-credit-card"></i> 繳費資訊</div>
            <div class="detail-row"><span class="detail-label">費用</span><span class="detail-value">NT$ ${app.fee.toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">繳費狀態</span><span class="detail-value"><span class="status-badge status-${app.paymentStatus}">${app.paymentStatus === 'paid' ? '已繳費' : '待繳費'}</span></span></div>
            ${app.paymentDate ? `<div class="detail-row"><span class="detail-label">繳費日期</span><span class="detail-value">${formatDate(app.paymentDate)}</span></div>` : ''}
        </div>` : ''}
        ${app.adminNotes ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-comment"></i> 管理員備註</div>
            <p style="color:#475569;font-size:0.9rem;">${app.adminNotes}</p>
        </div>` : ''}
    `;

    document.getElementById('applyDetailModal').classList.add('active');
}

function closeApplyDetail(e) {
    if (e.target === document.getElementById('applyDetailModal')) closeApplyDetailDirect();
}

function closeApplyDetailDirect() {
    document.getElementById('applyDetailModal').classList.remove('active');
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
