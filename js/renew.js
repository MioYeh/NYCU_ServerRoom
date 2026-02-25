/**
 * 繳費申請（續約延期）頁面邏輯
 * 
 * 使用者選擇已上架/已通過的設備，申請延長到期日。
 * 繳費申請送出後，管理員在「管理審核」頁面進行審核。
 * 審核通過後，原設備申請的到期日會被更新，並產生新的繳費項目。
 */

let applications = [];

document.addEventListener('DOMContentLoaded', async () => {
    await loadApplications();
    populateDeviceDropdown();
    renderMyRenewals();
});

// ===== 資料管理 =====
async function loadApplications() {
    applications = await DB.getApplications();
    // 自動修復被舊程式碼錯誤更新的資料
    if (repairCorruptedApplications(applications)) {
        await saveApplications();
    }
}

async function saveApplications() {
    await DB.saveApplications(applications);
}

function getNextAppId() {
    return applications.length > 0 
        ? Math.max(...applications.map(a => a.id)) + 1 
        : 1001;
}

// ===== 填入設備下拉選單（只顯示自己的已通過/已上架設備）=====
function populateDeviceDropdown() {
    const select = document.getElementById('renewDevice');
    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
    if (!currentUser) return;

    // 取得使用者自己的已通過/已上架設備申請（type != 'renewal'）
    const myDevices = applications.filter(a => {
        const isMine = a.submittedBy === currentUser.uid || 
                       a.submittedBy === currentUser.username ||
                       (!a.submittedBy && a.applicantName === currentUser.displayName);
        const isActive = a.status === 'approved' || a.status === 'installed';
        const isDevice = a.type !== 'renewal'; // 排除續約申請本身
        return isMine && isActive && isDevice;
    });

    // 清除現有選項（保留第一個預設選項）
    while (select.options.length > 1) select.remove(1);

    if (myDevices.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '（目前沒有可續約的設備）';
        opt.disabled = true;
        select.appendChild(opt);
        return;
    }

    myDevices.forEach(app => {
        const opt = document.createElement('option');
        opt.value = app.id;
        const cabinetLabel = app.assignedCabinet !== null 
            ? `機櫃${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}` 
            : '';
        const effectiveEnd = getEffectiveEndDate(app.id, applications);
        opt.textContent = `#${app.id} ${app.deviceName} (${app.uSize}U) ${cabinetLabel} — 到期: ${effectiveEnd}`;
        select.appendChild(opt);
    });
}

// ===== 選擇設備後顯示資訊 =====
function onDeviceSelected() {
    const appId = parseInt(document.getElementById('renewDevice').value);
    const infoPanel = document.getElementById('renewDeviceInfo');
    const submitBtn = document.getElementById('renewSubmitBtn');
    const dateInput = document.getElementById('renewNewEndDate');

    if (!appId) {
        infoPanel.style.display = 'none';
        submitBtn.disabled = true;
        dateInput.value = '';
        document.getElementById('renewFeeEstimateBox').style.display = 'none';
        return;
    }

    const app = applications.find(a => a.id === appId);
    if (!app) return;

    // 填入設備資訊
    document.getElementById('infoDeviceName').textContent = `${app.deviceName} (${app.deviceModel || '-'})`;
    document.getElementById('infoCabinet').textContent = app.assignedCabinet !== null
        ? `機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
        : '尚未指派';
    document.getElementById('infoUSize').textContent = `${app.uSize}U`;
    document.getElementById('infoApplicant').textContent = `${app.applicantName} / ${app.applicantUnit}`;
    const effectiveEnd = getEffectiveEndDate(app.id, applications);
    document.getElementById('infoStartDate').textContent = app.startDate;
    document.getElementById('infoEndDate').textContent = effectiveEnd;

    infoPanel.style.display = 'block';

    // 設定日期最小值為目前有效到期日的隔天
    const currentEnd = new Date(effectiveEnd);
    const minDate = new Date(currentEnd);
    minDate.setDate(minDate.getDate() + 1);
    dateInput.min = minDate.toISOString().split('T')[0];

    // 預設延長到一年後
    const defaultEnd = new Date(currentEnd);
    defaultEnd.setFullYear(defaultEnd.getFullYear() + 1);
    dateInput.value = defaultEnd.toISOString().split('T')[0];

    submitBtn.disabled = false;
    updateRenewFeeEstimate();
}

// ===== 繳費方式切換 =====
function onPayMethodChanged() {
    const method = document.getElementById('renewPayMethod').value;
    const projectGroup = document.getElementById('budgetProjectGroup');
    const projectInput = document.getElementById('renewBudgetProject');

    if (method === 'budget') {
        projectGroup.style.display = '';
        projectInput.required = true;
    } else {
        projectGroup.style.display = 'none';
        projectInput.required = false;
        projectInput.value = '';
    }
}

// ===== 快速延長按鈕 =====
function quickExtend(months) {
    const appId = parseInt(document.getElementById('renewDevice').value);
    if (!appId) return;

    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const effectiveEnd = getEffectiveEndDate(app.id, applications);
    const currentEnd = new Date(effectiveEnd);
    const newEnd = new Date(currentEnd);
    newEnd.setMonth(newEnd.getMonth() + months);

    document.getElementById('renewNewEndDate').value = newEnd.toISOString().split('T')[0];
    updateRenewFeeEstimate();
}

// ===== 費用預估 =====
function updateRenewFeeEstimate() {
    const appId = parseInt(document.getElementById('renewDevice').value);
    const newEndDate = document.getElementById('renewNewEndDate').value;
    const box = document.getElementById('renewFeeEstimateBox');

    if (!appId || !newEndDate) {
        box.style.display = 'none';
        return;
    }

    const app = applications.find(a => a.id === appId);
    if (!app) return;

    // 延期費用 = 從目前有效到期日隔天到新到期日的費用
    const effectiveEnd = getEffectiveEndDate(app.id, applications);
    const currentEnd = new Date(effectiveEnd);
    const extensionStart = new Date(currentEnd);
    extensionStart.setDate(extensionStart.getDate() + 1);
    const extensionStartStr = extensionStart.toISOString().split('T')[0];

    if (new Date(newEndDate) <= currentEnd) {
        box.style.display = 'none';
        document.getElementById('renewSubmitBtn').disabled = true;
        return;
    }

    document.getElementById('renewSubmitBtn').disabled = false;

    const result = calculateProRatedFee(extensionStartStr, newEndDate, app.uSize);
    document.getElementById('renewFeeEstimateAmount').textContent = `NT$ ${result.fee.toLocaleString()}`;
    document.getElementById('renewFeeEstimateDetail').textContent = 
        `延期: ${extensionStartStr} ~ ${newEndDate}\n${app.uSize}U × $${PRICE_PER_U_PER_MONTH}/U/月 × ${result.months.toFixed(2)} 個月\n明細: ${result.breakdown}`;
    box.style.display = 'block';
}

// ===== 送出繳費申請 =====
async function handleRenewSubmit(e) {
    e.preventDefault();

    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
    const appId = parseInt(document.getElementById('renewDevice').value);
    const newEndDate = document.getElementById('renewNewEndDate').value;
    const notes = document.getElementById('renewNotes').value.trim();
    const payMethod = document.getElementById('renewPayMethod').value;
    const budgetProject = document.getElementById('renewBudgetProject').value.trim();

    if (!appId || !newEndDate) {
        alert('請選擇設備並填寫新的到期日');
        return;
    }

    if (!payMethod) {
        alert('請選擇繳費方式');
        return;
    }

    if (payMethod === 'budget' && !budgetProject) {
        alert('選擇校內經費核銷時，請填寫計畫編號');
        return;
    }

    const originalApp = applications.find(a => a.id === appId);
    if (!originalApp) {
        alert('找不到原始設備申請');
        return;
    }

    // 計算延期費用（基於有效到期日，而非原始申請的 endDate）
    const effectiveEnd = getEffectiveEndDate(originalApp.id, applications);
    const currentEnd = new Date(effectiveEnd);
    const extensionStart = new Date(currentEnd);
    extensionStart.setDate(extensionStart.getDate() + 1);
    const extensionStartStr = extensionStart.toISOString().split('T')[0];
    const feeResult = calculateProRatedFee(extensionStartStr, newEndDate, originalApp.uSize);

    // 建立繳費申請（類型為 renewal）
    const renewalApp = {
        id: getNextAppId(),
        type: 'renewal',                    // 標記為繳費申請
        originalAppId: originalApp.id,       // 關聯原始設備申請
        submittedBy: currentUser ? currentUser.uid : '',
        applicantName: originalApp.applicantName,
        applicantUnit: originalApp.applicantUnit,
        applicantEmail: originalApp.applicantEmail,
        applicantPhone: originalApp.applicantPhone || '',
        deviceName: originalApp.deviceName,
        deviceModel: originalApp.deviceModel || '',
        uSize: originalApp.uSize,
        power: originalApp.power || null,
        preferCabinet: originalApp.assignedCabinet !== null ? String(originalApp.assignedCabinet) : '',
        ipNeed: 'no',
        existingIP: originalApp.assignedIP || '',
        // 延期期間
        startDate: extensionStartStr,        // 延期起始（原到期日隔天）
        endDate: newEndDate,                 // 新的到期日
        originalEndDate: effectiveEnd,          // 記錄延期前的有效到期日
        purpose: `設備續約延期 — 原申請 #${originalApp.id}`,
        notes: notes || `延長使用期間至 ${newEndDate}`,
        // 系統欄位
        status: 'pending',
        submitDate: new Date().toISOString(),
        reviewDate: null,
        adminNotes: '',
        assignedCabinet: originalApp.assignedCabinet,
        assignedStartU: originalApp.assignedStartU,
        assignedIP: originalApp.assignedIP || '',
        fee: feeResult.fee,
        paymentStatus: 'unpaid',
        paymentDate: null,
        paymentMethod: payMethod,
        paymentRef: payMethod === 'budget' ? `計畫編號: ${budgetProject}` : '',
        budgetProject: payMethod === 'budget' ? budgetProject : '',
        paidAmount: 0,
        paidUpTo: null
    };

    applications.push(renewalApp);
    await saveApplications();

    // 顯示成功訊息
    showRenewSuccess();
    document.getElementById('renewForm').reset();
    document.getElementById('renewDeviceInfo').style.display = 'none';
    document.getElementById('renewFeeEstimateBox').style.display = 'none';
    document.getElementById('renewSubmitBtn').disabled = true;
    document.getElementById('renewPayMethod').value = '';
    document.getElementById('renewBudgetProject').value = '';
    document.getElementById('budgetProjectGroup').style.display = 'none';

    // 重新載入並渲染
    await loadApplications();
    populateDeviceDropdown();
    renderMyRenewals();
}

function showRenewSuccess() {
    const list = document.getElementById('myRenewalList');
    const msg = document.createElement('div');
    msg.className = 'success-msg';
    msg.innerHTML = '<i class="fas fa-check-circle"></i> 繳費申請已送出！等待管理員審核。';
    list.prepend(msg);
    setTimeout(() => msg.remove(), 4000);
}

// ===== 重置表單 =====
function resetRenewForm() {
    document.getElementById('renewDeviceInfo').style.display = 'none';
    document.getElementById('renewFeeEstimateBox').style.display = 'none';
    document.getElementById('renewSubmitBtn').disabled = true;
    document.getElementById('renewPayMethod').value = '';
    document.getElementById('renewBudgetProject').value = '';
    document.getElementById('budgetProjectGroup').style.display = 'none';
}

// ===== 渲染我的繳費申請紀錄 =====
function renderMyRenewals() {
    const list = document.getElementById('myRenewalList');
    const search = document.getElementById('renewSearchInput').value.toLowerCase();

    // 保留成功訊息
    const successMsgs = list.querySelectorAll('.success-msg');

    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;

    // 只顯示 type === 'renewal' 的申請
    let filtered = applications.filter(a => a.type === 'renewal').reverse();

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
            String(a.id).includes(search) ||
            String(a.originalAppId).includes(search)
        );
    }

    list.innerHTML = '';
    successMsgs.forEach(m => list.appendChild(m));

    if (filtered.length === 0) {
        list.innerHTML += `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>${search ? '找不到符合的繳費申請紀錄' : '尚無繳費申請紀錄'}</p>
            </div>`;
        return;
    }

    filtered.forEach(app => {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.onclick = () => showRenewDetail(app);

        const statusInfo = getStatusInfo(app.status);
        const cabinetLabel = app.assignedCabinet !== null 
            ? `機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}` 
            : '-';

        card.innerHTML = `
            <div class="app-card-header">
                <div>
                    <div class="app-card-title"><i class="fas fa-rotate" style="color:#3b82f6;margin-right:4px;"></i> ${app.deviceName}</div>
                    <div class="app-card-id">#${app.id} (原 #${app.originalAppId})</div>
                </div>
                <span class="status-badge status-${app.status}">${statusInfo.icon} ${statusInfo.label}</span>
            </div>
            <div class="app-card-body">
                <div class="info-row"><span class="info-label">申請人</span><span>${app.applicantName} / ${app.applicantUnit}</span></div>
                <div class="info-row"><span class="info-label">延期</span><span>${app.originalEndDate || app.startDate} → ${app.endDate}</span></div>
                <div class="info-row"><span class="info-label">位置</span><span>${cabinetLabel}</span></div>
            </div>
            <div class="app-card-footer">
                <span class="app-card-date"><i class="fas fa-calendar"></i> ${formatDate(app.submitDate)}</span>
                <span class="status-badge status-${app.paymentStatus}">
                    ${app.paymentStatus === 'paid' ? '✓ 已繳費' : '$ NT$' + (app.fee || 0).toLocaleString()}
                </span>
            </div>
        `;
        list.appendChild(card);
    });
}

// ===== 繳費申請詳情彈窗 =====
function showRenewDetail(app) {
    const content = document.getElementById('renewDetailContent');
    const statusInfo = getStatusInfo(app.status);

    content.innerHTML = `
        <div style="text-align:center;margin-bottom:16px;">
            <span class="status-badge status-${app.status}" style="font-size:0.9rem;padding:6px 16px;">
                ${statusInfo.icon} ${statusInfo.label}
            </span>
            <div style="color:#94a3b8;font-size:0.8rem;margin-top:6px;">繳費申請 #${app.id}　(原設備申請 #${app.originalAppId})</div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-user"></i> 申請人資訊</div>
            <div class="detail-row"><span class="detail-label">姓名</span><span class="detail-value">${app.applicantName}</span></div>
            <div class="detail-row"><span class="detail-label">單位</span><span class="detail-value">${app.applicantUnit}</span></div>
            <div class="detail-row"><span class="detail-label">信箱</span><span class="detail-value">${app.applicantEmail}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-server"></i> 設備資訊</div>
            <div class="detail-row"><span class="detail-label">設備名稱</span><span class="detail-value">${app.deviceName}</span></div>
            <div class="detail-row"><span class="detail-label">型號</span><span class="detail-value">${app.deviceModel || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">大小</span><span class="detail-value">${app.uSize}U</span></div>
            <div class="detail-row"><span class="detail-label">機櫃位置</span><span class="detail-value">${app.assignedCabinet !== null ? '機櫃 ' + CABINET_NAMES[app.assignedCabinet] + ' U' + app.assignedStartU + '-U' + (app.assignedStartU + app.uSize - 1) : '-'}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-calendar-plus"></i> 延期資訊</div>
            <div class="detail-row"><span class="detail-label">原到期日</span><span class="detail-value">${app.originalEndDate || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">延期起始</span><span class="detail-value">${app.startDate}</span></div>
            <div class="detail-row"><span class="detail-label">新到期日</span><span class="detail-value" style="color:#16a34a;font-weight:700;">${app.endDate}</span></div>
            <div class="detail-row"><span class="detail-label">申請日期</span><span class="detail-value">${formatDate(app.submitDate)}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-credit-card"></i> 繳費資訊</div>
            <div class="detail-row"><span class="detail-label">延期費用</span><span class="detail-value" style="font-weight:700;">NT$ ${(app.fee || 0).toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">繳費狀態</span><span class="detail-value"><span class="status-badge status-${app.paymentStatus}">${app.paymentStatus === 'paid' ? '已繳費' : app.paymentStatus === 'partial' ? '部分繳費' : '待繳費'}</span></span></div>
            ${app.paymentDate ? `<div class="detail-row"><span class="detail-label">繳費日期</span><span class="detail-value">${formatDate(app.paymentDate)}</span></div>` : ''}
            ${app.paymentMethod ? `<div class="detail-row"><span class="detail-label">繳費方式</span><span class="detail-value">${{
                transfer: '銀行轉帳', cash: '現金繳費', check: '支票', budget: '校內經費核銷'
            }[app.paymentMethod] || app.paymentMethod}</span></div>` : ''}
            ${app.budgetProject ? `<div class="detail-row"><span class="detail-label">計畫編號</span><span class="detail-value" style="font-weight:600;color:#7c3aed;">${app.budgetProject}</span></div>` : ''}
        </div>
        ${app.adminNotes ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-comment"></i> 管理員備註</div>
            <p style="color:#475569;font-size:0.9rem;">${app.adminNotes}</p>
        </div>` : ''}
        ${app.notes ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-sticky-note"></i> 申請備註</div>
            <p style="color:#475569;font-size:0.9rem;">${app.notes}</p>
        </div>` : ''}
    `;

    document.getElementById('renewDetailModal').classList.add('active');
}

function closeRenewDetail(e) {
    if (e.target === document.getElementById('renewDetailModal')) closeRenewDetailDirect();
}

function closeRenewDetailDirect() {
    document.getElementById('renewDetailModal').classList.remove('active');
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
