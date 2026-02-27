/**
 * 繳費管理頁面邏輯
 * - 管理員：看到所有人的繳費紀錄 + 圖表
 * - 一般使用者：只看到自己的待繳費用，可選擇繳全部或繳到指定日期
 */

let applications = [];
let paymentFilter = 'all';
let batchPayItems = []; // 批次繳費項目
let paymentListYear = new Date().getFullYear(); // 主清單顯示年度

document.addEventListener('DOMContentLoaded', async () => {
    await loadApplications();
    initPaymentPage();
    updatePaymentListYearLabel();
    renderPaymentList();
    renderPaymentCharts();

    // 當 Firebase Auth 狀態確認後，重新渲染（確保 user profile 最新）
    document.addEventListener('auth-profile-ready', () => {
        console.log('[payment] auth-profile-ready fired, refreshing page');
        initPaymentPage();
        renderPaymentList();
        renderPaymentCharts();
    });
    // 如果 auth 已在 DOMContentLoaded 之前就緒，立即重新渲染
    if (typeof Auth !== 'undefined' && Auth._profileReady) {
        console.log('[payment] auth already resolved, refreshing page');
        initPaymentPage();
        renderPaymentList();
        renderPaymentCharts();
    }
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
    const exportToolbar = document.getElementById('adminExportToolbar');
    const annualSection = document.getElementById('annualStatsSection');

    if (admin) {
        // 管理員：顯示圖表、匯出工具列、年度統計，隱藏使用者面板
        if (panel) panel.style.display = 'none';
        if (chartDash) chartDash.style.display = '';
        if (exportToolbar) exportToolbar.style.display = '';
        if (annualSection) annualSection.style.display = '';
        renderAnnualStats();
    } else {
        // 一般使用者：顯示個人繳費面板，隱藏圖表
        if (panel) panel.style.display = '';
        if (chartDash) chartDash.style.display = 'none';
        if (exportToolbar) exportToolbar.style.display = 'none';
        if (annualSection) annualSection.style.display = 'none';
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

// ===== 主清單年度切換 =====
function changePaymentListYear(delta) {
    paymentListYear += delta;
    updatePaymentListYearLabel();
    renderPaymentList();
    renderPaymentCharts();
    renderAnnualStats();
}

function updatePaymentListYearLabel() {
    const label = document.getElementById('paymentListYearLabel');
    if (label) label.textContent = `${paymentListYear} 年`;
}

// ===== 取得需要繳費的申請 (approved 或 installed 且有費用) =====
function getPayableApplications() {
    const year = paymentListYear;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    let apps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0
    );

    // 顯示計費期間與所選年度有重疊的申請
    apps = apps.filter(a => {
        if (!a.endDate) return true; // 沒有結束日期的保留
        // 計費期間需與所選年度有重疊：startDate <= yearEnd && endDate >= yearStart
        const appStart = a.startDate || '';
        return a.endDate >= yearStart && appStart <= yearEnd;
    });

    // 自動補正：若 paymentStatus 未設定，視為 unpaid
    apps.forEach(a => {
        if (!a.paymentStatus) a.paymentStatus = 'unpaid';
    });

    // 一般使用者：顯示自己的 + 同單位的
    if (!isAdminUser()) {
        const currentUser = getCurrentPaymentUser();
        if (currentUser) {
            const currentUnit = currentUser.unit || '';
            apps = apps.filter(a => {
                const isMine = a.submittedBy === currentUser.uid ||
                    a.submittedBy === currentUser.username ||
                    (!a.submittedBy && a.applicantName === currentUser.displayName);
                const isSameUnit = currentUnit && a.applicantUnit === currentUnit;
                return isMine || isSameUnit;
            });
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
                        <strong>#${escapeHTML(app.id)}</strong> ${escapeHTML(app.deviceName)} (${escapeHTML(app.uSize)}U)
                    </div>
                    <div class="preview-item-meta">
                        ${escapeHTML(cabinetLabel)} ｜ ${escapeHTML(effectiveStart)} ~ ${escapeHTML(app.endDate)}
                        ${app.paidUpTo ? `<span class="badge-inline badge-partial">已繳到 ${escapeHTML(app.paidUpTo)}</span>` : ''}
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
                <span class="detail-label">#${escapeHTML(app.id)} ${escapeHTML(app.deviceName)}</span>
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
        // 已繳費或部分繳費（有 paidAmount）→ 顯示繳費單按鈕
        if (app.paymentStatus === 'paid' || (app.paymentStatus === 'partial' && app.paidAmount > 0)) {
            actionsHTML += `
                <button class="btn btn-primary btn-xs" onclick="openReceiptForApp(${app.id})" title="繳費單">
                    <i class="fas fa-file-invoice-dollar"></i>
                </button>
            `;
        }
        // 待繳費也可以產生繳費通知單
        if (app.paymentStatus === 'unpaid' || app.paymentStatus === 'overdue') {
            actionsHTML += `
                <button class="btn btn-warning btn-xs" onclick="openPaymentNotice(${app.id})" title="繳費通知單">
                    <i class="fas fa-file-invoice"></i>
                </button>
            `;
        }
        actionsHTML += `
            <button class="btn btn-secondary btn-xs" onclick="openPayDetail(${app.id})">
                <i class="fas fa-eye"></i>
            </button>
        `;
        // 管理員可刪除繳費紀錄（已審核過的申請）
        if (isAdminUser()) {
            actionsHTML += `
                <button class="btn btn-danger btn-xs" onclick="deletePaymentRecord(${app.id})" title="刪除此筆紀錄">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }

        tr.innerHTML = `
            <td><strong>#${escapeHTML(app.id)}</strong></td>
            <td>${escapeHTML(app.applicantName)}</td>
            <td>${escapeHTML(app.applicantUnit)}</td>
            <td>${escapeHTML(app.deviceName)} (${escapeHTML(app.uSize)}U)</td>
            <td>${escapeHTML(cabinetLabel)}</td>
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
        renderAnnualStats();
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
            <div class="detail-row"><span class="detail-label">申請編號</span><span class="detail-value">#${escapeHTML(app.id)}</span></div>
            <div class="detail-row"><span class="detail-label">設備</span><span class="detail-value">${escapeHTML(app.deviceName)}</span></div>
            <div class="detail-row"><span class="detail-label">申請人</span><span class="detail-value">${escapeHTML(app.applicantName)} / ${escapeHTML(app.applicantUnit)}</span></div>
            <div class="detail-row"><span class="detail-label">使用期間</span><span class="detail-value">${escapeHTML(app.startDate)} ~ ${escapeHTML(endDateLabel)}</span></div>
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

    // 產生繳費單
    showReceipt([{
        app,
        fee: remaining,
        payUpToMonth: null
    }], method, ref);
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

    // 產生繳費單
    const receiptItems = items.map(item => {
        const app = applications.find(a => a.id === item.appId);
        return { app, fee: item.fee, payUpToMonth: item.payUpToMonth };
    }).filter(i => i.app);
    showReceipt(receiptItems, method, ref);
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
            <div class="detail-row"><span class="detail-label">申請編號</span><span class="detail-value">#${escapeHTML(app.id)}</span></div>
            <div class="detail-row"><span class="detail-label">申請人</span><span class="detail-value">${escapeHTML(app.applicantName)}</span></div>
            <div class="detail-row"><span class="detail-label">單位</span><span class="detail-value">${escapeHTML(app.applicantUnit)}</span></div>
            <div class="detail-row"><span class="detail-label">信箱</span><span class="detail-value">${escapeHTML(app.applicantEmail)}</span></div>
            <div class="detail-row"><span class="detail-label">設備</span><span class="detail-value">${escapeHTML(app.deviceName)} (${escapeHTML(app.uSize)}U)</span></div>
            <div class="detail-row"><span class="detail-label">機櫃位置</span><span class="detail-value">${app.assignedCabinet !== null ? '機櫃 ' + CABINET_NAMES[app.assignedCabinet] + ' U' + escapeHTML(app.assignedStartU) + '-U' + (app.assignedStartU + app.uSize - 1) : '-'}</span></div>
            <div class="detail-row"><span class="detail-label">上架日期</span><span class="detail-value">${escapeHTML(app.startDate)}</span></div>
            <div class="detail-row"><span class="detail-label">使用到期日</span><span class="detail-value">${escapeHTML(endDateDisplay)}</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-credit-card"></i> 繳費資訊</div>
            ${paymentInfoHTML}
        </div>
    `;

    // 更新 footer 按鈕
    const footer = document.getElementById('payDetailFooter');
    if (footer) {
        let footerHTML = '';
        if (app.paymentStatus === 'paid' || (app.paymentStatus === 'partial' && app.paidAmount > 0)) {
            footerHTML += `<button class="btn btn-primary" onclick="closePayDetailModalDirect(); openReceiptForApp(${app.id})">
                <i class="fas fa-file-invoice-dollar"></i> 列印繳費單
            </button>`;
        }
        if (app.paymentStatus === 'unpaid' || app.paymentStatus === 'overdue') {
            footerHTML += `<button class="btn btn-warning" onclick="closePayDetailModalDirect(); openPaymentNotice(${app.id})">
                <i class="fas fa-file-invoice"></i> 繳費通知單
            </button>`;
        }
        // 管理員可刪除
        if (isAdminUser()) {
            footerHTML += `<button class="btn btn-danger" onclick="closePayDetailModalDirect(); deletePaymentRecord(${app.id})">
                <i class="fas fa-trash"></i> 刪除紀錄
            </button>`;
        }
        footerHTML += `<button class="btn btn-secondary" onclick="closePayDetailModalDirect()">關閉</button>`;
        footer.innerHTML = footerHTML;
    }

    document.getElementById('payDetailModal').classList.add('active');
}

function closePayDetailModal(e) {
    if (e.target === document.getElementById('payDetailModal')) closePayDetailModalDirect();
}
function closePayDetailModalDirect() {
    document.getElementById('payDetailModal').classList.remove('active');
}

// ===== 管理員刪除繳費紀錄 =====
async function deletePaymentRecord(appId) {
    if (!isAdminUser()) {
        alert('只有管理員可以刪除繳費紀錄');
        return;
    }

    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const typeLabel = app.type === 'renewal' ? '繳費申請' : '設備申請';
    const statusLabel = app.paymentStatus === 'paid' ? '已繳費'
        : app.paymentStatus === 'partial' ? '部分繳費'
        : app.paymentStatus === 'overdue' ? '逾期' : '待繳費';

    if (!confirm(
        `確定要刪除此筆繳費紀錄嗎？\n\n` +
        `${typeLabel} #${appId}\n` +
        `設備：${app.deviceName}\n` +
        `申請人：${app.applicantName}\n` +
        `費用：NT$ ${app.fee.toLocaleString()}\n` +
        `狀態：${statusLabel}\n\n` +
        `此操作會刪除整筆申請資料，無法復原。`
    )) return;

    const idx = applications.findIndex(a => a.id === appId);
    if (idx !== -1) {
        applications.splice(idx, 1);
        await saveApplications();
        renderPaymentList();
        alert(`✅ ${typeLabel} #${appId} 的繳費紀錄已刪除`);
    }
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

    const year = paymentListYear;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // 圖表需要看所有人的資料，並依年度篩選
    const allApps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0 &&
        a.startDate && a.endDate &&
        a.startDate <= yearEnd && a.endDate >= yearStart
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

    // ===== 統計數據（使用年度按比例計算的費用）=====
    let totalFee = 0, paidFee = 0, unpaidFee = 0, overdueFee = 0, partialUnpaidFee = 0;
    allApps.forEach(a => {
        const annualFee = calculateAnnualFeeForApp(a, year);
        const annualPaid = calculateAnnualPaidForApp(a, year);
        totalFee += annualFee;

        if (a.paymentStatus === 'paid') {
            paidFee += annualFee;
        } else if (a.paymentStatus === 'partial') {
            paidFee += annualPaid;
            partialUnpaidFee += (annualFee - annualPaid);
        } else if (a.paymentStatus === 'overdue') {
            overdueFee += annualFee;
        } else {
            // unpaid
            unpaidFee += annualFee;
        }
    });
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

    // ===== 各單位費用長條圖（使用年度按比例計算）=====
    const unitMap = {};
    allApps.forEach(a => {
        const unit = a.applicantUnit || '未知';
        if (!unitMap[unit]) unitMap[unit] = { paid: 0, unpaid: 0 };
        const annualFee = calculateAnnualFeeForApp(a, year);
        const annualPaid = calculateAnnualPaidForApp(a, year);
        if (a.paymentStatus === 'paid') {
            unitMap[unit].paid += annualFee;
        } else if (a.paymentStatus === 'partial') {
            unitMap[unit].paid += annualPaid;
            unitMap[unit].unpaid += (annualFee - annualPaid);
        } else {
            unitMap[unit].unpaid += annualFee;
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

// ===== 繳費單 Receipt =====

// ===== 年度繳費統計 =====
let annualMonthlyChartInstance = null;
let annualUnitChartInstance = null;

/**
 * 計算某筆申請在指定年度內的應繳費用
 * 學校用「曆年」來計算經費，即 1/1 ~ 12/31
 */
function calculateAnnualFeeForApp(app, year) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // 申請的計費期間
    const appStart = app.startDate;
    const appEnd = app.endDate;
    if (!appStart || !appEnd) return 0;

    // 計費期間與年度的交集
    const effectiveStart = appStart > yearStart ? appStart : yearStart;
    const effectiveEnd = appEnd < yearEnd ? appEnd : yearEnd;

    if (effectiveStart > effectiveEnd) return 0;

    const result = calculateProRatedFee(effectiveStart, effectiveEnd, app.uSize);
    return result.fee;
}

/**
 * 計算某筆申請在指定年度內已繳的金額
 */
function calculateAnnualPaidForApp(app, year) {
    const annualFee = calculateAnnualFeeForApp(app, year);
    if (annualFee <= 0) return 0;

    if (app.paymentStatus === 'paid') {
        // 全額繳清 → 該年度內的費用都算已繳
        return annualFee;
    }

    if (app.paymentStatus === 'partial' && app.paidUpTo) {
        // 部分繳費：計算已繳到日期在該年度內涵蓋多少
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        const appStart = app.startDate;
        const paidUpTo = app.paidUpTo;

        const effectiveStart = appStart > yearStart ? appStart : yearStart;
        const effectivePaidEnd = paidUpTo < yearEnd ? paidUpTo : yearEnd;

        if (effectiveStart > effectivePaidEnd) return 0;

        const result = calculateProRatedFee(effectiveStart, effectivePaidEnd, app.uSize);
        return Math.min(result.fee, annualFee);
    }

    return 0;
}

/**
 * 渲染年度統計
 */
async function renderAnnualStats() {
    if (!isAdminUser()) return;

    const year = paymentListYear;

    // 取得所有有費用的申請
    const allApps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0
    );

    // 年度內有費用的申請（計費期間與該年度重疊即顯示）
    const yearApps = allApps.filter(a => calculateAnnualFeeForApp(a, year) > 0);

    // 總統計
    let annualTotal = 0;
    let annualPaid = 0;
    yearApps.forEach(a => {
        annualTotal += calculateAnnualFeeForApp(a, year);
        annualPaid += calculateAnnualPaidForApp(a, year);
    });
    const annualOutstanding = annualTotal - annualPaid;
    const annualRateVal = annualTotal > 0 ? Math.round((annualPaid / annualTotal) * 100) : 0;

    const el = (id) => document.getElementById(id);
    if (el('annualTotalFee')) el('annualTotalFee').textContent = `NT$ ${annualTotal.toLocaleString()}`;
    if (el('annualCollected')) el('annualCollected').textContent = `NT$ ${annualPaid.toLocaleString()}`;
    if (el('annualOutstanding')) el('annualOutstanding').textContent = `NT$ ${annualOutstanding.toLocaleString()}`;
    if (el('annualRate')) el('annualRate').textContent = `${annualRateVal}%`;

    // ===== 月度趨勢圖 =====
    const monthLabels = [];
    const monthFeeData = [];
    const monthPaidData = [];

    for (let m = 1; m <= 12; m++) {
        monthLabels.push(`${m}月`);
        const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
        const lastDay = new Date(year, m, 0).getDate();
        const mEnd = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        let mFee = 0;
        let mPaid = 0;
        yearApps.forEach(a => {
            const appStart = a.startDate;
            const appEnd = a.endDate;
            if (!appStart || !appEnd) return;

            const effStart = appStart > mStart ? appStart : mStart;
            const effEnd = appEnd < mEnd ? appEnd : mEnd;
            if (effStart > effEnd) return;

            const fee = calculateProRatedFee(effStart, effEnd, a.uSize).fee;
            mFee += fee;

            // 已繳金額
            if (a.paymentStatus === 'paid') {
                mPaid += fee;
            } else if (a.paymentStatus === 'partial' && a.paidUpTo) {
                const effPaidEnd = a.paidUpTo < mEnd ? a.paidUpTo : mEnd;
                if (effStart <= effPaidEnd) {
                    mPaid += calculateProRatedFee(effStart, effPaidEnd, a.uSize).fee;
                }
            }
        });

        monthFeeData.push(mFee);
        monthPaidData.push(Math.min(mPaid, mFee));
    }

    const monthCtx = document.getElementById('annualMonthlyChart');
    if (monthCtx) {
        if (annualMonthlyChartInstance) annualMonthlyChartInstance.destroy();
        annualMonthlyChartInstance = new Chart(monthCtx, {
            type: 'bar',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: '應收費用',
                        data: monthFeeData,
                        backgroundColor: 'rgba(59, 130, 246, 0.6)',
                        borderColor: '#2563eb',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: '已收費用',
                        data: monthPaidData,
                        backgroundColor: 'rgba(34, 197, 94, 0.6)',
                        borderColor: '#16a34a',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: val => 'NT$ ' + val.toLocaleString(),
                            font: { size: 11 }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        ticks: { font: { size: 12 } },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { padding: 16, usePointStyle: true, pointStyleWidth: 12, font: { size: 12 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.dataset.label}: NT$ ${ctx.parsed.y.toLocaleString()}`
                        }
                    }
                }
            }
        });
    }

    // ===== 各單位年度費用圓餅圖 =====
    const unitMap = {};
    yearApps.forEach(a => {
        const unit = a.applicantUnit || '未知';
        if (!unitMap[unit]) unitMap[unit] = { fee: 0, paid: 0 };
        unitMap[unit].fee += calculateAnnualFeeForApp(a, year);
        unitMap[unit].paid += calculateAnnualPaidForApp(a, year);
    });

    const unitLabels = Object.keys(unitMap).sort((a, b) => unitMap[b].fee - unitMap[a].fee);
    const unitFees = unitLabels.map(u => unitMap[u].fee);
    const bgColors = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
        '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
        '#b45309', '#6d28d9', '#047857', '#0e7490'
    ];

    const unitCtx = document.getElementById('annualUnitChart');
    if (unitCtx) {
        if (annualUnitChartInstance) annualUnitChartInstance.destroy();
        annualUnitChartInstance = new Chart(unitCtx, {
            type: 'doughnut',
            data: {
                labels: unitLabels.map((u, i) => `${u} (NT$ ${unitFees[i].toLocaleString()})`),
                datasets: [{
                    data: unitFees,
                    backgroundColor: bgColors.slice(0, unitLabels.length),
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '50%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 12, usePointStyle: true, pointStyleWidth: 10, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const unit = unitLabels[ctx.dataIndex];
                                const paid = unitMap[unit].paid;
                                return ` 應收: NT$ ${ctx.parsed.toLocaleString()} / 已收: NT$ ${paid.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ===== 年度明細表 =====
    const tbody = document.getElementById('annualDetailBody');
    const tfoot = document.getElementById('annualDetailFoot');
    if (!tbody) return;

    tbody.innerHTML = '';
    let grandTotal = 0;
    let grandPaid = 0;

    yearApps.sort((a, b) => {
        const unitCmp = (a.applicantUnit || '').localeCompare(b.applicantUnit || '');
        if (unitCmp !== 0) return unitCmp;
        return a.id - b.id;
    });

    yearApps.forEach(a => {
        const aFee = calculateAnnualFeeForApp(a, year);
        const aPaid = calculateAnnualPaidForApp(a, year);
        grandTotal += aFee;
        grandPaid += aPaid;

        const cabinetLabel = a.assignedCabinet !== null
            ? `${CABINET_NAMES[a.assignedCabinet]} / U${a.assignedStartU}-U${a.assignedStartU + a.uSize - 1}`
            : '-';

        const statusLabel = aPaid >= aFee ? '已繳清'
            : aPaid > 0 ? '部分繳費'
            : '未繳費';
        const statusClass = aPaid >= aFee ? 'status-paid'
            : aPaid > 0 ? 'status-partial'
            : 'status-unpaid';

        const appStart = a.startDate > `${year}-01-01` ? a.startDate : `${year}-01-01`;
        const appEnd = a.endDate < `${year}-12-31` ? a.endDate : `${year}-12-31`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>#${escapeHTML(a.id)}</strong></td>
            <td>${escapeHTML(a.applicantName)}</td>
            <td>${escapeHTML(a.applicantUnit)}</td>
            <td>${escapeHTML(a.deviceName)} (${escapeHTML(a.uSize)}U)</td>
            <td>${escapeHTML(cabinetLabel)}</td>
            <td>${appStart} ~ ${appEnd}</td>
            <td><strong>NT$ ${aFee.toLocaleString()}</strong></td>
            <td>NT$ ${aPaid.toLocaleString()}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        `;
        tbody.appendChild(tr);
    });

    if (tfoot) {
        tfoot.innerHTML = `
            <tr style="font-weight:700;background:#f1f5f9;">
                <td colspan="6" style="text-align:right;">${year} 年度合計</td>
                <td>NT$ ${grandTotal.toLocaleString()}</td>
                <td>NT$ ${grandPaid.toLocaleString()}</td>
                <td><span class="status-badge ${grandPaid >= grandTotal ? 'status-paid' : 'status-partial'}">${grandTotal > 0 ? Math.round(grandPaid / grandTotal * 100) : 0}%</span></td>
            </tr>
        `;
    }
}

// ===== 匯出繳費紀錄 CSV =====
function exportPaymentCSV() {
    const allApps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0
    );

    if (allApps.length === 0) {
        alert('沒有繳費紀錄可匯出');
        return;
    }

    const methodLabels = {
        transfer: '銀行轉帳',
        cash: '現金繳費',
        check: '支票',
        budget: '校內經費核銷'
    };

    const headers = [
        '申請編號', '申請人', '所屬單位', '電子信箱', '設備名稱', 'U數',
        '機櫃', '起始 U', '使用開始日', '使用到期日',
        '總費用(NTD)', '已繳金額(NTD)', '剩餘未繳(NTD)',
        '繳費狀態', '繳費日期', '繳費方式', '繳費憑證',
        '入帳確認日期', '入帳確認人'
    ];

    const rows = allApps.map(a => {
        const statusLabel = a.paymentStatus === 'paid' ? '已繳費'
            : a.paymentStatus === 'partial' ? '部分繳費'
            : a.paymentStatus === 'overdue' ? '逾期'
            : '待繳費';
        const cabinet = a.assignedCabinet !== null ? CABINET_NAMES[a.assignedCabinet] : '-';
        const startU = a.assignedStartU || '-';
        return [
            a.id,
            a.applicantName,
            a.applicantUnit,
            a.applicantEmail || '',
            a.deviceName,
            a.uSize,
            cabinet,
            startU,
            a.startDate || '',
            a.endDate || '',
            a.fee,
            a.paidAmount || 0,
            getRemainingFee(a),
            statusLabel,
            a.paymentDate ? formatDate(a.paymentDate) : '',
            methodLabels[a.paymentMethod] || a.paymentMethod || '',
            a.paymentRef || '',
            a.adminConfirmedDate ? formatDate(a.adminConfirmedDate) : '',
            a.adminConfirmedBy || ''
        ];
    });

    downloadCSV(headers, rows, `繳費紀錄_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ===== 匯出年度統計報表 CSV =====
function exportAnnualReportCSV() {
    const year = paymentListYear;
    const allApps = applications.filter(a =>
        (a.status === 'approved' || a.status === 'installed') && a.fee > 0
    );
    const yearApps = allApps.filter(a => calculateAnnualFeeForApp(a, year) > 0);

    if (yearApps.length === 0) {
        alert(`${year} 年度沒有繳費紀錄可匯出`);
        return;
    }

    const headers = [
        '申請編號', '申請人', '所屬單位', '設備名稱', 'U數',
        '機櫃位置', '年度使用期間',
        '年度應繳(NTD)', '年度已繳(NTD)', '年度未繳(NTD)', '繳費狀態'
    ];

    let grandTotal = 0;
    let grandPaid = 0;

    const rows = yearApps.sort((a, b) => {
        const cmp = (a.applicantUnit || '').localeCompare(b.applicantUnit || '');
        if (cmp !== 0) return cmp;
        return a.id - b.id;
    }).map(a => {
        const aFee = calculateAnnualFeeForApp(a, year);
        const aPaid = calculateAnnualPaidForApp(a, year);
        const aUnpaid = aFee - aPaid;
        grandTotal += aFee;
        grandPaid += aPaid;

        const cabinetLabel = a.assignedCabinet !== null
            ? `${CABINET_NAMES[a.assignedCabinet]} / U${a.assignedStartU}-U${a.assignedStartU + a.uSize - 1}`
            : '-';
        const appStart = a.startDate > `${year}-01-01` ? a.startDate : `${year}-01-01`;
        const appEnd = a.endDate < `${year}-12-31` ? a.endDate : `${year}-12-31`;
        const statusLabel = aPaid >= aFee ? '已繳清' : aPaid > 0 ? '部分繳費' : '未繳費';

        return [
            a.id,
            a.applicantName,
            a.applicantUnit,
            a.deviceName,
            a.uSize,
            cabinetLabel,
            `${appStart} ~ ${appEnd}`,
            aFee,
            aPaid,
            aUnpaid,
            statusLabel
        ];
    });

    // 加上單位小計與總計
    const unitGroups = {};
    yearApps.forEach(a => {
        const unit = a.applicantUnit || '未知';
        if (!unitGroups[unit]) unitGroups[unit] = { fee: 0, paid: 0 };
        unitGroups[unit].fee += calculateAnnualFeeForApp(a, year);
        unitGroups[unit].paid += calculateAnnualPaidForApp(a, year);
    });

    // 空行
    rows.push([]);
    rows.push([`=== ${year} 年度單位小計 ===`]);
    rows.push(['單位名稱', '', '', '', '', '', '', '應收(NTD)', '已收(NTD)', '未收(NTD)', '收繳率']);
    Object.keys(unitGroups).sort().forEach(unit => {
        const g = unitGroups[unit];
        const rate = g.fee > 0 ? Math.round(g.paid / g.fee * 100) + '%' : '0%';
        rows.push([unit, '', '', '', '', '', '', g.fee, g.paid, g.fee - g.paid, rate]);
    });

    rows.push([]);
    rows.push([`=== ${year} 年度總計 ===`, '', '', '', '', '', '', grandTotal, grandPaid, grandTotal - grandPaid,
        grandTotal > 0 ? Math.round(grandPaid / grandTotal * 100) + '%' : '0%']);

    downloadCSV(headers, rows, `${year}年度繳費統計報表.csv`);
}

// ===== 通用 CSV 下載 =====
function downloadCSV(headers, rows, filename) {
    // BOM for Excel UTF-8 compatibility
    const BOM = '\uFEFF';
    const csvContent = BOM + [
        headers.join(','),
        ...rows.map(row => row.map(cell => {
            const str = String(cell == null ? '' : cell);
            // 若含逗號、換行、雙引號則用雙引號包裹
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

/**
 * 產生繳費單編號
 */
function generateReceiptNo() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `RCP-${y}${m}${d}-${h}${min}${s}-${rand}`;
}

/**
 * 顯示繳費單
 * @param {Array<{app: Object, fee: number, payUpToMonth: string|null}>} items - 繳費項目
 * @param {string} method - 繳費方式
 * @param {string} ref - 憑證/備註
 */
function showReceipt(items, method, ref) {
    const methodLabels = {
        transfer: '銀行轉帳',
        cash: '現金繳費',
        check: '支票',
        budget: '校內經費核銷'
    };

    const receiptNo = generateReceiptNo();
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const totalFee = items.reduce((sum, i) => sum + i.fee, 0);

    // 取申請人資訊（使用第一筆）
    const firstApp = items[0].app;
    const payerName = escapeHTML(firstApp.applicantName || '-');
    const payerUnit = escapeHTML(firstApp.applicantUnit || '-');
    const payerEmail = escapeHTML(firstApp.applicantEmail || '-');

    // 組裝繳費明細列
    let itemRows = '';
    items.forEach((item, idx) => {
        const app = item.app;
        const cabinetLabel = app.assignedCabinet !== null
            ? `${CABINET_NAMES[app.assignedCabinet]} / U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
            : '-';
        const periodStart = item.payUpToMonth ? (app.paidUpTo || app.startDate) : app.startDate;
        let periodEnd;
        if (item.payUpToMonth) {
            const parts = item.payUpToMonth.split('-');
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const lastDay = new Date(year, month, 0).getDate();
            periodEnd = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
        } else {
            periodEnd = app.endDate || '-';
        }

        itemRows += `
            <tr>
                <td>${idx + 1}</td>
                <td>#${escapeHTML(app.id)}</td>
                <td>${escapeHTML(app.deviceName)} (${escapeHTML(app.uSize)}U)</td>
                <td>${escapeHTML(cabinetLabel)}</td>
                <td>${escapeHTML(periodStart)} ~ ${escapeHTML(periodEnd)}</td>
                <td class="text-right">NT$ ${item.fee.toLocaleString()}</td>
            </tr>
        `;
    });

    const html = `
        <div class="receipt-wrap" id="receiptPrintArea">
            <div class="receipt-header">
                <div class="receipt-logo">
                    <i class="fas fa-server"></i> 國立陽明交通大學 生醫資訊研究所
                </div>
                <div class="receipt-subtitle">機房設備使用費繳費單</div>
                <div class="receipt-meta">
                    <span>繳費單編號：${receiptNo}</span>
                    <span>列印日期：${dateStr} ${timeStr}</span>
                </div>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-user"></i> 繳費人資訊</div>
                <div class="receipt-info-grid">
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">姓　　名</span>
                        <span class="receipt-info-value">${payerName}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">所屬單位</span>
                        <span class="receipt-info-value">${payerUnit}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">電子信箱</span>
                        <span class="receipt-info-value">${payerEmail}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">繳費日期</span>
                        <span class="receipt-info-value">${dateStr}</span>
                    </div>
                </div>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-list-alt"></i> 繳費明細</div>
                <table class="receipt-table">
                    <thead>
                        <tr>
                            <th style="width:40px">#</th>
                            <th style="width:70px">編號</th>
                            <th>設備名稱</th>
                            <th>機櫃位置</th>
                            <th>計費期間</th>
                            <th style="width:120px" class="text-right">金額</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRows}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" class="text-right">應繳總額</td>
                            <td class="text-right">NT$ ${totalFee.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-credit-card"></i> 繳費資訊</div>
                <div class="receipt-payment-info">
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">繳費方式</span>
                        <span class="receipt-info-value">${methodLabels[method] || method || '-'}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">憑證/備註</span>
                        <span class="receipt-info-value">${escapeHTML(ref) || '-'}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">繳費狀態</span>
                        <span class="receipt-info-value" style="color:#16a34a;font-weight:700;">已繳費（待入帳確認）</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">項目數量</span>
                        <span class="receipt-info-value">${items.length} 筆</span>
                    </div>
                </div>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-calculator"></i> 費率說明</div>
                <div class="receipt-info-row">
                    <span class="receipt-info-label">計費標準</span>
                    <span class="receipt-info-value">每 U 每月 NT$ ${PRICE_PER_U_PER_MONTH} 元，不足一個月按日數比例計算</span>
                </div>
            </div>

            <div class="receipt-footer">
                <div class="receipt-stamp-row">
                    <div class="receipt-stamp-box">
                        <div class="receipt-stamp-line"></div>
                        <div class="receipt-stamp-label">繳費人簽章</div>
                    </div>
                    <div class="receipt-stamp-box">
                        <div class="receipt-stamp-line"></div>
                        <div class="receipt-stamp-label">經辦人簽章</div>
                    </div>
                    <div class="receipt-stamp-box">
                        <div class="receipt-stamp-line"></div>
                        <div class="receipt-stamp-label">主管簽章</div>
                    </div>
                </div>
            </div>

            <div class="receipt-notice">
                <div class="receipt-notice-title"><i class="fas fa-info-circle"></i> 注意事項</div>
                <div>1. 本繳費單僅供繳費證明與內部作業使用，非正式統一發票。</div>
                <div>2. 繳費後請保留此繳費單作為繳費憑證，待管理員確認入帳後完成繳費程序。</div>
                <div>3. 如有疑問，請聯繫 BMI 機房管理委員會。</div>
            </div>
        </div>
    `;

    document.getElementById('receiptContent').innerHTML = html;
    document.getElementById('receiptModal').classList.add('active');
}

/**
 * 關閉繳費單彈窗
 */
function closeReceiptModal(e) {
    if (e.target === document.getElementById('receiptModal')) closeReceiptModalDirect();
}

function closeReceiptModalDirect() {
    document.getElementById('receiptModal').classList.remove('active');
}

/**
 * 列印繳費單
 */
function printReceipt() {
    window.print();
}

/**
 * 下載繳費單為 PDF（透過瀏覽器列印功能另存 PDF）
 * 若要純前端產生 PDF 亦可引入 html2pdf 等套件，這裡先用瀏覽器原生方式
 */
function downloadReceiptPDF() {
    // 提示使用者透過列印對話框中的「另存為 PDF」來下載
    alert('請在列印對話框中選擇「另存為 PDF」或「Save as PDF」作為印表機，即可下載 PDF 檔案。');
    window.print();
}

/**
 * 從繳費紀錄列表中，開啟某筆已繳費申請的繳費單
 * @param {number} appId - 申請 ID
 */
function openReceiptForApp(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const paidAmount = app.paidAmount || app.fee;
    const method = app.paymentMethod || '';
    const ref = app.paymentRef || '';

    showReceipt([{
        app,
        fee: paidAmount,
        payUpToMonth: null
    }], method, ref);
}

/**
 * 產生待繳費通知單（給尚未繳費的項目使用）
 * @param {number} appId - 申請 ID
 */
function openPaymentNotice(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const remaining = getRemainingFee(app);
    const receiptNo = generateReceiptNo();
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

    const cabinetLabel = app.assignedCabinet !== null
        ? `${CABINET_NAMES[app.assignedCabinet]} / U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
        : '-';

    // 繳費期限：核准日後 30 天
    let deadlineStr = '-';
    if (app.reviewDate) {
        const deadline = new Date(app.reviewDate);
        deadline.setDate(deadline.getDate() + 30);
        deadlineStr = deadline.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    const endDateDisplay = app.endDate || (app.duration === 0 ? '長期' : app.duration + ' 個月');

    const html = `
        <div class="receipt-wrap" id="receiptPrintArea">
            <div class="receipt-header">
                <div class="receipt-logo">
                    <i class="fas fa-server"></i> 國立陽明交通大學 生醫資訊研究所
                </div>
                <div class="receipt-subtitle">機房設備使用費繳費通知單</div>
                <div class="receipt-meta">
                    <span>通知單編號：${receiptNo}</span>
                    <span>列印日期：${dateStr} ${timeStr}</span>
                </div>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-user"></i> 繳費人資訊</div>
                <div class="receipt-info-grid">
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">姓　　名</span>
                        <span class="receipt-info-value">${escapeHTML(app.applicantName || '-')}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">所屬單位</span>
                        <span class="receipt-info-value">${escapeHTML(app.applicantUnit || '-')}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">電子信箱</span>
                        <span class="receipt-info-value">${escapeHTML(app.applicantEmail || '-')}</span>
                    </div>
                    <div class="receipt-info-row">
                        <span class="receipt-info-label">繳費期限</span>
                        <span class="receipt-info-value" style="color:#dc2626;font-weight:700;">${deadlineStr}</span>
                    </div>
                </div>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-list-alt"></i> 費用明細</div>
                <table class="receipt-table">
                    <thead>
                        <tr>
                            <th style="width:70px">編號</th>
                            <th>設備名稱</th>
                            <th>機櫃位置</th>
                            <th>計費期間</th>
                            <th style="width:120px" class="text-right">金額</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>#${escapeHTML(app.id)}</td>
                            <td>${escapeHTML(app.deviceName)} (${escapeHTML(app.uSize)}U)</td>
                            <td>${escapeHTML(cabinetLabel)}</td>
                            <td>${escapeHTML(app.startDate)} ~ ${escapeHTML(endDateDisplay)}</td>
                            <td class="text-right">NT$ ${remaining.toLocaleString()}</td>
                        </tr>
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right">應繳總額</td>
                            <td class="text-right">NT$ ${remaining.toLocaleString()}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-calculator"></i> 費率說明</div>
                <div class="receipt-info-row">
                    <span class="receipt-info-label">計費標準</span>
                    <span class="receipt-info-value">每 U 每月 NT$ ${PRICE_PER_U_PER_MONTH} 元，不足一個月按日數比例計算</span>
                </div>
            </div>

            <div class="receipt-section">
                <div class="receipt-section-title"><i class="fas fa-university"></i> 繳費方式</div>
                <div style="font-size:0.9rem;line-height:1.8;padding:8px 0;">
                    <div><strong>1. 銀行轉帳</strong>：請洽機房管理委員會取得匯款帳號</div>
                    <div><strong>2. 現金繳費</strong>：請至 BMI 所辦繳交</div>
                    <div><strong>3. 校內經費核銷</strong>：請提供計畫編號，透過校內系統核銷</div>
                </div>
            </div>

            <div class="receipt-footer">
                <div class="receipt-stamp-row">
                    <div class="receipt-stamp-box">
                        <div class="receipt-stamp-line"></div>
                        <div class="receipt-stamp-label">繳費人簽章</div>
                    </div>
                    <div class="receipt-stamp-box">
                        <div class="receipt-stamp-line"></div>
                        <div class="receipt-stamp-label">經辦人簽章</div>
                    </div>
                    <div class="receipt-stamp-box">
                        <div class="receipt-stamp-line"></div>
                        <div class="receipt-stamp-label">主管簽章</div>
                    </div>
                </div>
            </div>

            <div class="receipt-notice">
                <div class="receipt-notice-title"><i class="fas fa-exclamation-triangle"></i> 注意事項</div>
                <div>1. 請於繳費期限內完成繳費，逾期將影響設備使用權益。</div>
                <div>2. 繳費完成後請至繳費紀錄頁面回報繳費資訊，以利管理員確認入帳。</div>
                <div>3. 如有疑問，請聯繫 BMI 機房管理委員會。</div>
            </div>
        </div>
    `;

    document.getElementById('receiptContent').innerHTML = html;
    document.getElementById('receiptModal').classList.add('active');
}

