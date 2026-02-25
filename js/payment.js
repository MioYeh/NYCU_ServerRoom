/**
 * 繳費管理頁面邏輯
 * - 管理員：看到所有人的繳費紀錄 + 圖表
 * - 一般使用者：只看到自己的待繳費用，可選擇繳全部或繳到指定日期
 */

let applications = [];
let paymentFilter = 'all';
let batchPayItems = []; // 批次繳費項目

document.addEventListener('DOMContentLoaded', async () => {
    await loadApplications();
    initPaymentPage();
    renderPaymentList();
    renderPaymentCharts();
});

// ===== 角色判斷 =====
function isAdminUser() {
    return typeof Auth !== 'undefined' && Auth.isAdmin();
}

function getCurrentPaymentUser() {
    return (typeof Auth !== 'undefined') ? Auth.getCurrentUser() : null;
}

// ===== 初始化頁面(依角色) =====
function initPaymentPage() {
    const admin = isAdminUser();
    const panel = document.getElementById('userPaymentPanel');
    const chartDash = document.getElementById('chartDashboard');

    if (admin) {
        // 管理員：顯示圖表，隱藏使用者面板
        if (panel) panel.style.display = 'none';
        if (chartDash) chartDash.style.display = '';
    } else {
        // 一般使用者：顯示個人繳費面板，隱藏圖表
        if (panel) panel.style.display = '';
        if (chartDash) chartDash.style.display = 'none';
        // 隱藏總收入 badge（僅管理員需要）
        const revenueEl = document.getElementById('totalRevenue');
        if (revenueEl) revenueEl.style.display = 'none';
        renderUserPaymentPanel();
    }
}

// ===== 資料管理 (Firestore) =====
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

// ===== 篩選 =====
function setPaymentFilter(filter, btn) {
    paymentFilter = filter;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPaymentList();
}

// ===== 取得需要繳費的申請 (approved 或 installed 且有費用) =====
function getPayableApplications() {
    let apps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0
    );

    // 一般使用者只看自己的
    if (!isAdminUser()) {
        const currentUser = getCurrentPaymentUser();
        if (currentUser) {
            apps = apps.filter(a =>
                a.submittedBy === currentUser.uid ||
                a.submittedBy === currentUser.username ||
                (!a.submittedBy && a.applicantName === currentUser.displayName)
            );
        }
    }

    return apps;
}

// ===== 取得未繳費的申請（含部分繳費）=====
function getUnpaidApplications() {
    return getPayableApplications().filter(a =>
        a.paymentStatus === 'unpaid' || a.paymentStatus === 'overdue' || a.paymentStatus === 'partial'
    );
}

// ===== 計算某申請的剩餘未繳金額 =====
function getRemainingFee(app) {
    return app.fee - (app.paidAmount || 0);
}

// ===== 計算繳費到指定日期的金額 =====
function calculateFeeUpToDate(app, payUpToDateStr) {
    // payUpToDateStr: "YYYY-MM" (month) 格式
    // 轉換為該月最後一天
    const parts = payUpToDateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const lastDay = new Date(year, month, 0).getDate();
    const payUpToDate = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    const effectiveStart = app.paidUpTo || app.startDate;
    const endDate = app.endDate;

    if (!endDate || !effectiveStart) return getRemainingFee(app);

    // 如果繳費到的日期 >= 結束日期，繳清全部
    if (payUpToDate >= endDate) {
        return getRemainingFee(app);
    }

    // 如果繳費到的日期 <= 已繳費到的日期（或起始日期），不需繳費
    if (payUpToDate < effectiveStart) {
        return 0;
    }

    // 計算從起始到指定日期的費用，再扣除已繳金額
    const feeUpTo = calculateProRatedFee(app.startDate, payUpToDate, app.uSize).fee;
    const alreadyPaid = app.paidAmount || 0;
    return Math.max(0, feeUpTo - alreadyPaid);
}

// ===== 渲染一般使用者繳費面板 =====
async function renderUserPaymentPanel() {
    if (isAdminUser()) return;

    await loadApplications();

    const unpaid = getUnpaidApplications();
    const totalUnpaid = unpaid.reduce((sum, a) => sum + getRemainingFee(a), 0);

    // 更新待繳徽章
    const badge = document.getElementById('userUnpaidBadge');
    if (badge) badge.textContent = `${unpaid.length} 筆待繳`;

    // 更新全部金額
    const allAmount = document.getElementById('modeAllAmount');
    if (allAmount) allAmount.textContent = `NT$ ${totalUnpaid.toLocaleString()}`;

    // 預設繳全部（先渲染項目，再檢查已勾選的算金額）
    const mode = document.querySelector('input[name="payMode"]:checked');
    if (mode && mode.value === 'all') {
        renderPaymentItemsPreview(unpaid, null);
        // 預設全選，但也尊重使用者之前的勾選
        recalcSelectedTotal();
    } else {
        updatePartialPayment();
    }
}

// ===== 切換繳費模式 =====
function updatePaymentMode() {
    const mode = document.querySelector('input[name="payMode"]:checked').value;
    const partialSection = document.getElementById('partialDateSection');
    const allLabel = document.getElementById('modeAllLabel');
    const partialLabel = document.getElementById('modePartialLabel');

    allLabel.classList.toggle('active', mode === 'all');
    partialLabel.classList.toggle('active', mode === 'partial');

    if (mode === 'partial') {
        partialSection.style.display = '';
        // 設定預設值為下個月
        const dateInput = document.getElementById('payUpToDate');
        if (!dateInput.value) {
            const now = new Date();
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            dateInput.value = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
        }
        updatePartialPayment();
    } else {
        partialSection.style.display = 'none';
        const unpaid = getUnpaidApplications();
        renderPaymentItemsPreview(unpaid, null);
        recalcSelectedTotal();
    }
}

// ===== 更新部分繳費計算 =====
function updatePartialPayment() {
    const dateInput = document.getElementById('payUpToDate');
    const hint = document.getElementById('partialDateHint');
    const partialAmount = document.getElementById('modePartialAmount');

    if (!dateInput.value) {
        if (hint) hint.textContent = '請選擇繳費截止月份';
        if (partialAmount) partialAmount.textContent = '選擇日期後顯示';
        renderPaymentItemsPreview([], null);
        updateUserPayTotal(0, 0);
        return;
    }

    const unpaid = getUnpaidApplications();
    let totalToPay = 0;
    let itemCount = 0;
    const itemsWithFee = [];

    unpaid.forEach(app => {
        const fee = calculateFeeUpToDate(app, dateInput.value);
        if (fee > 0) {
            itemCount++;
            totalToPay += fee;
            itemsWithFee.push({ app, fee });
        }
    });

    // 轉換日期顯示
    const parts = dateInput.value.split('-');
    const displayDate = `${parts[0]} 年 ${parseInt(parts[1])} 月`;

    if (hint) hint.textContent = `繳費到 ${displayDate} 底，共 ${itemCount} 筆，合計 NT$ ${totalToPay.toLocaleString()}`;
    if (partialAmount) partialAmount.textContent = `NT$ ${totalToPay.toLocaleString()}`;

    renderPaymentItemsPreview(unpaid, dateInput.value);
    recalcSelectedTotal();
}

// ===== 渲染繳費項目預覽（含勾選功能）=====
function renderPaymentItemsPreview(unpaidApps, payUpToMonth) {
    const container = document.getElementById('paymentItemsPreview');
    if (!container) return;

    if (unpaidApps.length === 0) {
        container.innerHTML = '<div class="preview-empty"><i class="fas fa-check-circle"></i> 目前沒有待繳費用</div>';
        return;
    }

    const hasPayable = unpaidApps.some(app => {
        const fee = payUpToMonth ? calculateFeeUpToDate(app, payUpToMonth) : getRemainingFee(app);
        return fee > 0;
    });

    let html = '<div class="preview-header">';
    html += '<span><i class="fas fa-list-ul"></i> 繳費明細</span>';
    if (hasPayable) {
        html += '<label class="select-all-label"><input type="checkbox" id="selectAllItems" checked onchange="toggleSelectAll()"> 全選</label>';
    }
    html += '</div>';
    html += '<div class="preview-items">';

    unpaidApps.forEach(app => {
        const fee = payUpToMonth ? calculateFeeUpToDate(app, payUpToMonth) : getRemainingFee(app);
        const remainingTotal = getRemainingFee(app);
        const isPartial = payUpToMonth && fee < remainingTotal && fee > 0;
        const isSkipped = fee === 0;

        const effectiveStart = app.paidUpTo || app.startDate;
        const cabinetLabel = app.assignedCabinet !== null
            ? `${CABINET_NAMES[app.assignedCabinet]} / U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
            : '-';

        html += `
            <div class="preview-item ${isSkipped ? 'preview-item-skipped' : ''}">
                ${isSkipped ? '' : `<input type="checkbox" class="pay-item-check" data-app-id="${app.id}" data-fee="${fee}" checked onchange="recalcSelectedTotal()">`}
                <div class="preview-item-info">
                    <div class="preview-item-name">
                        <strong>#${app.id}</strong> ${app.deviceName} (${app.uSize}U)
                    </div>
                    <div class="preview-item-meta">
                        ${cabinetLabel} ｜ ${effectiveStart} ~ ${app.endDate}
                        ${app.paidUpTo ? `<span class="badge-inline badge-partial">已繳到 ${app.paidUpTo}</span>` : ''}
                    </div>
                </div>
                <div class="preview-item-fee">
                    ${isSkipped
                        ? '<span class="text-muted">不在範圍</span>'
                        : `<strong>NT$ ${fee.toLocaleString()}</strong>
                           ${isPartial ? `<span class="text-hint">/ 剩餘 $${remainingTotal.toLocaleString()}</span>` : ''}`
                    }
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

// ===== 全選/取消全選 =====
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAllItems');
    const checkboxes = document.querySelectorAll('.pay-item-check');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    recalcSelectedTotal();
}

// ===== 重新計算已勾選的總金額 =====
function recalcSelectedTotal() {
    const checkboxes = document.querySelectorAll('.pay-item-check');
    let total = 0;
    let count = 0;
    checkboxes.forEach(cb => {
        if (cb.checked) {
            total += parseFloat(cb.dataset.fee) || 0;
            count++;
        }
    });

    // 同步全選 checkbox 狀態
    const selectAll = document.getElementById('selectAllItems');
    if (selectAll) {
        selectAll.checked = count === checkboxes.length;
        selectAll.indeterminate = count > 0 && count < checkboxes.length;
    }

    updateUserPayTotal(total, count);
}

// ===== 更新使用者繳費總額 =====
function updateUserPayTotal(total, count) {
    const totalEl = document.getElementById('userPayTotal');
    const btn = document.getElementById('userBatchPayBtn');
    const btnText = document.getElementById('userPayBtnText');

    if (totalEl) totalEl.textContent = `NT$ ${total.toLocaleString()}`;
    if (btn) btn.disabled = total <= 0;
    if (btnText) btnText.textContent = total > 0 ? `前往繳費 NT$ ${total.toLocaleString()}` : '無待繳費用';
}

// ===== 開啟批次繳費彈窗 =====
function openBatchPayModal() {
    const mode = document.querySelector('input[name="payMode"]:checked').value;
    const payUpToMonth = mode === 'partial' ? document.getElementById('payUpToDate').value : null;

    // 只取已勾選的項目
    const checkedBoxes = document.querySelectorAll('.pay-item-check:checked');
    batchPayItems = [];
    let totalToPay = 0;

    checkedBoxes.forEach(cb => {
        const appId = parseInt(cb.dataset.appId);
        const fee = parseFloat(cb.dataset.fee) || 0;
        if (fee > 0) {
            batchPayItems.push({ appId, fee, payUpToMonth });
            totalToPay += fee;
        }
    });

    if (batchPayItems.length === 0) {
        alert('沒有需要繳費的項目');
        return;
    }

    document.getElementById('payAppId').value = '';
    document.getElementById('payBatchMode').value = 'batch';
    document.getElementById('payBatchData').value = JSON.stringify(batchPayItems);
    document.getElementById('payMethod').value = '';
    document.getElementById('payRef').value = '';

    // 組合 modal 資訊
    let infoHTML = '<div style="background:#f8fafc;border-radius:8px;padding:14px;margin-bottom:16px;">';
    infoHTML += `<div class="detail-row" style="font-size:1rem;font-weight:600;margin-bottom:10px;">
        <span class="detail-label">批次繳費</span>
        <span class="detail-value">${batchPayItems.length} 筆項目</span>
    </div>`;

    if (payUpToMonth) {
        const parts = payUpToMonth.split('-');
        infoHTML += `<div class="detail-row">
            <span class="detail-label">繳費到</span>
            <span class="detail-value">${parts[0]} 年 ${parseInt(parts[1])} 月</span>
        </div>`;
    }

    infoHTML += '<div style="max-height:200px;overflow-y:auto;margin:10px 0;">';
    batchPayItems.forEach(item => {
        const app = applications.find(a => a.id === item.appId);
        if (app) {
            infoHTML += `<div class="detail-row" style="font-size:0.85rem;">
                <span class="detail-label">#${app.id} ${app.deviceName}</span>
                <span class="detail-value">NT$ ${item.fee.toLocaleString()}</span>
            </div>`;
        }
    });
    infoHTML += '</div>';

    infoHTML += `<div class="detail-row" style="font-size:1.1rem;font-weight:700;color:#16a34a;padding-top:8px;border-top:1px solid #e2e8f0;margin-top:8px;">
        <span class="detail-label">應繳總額</span>
        <span class="detail-value">NT$ ${totalToPay.toLocaleString()}</span>
    </div></div>`;

    document.getElementById('payModalInfo').innerHTML = infoHTML;
    document.getElementById('payModal').classList.add('active');
}

// ===== 渲染 =====
async function renderPaymentList() {
    await loadApplications();
    const search = document.getElementById('paymentSearch').value.toLowerCase();

    let payable = getPayableApplications();

    // 檢查逾期 (核准後 30 天未繳)
    const now = new Date();
    payable.forEach(a => {
        if (a.paymentStatus === 'unpaid' && a.reviewDate) {
            const reviewDate = new Date(a.reviewDate);
            const diffDays = Math.floor((now - reviewDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 30) {
                a.paymentStatus = 'overdue';
            }
        }
    });

    // 篩選
    if (paymentFilter === 'unpaid') {
        payable = payable.filter(a => a.paymentStatus === 'unpaid' || a.paymentStatus === 'partial');
    } else if (paymentFilter === 'paid') {
        payable = payable.filter(a => a.paymentStatus === 'paid' && !a.adminConfirmedDate);
    } else if (paymentFilter === 'overdue') {
        payable = payable.filter(a => a.paymentStatus === 'overdue');
    } else if (paymentFilter === 'confirmed') {
        payable = payable.filter(a => a.paymentStatus === 'paid' && a.adminConfirmedDate);
    }

    // 搜尋
    if (search) {
        payable = payable.filter(a =>
            a.applicantName.toLowerCase().includes(search) ||
            a.applicantUnit.toLowerCase().includes(search) ||
            a.deviceName.toLowerCase().includes(search) ||
            String(a.id).includes(search)
        );
    }

    // 排序: 未繳費在前，已入帳在最後
    payable.sort((a, b) => {
        const orderA = a.paymentStatus === 'paid' && a.adminConfirmedDate ? 4 : ({ overdue: 0, unpaid: 1, partial: 2, paid: 3 }[a.paymentStatus] || 0);
        const orderB = b.paymentStatus === 'paid' && b.adminConfirmedDate ? 4 : ({ overdue: 0, unpaid: 1, partial: 2, paid: 3 }[b.paymentStatus] || 0);
        return orderA - orderB;
    });

    updatePaymentCounts();

    const tbody = document.getElementById('paymentBody');
    const empty = document.getElementById('paymentEmpty');
    const table = document.getElementById('paymentTable');

    tbody.innerHTML = '';

    if (payable.length === 0) {
        table.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    table.style.display = '';
    empty.style.display = 'none';

    payable.forEach(app => {
        const tr = document.createElement('tr');
        const cabinetLabel = app.assignedCabinet !== null
            ? `${CABINET_NAMES[app.assignedCabinet]} / U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
            : '-';

        const statusClass = `status-${app.paymentStatus}`;
        const statusLabel = app.paymentStatus === 'paid' ? '已繳費'
            : app.paymentStatus === 'overdue' ? '逾期'
            : app.paymentStatus === 'partial' ? '部分繳費'
            : '待繳費';

        // 費用顯示: 如果部分繳費，顯示剩餘及已繳資訊
        let feeDisplay = `<strong>NT$ ${app.fee.toLocaleString()}</strong>`;
        if (app.paymentStatus === 'partial' && app.paidAmount > 0) {
            const remaining = getRemainingFee(app);
            feeDisplay = `
                <strong>NT$ ${remaining.toLocaleString()}</strong>
                <div style="font-size:0.75rem;color:#64748b;">
                    已繳 $${app.paidAmount.toLocaleString()} / 總 $${app.fee.toLocaleString()}
                    ${app.paidUpTo ? '<br>繳到 ' + app.paidUpTo : ''}
                </div>
            `;
        }

        // 入帳確認欄位
        let confirmHTML = '-';
        if (app.paymentStatus === 'paid') {
            if (app.adminConfirmedDate) {
                confirmHTML = `
                    <div class="confirmed-info">
                        <span class="status-badge status-confirmed"><i class="fas fa-check-double"></i> 已入帳</span>
                        <div style="font-size:0.7rem;color:#64748b;margin-top:2px;">${formatDate(app.adminConfirmedDate)}</div>
                        ${app.adminConfirmedBy ? `<div style="font-size:0.7rem;color:#64748b;">${app.adminConfirmedBy}</div>` : ''}
                    </div>
                `;
            } else if (isAdminUser()) {
                confirmHTML = `
                    <button class="btn btn-confirm btn-xs" onclick="confirmPayment(${app.id})">
                        <i class="fas fa-clipboard-check"></i> 入帳確認
                    </button>
                `;
            } else {
                confirmHTML = '<span style="color:#94a3b8;font-size:0.8rem;">待管理員確認</span>';
            }
        }

        let actionsHTML = '';
        if (app.paymentStatus === 'unpaid' || app.paymentStatus === 'overdue' || app.paymentStatus === 'partial') {
            actionsHTML = `
                <button class="btn btn-success btn-xs" onclick="openPayModal(${app.id})">
                    <i class="fas fa-money-bill-wave"></i> 繳費
                </button>
            `;
        }
        actionsHTML += `
            <button class="btn btn-secondary btn-xs" onclick="openPayDetail(${app.id})">
                <i class="fas fa-eye"></i>
            </button>
        `;

        tr.innerHTML = `
            <td><strong>#${app.id}</strong></td>
            <td>${app.applicantName}</td>
            <td>${app.applicantUnit}</td>
            <td>${app.deviceName} (${app.uSize}U)</td>
            <td>${cabinetLabel}</td>
            <td>${feeDisplay}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td>${app.paymentDate ? formatDate(app.paymentDate) : (app.paidUpTo ? '繳到 ' + app.paidUpTo : '-')}</td>
            <td>${confirmHTML}</td>
            <td><div class="actions-cell">${actionsHTML}</div></td>
        `;
        tbody.appendChild(tr);
    });

    // 更新圖表 (僅管理員)
    if (isAdminUser()) {
        renderPaymentCharts();
    }

    // 更新使用者面板
    if (!isAdminUser()) {
        renderUserPaymentPanel();
    }
}

function updatePaymentCounts() {
    const payable = getPayableApplications();
    const unpaid = payable.filter(a => a.paymentStatus === 'unpaid').length;
    const partial = payable.filter(a => a.paymentStatus === 'partial').length;
    const paid = payable.filter(a => a.paymentStatus === 'paid').length;
    const paidUnconfirmed = payable.filter(a => a.paymentStatus === 'paid' && !a.adminConfirmedDate).length;
    const confirmed = payable.filter(a => a.paymentStatus === 'paid' && a.adminConfirmedDate).length;
    const overdue = payable.filter(a => a.paymentStatus === 'overdue').length;
    const totalRevenue = payable.filter(a => a.paymentStatus === 'paid').reduce((sum, a) => sum + a.fee, 0)
        + payable.filter(a => a.paymentStatus === 'partial').reduce((sum, a) => sum + (a.paidAmount || 0), 0);

    document.getElementById('payTabAll').textContent = payable.length;
    document.getElementById('payTabUnpaid').textContent = unpaid + partial;
    document.getElementById('payTabPaid').textContent = paidUnconfirmed;
    document.getElementById('payTabOverdue').textContent = overdue;
    document.getElementById('payTabConfirmed').textContent = confirmed;

    document.getElementById('unpaidCount').textContent = `${unpaid + overdue + partial} 待繳費`;
    document.getElementById('paidCount').textContent = `${paid} 已繳費`;
    const confirmedCountEl = document.getElementById('confirmedCount');
    if (confirmedCountEl) confirmedCountEl.textContent = `${confirmed} 已入帳`;
    document.getElementById('totalRevenue').textContent = `總收入 $${totalRevenue.toLocaleString()}`;
}

// ===== 繳費彈窗 (單筆) =====
function openPayModal(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    document.getElementById('payAppId').value = appId;
    document.getElementById('payBatchMode').value = '';
    document.getElementById('payBatchData').value = '';
    document.getElementById('payMethod').value = '';
    document.getElementById('payRef').value = '';

    const remaining = getRemainingFee(app);
    const effectiveStart = app.paidUpTo || app.startDate;
    const endDateLabel = app.endDate || (app.duration === 0 ? '長期' : app.duration + ' 個月');

    let infoHTML = `
        <div style="background:#f8fafc;border-radius:8px;padding:14px;margin-bottom:16px;">
            <div class="detail-row"><span class="detail-label">申請編號</span><span class="detail-value">#${app.id}</span></div>
            <div class="detail-row"><span class="detail-label">設備</span><span class="detail-value">${app.deviceName}</span></div>
            <div class="detail-row"><span class="detail-label">申請人</span><span class="detail-value">${app.applicantName} / ${app.applicantUnit}</span></div>
            <div class="detail-row"><span class="detail-label">使用期間</span><span class="detail-value">${app.startDate} ~ ${endDateLabel}</span></div>
    `;

    if (app.paidAmount > 0) {
        infoHTML += `
            <div class="detail-row" style="color:#3b82f6;">
                <span class="detail-label">已繳金額</span>
                <span class="detail-value">NT$ ${app.paidAmount.toLocaleString()} (繳到 ${app.paidUpTo})</span>
            </div>
        `;
    }

    infoHTML += `
            <div class="detail-row" style="font-size:1.1rem;font-weight:700;color:#16a34a;padding-top:8px;border-top:1px solid #e2e8f0;margin-top:8px;">
                <span class="detail-label">應繳金額</span>
                <span class="detail-value">NT$ ${remaining.toLocaleString()}</span>
            </div>
        </div>
    `;

    document.getElementById('payModalInfo').innerHTML = infoHTML;
    document.getElementById('payModal').classList.add('active');
}

function closePayModal(e) {
    if (e.target === document.getElementById('payModal')) closePayModalDirect();
}
function closePayModalDirect() {
    document.getElementById('payModal').classList.remove('active');
}

async function handlePaySubmit(e) {
    e.preventDefault();

    const batchMode = document.getElementById('payBatchMode').value;
    const method = document.getElementById('payMethod').value;
    const ref = document.getElementById('payRef').value.trim();

    const methodLabels = {
        transfer: '銀行轉帳',
        cash: '現金繳費',
        check: '支票',
        budget: '校內經費核銷'
    };

    if (batchMode === 'batch') {
        // 批次繳費
        handleBatchPaySubmit(method, ref, methodLabels);
    } else {
        // 單筆繳費
        handleSinglePaySubmit(method, ref, methodLabels);
    }
}

// ===== 單筆繳費處理 =====
async function handleSinglePaySubmit(method, ref, methodLabels) {
    const appId = parseInt(document.getElementById('payAppId').value);
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const remaining = getRemainingFee(app);

    if (!confirm(`確認繳費？\n\n金額：NT$ ${remaining.toLocaleString()}\n方式：${methodLabels[method] || method}\n${ref ? '憑證：' + ref : ''}`)) {
        return;
    }

    // 繳清全額
    app.paymentStatus = 'paid';
    app.paymentDate = new Date().toISOString();
    app.paymentMethod = method;
    app.paymentRef = ref;
    app.paidAmount = app.fee;
    app.paidUpTo = app.endDate;

    await saveApplications();
    closePayModalDirect();
    renderPaymentList();
    alert(`✅ 繳費完成！申請 #${appId} 已標記為已繳費。`);
}

// ===== 批次繳費處理 =====
async function handleBatchPaySubmit(method, ref, methodLabels) {
    let items;
    try {
        items = JSON.parse(document.getElementById('payBatchData').value);
    } catch(e) { return; }

    const totalFee = items.reduce((sum, i) => sum + i.fee, 0);

    if (!confirm(`確認批次繳費？\n\n共 ${items.length} 筆，總金額：NT$ ${totalFee.toLocaleString()}\n方式：${methodLabels[method] || method}\n${ref ? '憑證：' + ref : ''}`)) {
        return;
    }

    const nowISO = new Date().toISOString();

    items.forEach(item => {
        const app = applications.find(a => a.id === item.appId);
        if (!app) return;

        const prevPaid = app.paidAmount || 0;
        const newPaid = prevPaid + item.fee;

        app.paidAmount = newPaid;
        app.paymentMethod = method;
        app.paymentRef = ref;

        if (item.payUpToMonth) {
            // 部分繳費 → 計算繳費到日期
            const parts = item.payUpToMonth.split('-');
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const lastDay = new Date(year, month, 0).getDate();
            const payUpToDate = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

            if (payUpToDate >= app.endDate) {
                // 已繳清
                app.paymentStatus = 'paid';
                app.paymentDate = nowISO;
                app.paidUpTo = app.endDate;
                app.paidAmount = app.fee;
            } else {
                app.paymentStatus = 'partial';
                app.paidUpTo = payUpToDate;
            }
        } else {
            // 繳清全額
            app.paymentStatus = 'paid';
            app.paymentDate = nowISO;
            app.paidUpTo = app.endDate;
            app.paidAmount = app.fee;
        }
    });

    await saveApplications();
    closePayModalDirect();
    renderPaymentList();
    alert(`✅ 批次繳費完成！共 ${items.length} 筆，合計 NT$ ${totalFee.toLocaleString()}`);
}

// ===== 繳費詳情 =====
function openPayDetail(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const content = document.getElementById('payDetailContent');
    const methodLabels = {
        transfer: '銀行轉帳',
        cash: '現金繳費',
        check: '支票',
        budget: '校內經費核銷'
    };

    const endDateDisplay = app.endDate || (app.duration === 0 ? '長期' : app.duration + ' 個月');
    const statusLabel = app.paymentStatus === 'paid' ? '已繳費'
        : app.paymentStatus === 'overdue' ? '逾期'
        : app.paymentStatus === 'partial' ? '部分繳費'
        : '待繳費';

    let paymentInfoHTML = `
        <div class="detail-row"><span class="detail-label">總費用</span><span class="detail-value" style="font-weight:700;">NT$ ${app.fee.toLocaleString()}</span></div>
        <div class="detail-row"><span class="detail-label">狀態</span><span class="detail-value"><span class="status-badge status-${app.paymentStatus}">${statusLabel}</span></span></div>
    `;

    if (app.paymentStatus === 'partial' && app.paidAmount > 0) {
        const remaining = getRemainingFee(app);
        paymentInfoHTML += `
            <div class="detail-row"><span class="detail-label">已繳金額</span><span class="detail-value" style="color:#3b82f6;font-weight:600;">NT$ ${app.paidAmount.toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">繳費到</span><span class="detail-value">${app.paidUpTo || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">剩餘未繳</span><span class="detail-value" style="color:#f59e0b;font-weight:600;">NT$ ${remaining.toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">繳費方式</span><span class="detail-value">${methodLabels[app.paymentMethod] || app.paymentMethod || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">憑證/備註</span><span class="detail-value">${app.paymentRef || '-'}</span></div>
        `;
    } else if (app.paymentStatus === 'paid') {
        paymentInfoHTML += `
            <div class="detail-row"><span class="detail-label">繳費日期</span><span class="detail-value">${formatDate(app.paymentDate)}</span></div>
            <div class="detail-row"><span class="detail-label">繳費方式</span><span class="detail-value">${methodLabels[app.paymentMethod] || app.paymentMethod || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">憑證/備註</span><span class="detail-value">${app.paymentRef || '-'}</span></div>
        `;
        // 入帳確認資訊
        if (app.adminConfirmedDate) {
            paymentInfoHTML += `
                <div class="detail-row" style="padding-top:10px;border-top:1px solid #e2e8f0;margin-top:10px;">
                    <span class="detail-label">入帳確認</span>
                    <span class="detail-value"><span class="status-badge status-confirmed"><i class="fas fa-check-double"></i> 已入帳</span></span>
                </div>
                <div class="detail-row"><span class="detail-label">確認時間</span><span class="detail-value">${formatDate(app.adminConfirmedDate)}</span></div>
                <div class="detail-row"><span class="detail-label">確認人員</span><span class="detail-value">${app.adminConfirmedBy || '-'}</span></div>
            `;
        } else {
            paymentInfoHTML += `
                <div class="detail-row" style="padding-top:10px;border-top:1px solid #e2e8f0;margin-top:10px;">
                    <span class="detail-label">入帳確認</span>
                    <span class="detail-value" style="color:#f59e0b;"><i class="fas fa-clock"></i> 待管理員確認入帳</span>
                </div>
            `;
        }
    } else {
        paymentInfoHTML += `
            <div class="detail-row"><span class="detail-label">核准日期</span><span class="detail-value">${formatDate(app.reviewDate)}</span></div>
            <div class="detail-row"><span class="detail-label">繳費期限</span><span class="detail-value">核准後 30 天內</span></div>
        `;
    }

    content.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-file-alt"></i> 申請資訊</div>
            <div class="detail-row"><span class="detail-label">申請編號</span><span class="detail-value">#${app.id}</span></div>
            <div class="detail-row"><span class="detail-label">申請人</span><span class="detail-value">${app.applicantName}</span></div>
            <div class="detail-row"><span class="detail-label">單位</span><span class="detail-value">${app.applicantUnit}</span></div>
            <div class="detail-row"><span class="detail-label">信箱</span><span class="detail-value">${app.applicantEmail}</span></div>
            <div class="detail-row"><span class="detail-label">設備</span><span class="detail-value">${app.deviceName} (${app.uSize}U)</span></div>
            <div class="detail-row"><span class="detail-label">機櫃位置</span><span class="detail-value">${app.assignedCabinet !== null ? '機櫃 ' + CABINET_NAMES[app.assignedCabinet] + ' U' + app.assignedStartU + '-U' + (app.assignedStartU + app.uSize - 1) : '-'}</span></div>
            <div class="detail-row"><span class="detail-label">上架日期</span><span class="detail-value">${app.startDate}</span></div>
            <div class="detail-row"><span class="detail-label">使用到期日</span><span class="detail-value">${endDateDisplay}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-credit-card"></i> 繳費資訊</div>
            ${paymentInfoHTML}
        </div>
    `;

    document.getElementById('payDetailModal').classList.add('active');
}

function closePayDetailModal(e) {
    if (e.target === document.getElementById('payDetailModal')) closePayDetailModalDirect();
}
function closePayDetailModalDirect() {
    document.getElementById('payDetailModal').classList.remove('active');
}

// ===== 管理員入帳確認 =====
async function confirmPayment(appId) {
    if (!isAdminUser()) {
        alert('只有管理員可以進行入帳確認');
        return;
    }

    const app = applications.find(a => a.id === appId);
    if (!app) return;

    if (app.paymentStatus !== 'paid') {
        alert('此筆申請尚未完成繳費，無法進行入帳確認');
        return;
    }

    if (app.adminConfirmedDate) {
        alert('此筆款項已經確認入帳');
        return;
    }

    const methodLabels = {
        transfer: '銀行轉帳',
        cash: '現金繳費',
        check: '支票',
        budget: '校內經費核銷'
    };

    const confirmMsg = `確認入帳？\n\n申請編號: #${app.id}\n設備: ${app.deviceName}\n申請人: ${app.applicantName}\n金額: NT$ ${app.fee.toLocaleString()}\n繳費方式: ${methodLabels[app.paymentMethod] || app.paymentMethod || '-'}\n${app.budgetProject ? '計畫編號: ' + app.budgetProject + '\n' : ''}${app.paymentRef ? '憑證: ' + app.paymentRef : ''}`;

    if (!confirm(confirmMsg)) return;

    const currentUser = getCurrentPaymentUser();
    app.adminConfirmedDate = new Date().toISOString();
    app.adminConfirmedBy = currentUser ? (currentUser.displayName || currentUser.username || currentUser.uid) : '管理員';

    await saveApplications();
    renderPaymentList();
    alert(`✅ 已確認入帳！申請 #${appId} 的款項已完成最終確認。`);
}

// ===== 工具函式 =====
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ===== 圖表相關 (僅管理員顯示) =====
let statusChartInstance = null;
let unitChartInstance = null;

async function renderPaymentCharts() {
    if (!isAdminUser()) return;

    await loadApplications();

    // 圖表需要看所有人的資料
    const allApps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0
    );

    // 檢查逾期
    const now = new Date();
    allApps.forEach(a => {
        if (a.paymentStatus === 'unpaid' && a.reviewDate) {
            const reviewDate = new Date(a.reviewDate);
            const diffDays = Math.floor((now - reviewDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 30) {
                a.paymentStatus = 'overdue';
            }
        }
    });

    // ===== 統計數據 =====
    const totalFee = allApps.reduce((sum, a) => sum + a.fee, 0);
    const paidFee = allApps.filter(a => a.paymentStatus === 'paid').reduce((sum, a) => sum + a.fee, 0)
        + allApps.filter(a => a.paymentStatus === 'partial').reduce((sum, a) => sum + (a.paidAmount || 0), 0);
    const unpaidFee = allApps.filter(a => a.paymentStatus === 'unpaid').reduce((sum, a) => sum + a.fee, 0);
    const overdueFee = allApps.filter(a => a.paymentStatus === 'overdue').reduce((sum, a) => sum + a.fee, 0);
    const partialUnpaidFee = allApps.filter(a => a.paymentStatus === 'partial').reduce((sum, a) => sum + getRemainingFee(a), 0);
    const outstandingFee = unpaidFee + overdueFee + partialUnpaidFee;
    const rate = totalFee > 0 ? Math.round((paidFee / totalFee) * 100) : 0;

    // 更新統計卡片
    const el = (id) => document.getElementById(id);
    if (el('statTotalFee')) el('statTotalFee').textContent = `NT$ ${totalFee.toLocaleString()}`;
    if (el('statCollected')) el('statCollected').textContent = `NT$ ${paidFee.toLocaleString()}`;
    if (el('statOutstanding')) el('statOutstanding').textContent = `NT$ ${outstandingFee.toLocaleString()}`;
    if (el('statRate')) el('statRate').textContent = `${rate}%`;

    // ===== 繳費狀態圓餅圖 =====
    const paidCount = allApps.filter(a => a.paymentStatus === 'paid').length;
    const unpaidCount = allApps.filter(a => a.paymentStatus === 'unpaid').length;
    const overdueCount = allApps.filter(a => a.paymentStatus === 'overdue').length;
    const partialCount = allApps.filter(a => a.paymentStatus === 'partial').length;

    const statusCtx = document.getElementById('paymentStatusChart');
    if (statusCtx) {
        if (statusChartInstance) statusChartInstance.destroy();
        statusChartInstance = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: [
                    `已繳費 (NT$ ${paidFee.toLocaleString()})`,
                    `待繳費 (NT$ ${unpaidFee.toLocaleString()})`,
                    `逾期 (NT$ ${overdueFee.toLocaleString()})`,
                    `部分繳費 (NT$ ${partialUnpaidFee.toLocaleString()})`
                ],
                datasets: [{
                    data: [paidFee, unpaidFee, overdueFee, partialUnpaidFee],
                    backgroundColor: ['#22c55e', '#f59e0b', '#ef4444', '#3b82f6'],
                    borderColor: ['#16a34a', '#d97706', '#dc2626', '#2563eb'],
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '55%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 12,
                            font: { size: 13 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                const counts = [paidCount, unpaidCount, overdueCount, partialCount];
                                return ` ${ctx.label}（${counts[ctx.dataIndex]} 筆）`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ===== 各單位費用長條圖 =====
    const unitMap = {};
    allApps.forEach(a => {
        const unit = a.applicantUnit || '未知';
        if (!unitMap[unit]) unitMap[unit] = { paid: 0, unpaid: 0 };
        if (a.paymentStatus === 'paid') {
            unitMap[unit].paid += a.fee;
        } else if (a.paymentStatus === 'partial') {
            unitMap[unit].paid += (a.paidAmount || 0);
            unitMap[unit].unpaid += getRemainingFee(a);
        } else {
            unitMap[unit].unpaid += a.fee;
        }
    });

    const unitLabels = Object.keys(unitMap).sort((a, b) => {
        const totalA = unitMap[a].paid + unitMap[a].unpaid;
        const totalB = unitMap[b].paid + unitMap[b].unpaid;
        return totalB - totalA;
    });
    const unitPaidData = unitLabels.map(u => unitMap[u].paid);
    const unitUnpaidData = unitLabels.map(u => unitMap[u].unpaid);

    const unitCtx = document.getElementById('unitFeeChart');
    if (unitCtx) {
        if (unitChartInstance) unitChartInstance.destroy();
        unitChartInstance = new Chart(unitCtx, {
            type: 'bar',
            data: {
                labels: unitLabels,
                datasets: [
                    {
                        label: '已繳費',
                        data: unitPaidData,
                        backgroundColor: 'rgba(34, 197, 94, 0.7)',
                        borderColor: '#16a34a',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: '未繳費',
                        data: unitUnpaidData,
                        backgroundColor: 'rgba(245, 158, 11, 0.7)',
                        borderColor: '#d97706',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: {
                    x: {
                        stacked: true,
                        ticks: {
                            callback: function(val) {
                                return 'NT$ ' + val.toLocaleString();
                            },
                            font: { size: 12 }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y: {
                        stacked: true,
                        ticks: { font: { size: 13 } },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 12,
                            font: { size: 13 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                return ` ${ctx.dataset.label}: NT$ ${ctx.parsed.x.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });
    }
}
