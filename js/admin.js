/**
 * 管理員審核頁面邏輯
 */

let applications = [];
let devices = [];
let equipFilter = 'all';
let renewFilter = 'all';
let currentReviewId = null;

// ===== 展開/收合區塊 =====
function toggleSection(bodyId) {
    const body = document.getElementById(bodyId);
    const icon = document.getElementById(bodyId + 'Icon');
    if (!body) return;
    body.classList.toggle('collapsed');
    if (icon) icon.classList.toggle('collapsed');
}

document.addEventListener('DOMContentLoaded', async () => {
    initAdminPage();      // 先依角色調整 UI，避免閃爍
    await loadData();
    renderAdminList();
});

// ===== 頁面初始化：依角色調整 UI =====
function initAdminPage() {
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    const isCommittee = typeof Auth !== 'undefined' && Auth.isCommittee();
    const isReviewer = isAdmin || isCommittee;
    // 標題和導覽列已由 inline script + CSS 處理，不需再手動切換
    // 非審核者隱藏統計徽章中的審核操作提示
    if (!isReviewer) {
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

function isCurrentUserCommittee() {
    return typeof Auth !== 'undefined' && Auth.isCommittee();
}

function isCurrentUserReviewer() {
    return typeof Auth !== 'undefined' && Auth.isReviewer();
}

// ===== 資料管理 (Firestore) =====
async function loadData() {
    applications = await DB.getApplications();
    devices = await DB.getDevices() || [];
    // 自動修復被舊程式碼錯誤更新的資料
    if (repairCorruptedApplications(applications)) {
        await saveApplications();
    }
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
function setAdminFilter(section, filter, btn) {
    if (section === 'equip') {
        equipFilter = filter;
        document.querySelectorAll('.tab-btn[data-section="equip"]').forEach(b => b.classList.remove('active'));
    } else {
        renewFilter = filter;
        document.querySelectorAll('.tab-btn[data-section="renew"]').forEach(b => b.classList.remove('active'));
    }
    btn.classList.add('active');
    renderAdminList();
}

// ===== 渲染列表 =====
async function renderAdminList() {
    await loadData(); // 重新載入確保最新
    const search = document.getElementById('adminSearch').value.toLowerCase();
    const userIsAdmin = isCurrentUserAdmin();
    const userIsReviewer = isCurrentUserReviewer();

    let allApps = [...applications].reverse();

    // 一般使用者只能看到自己的申請（管理員和機房主委可看全部）
    if (!userIsReviewer) {
        const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
        if (currentUser) {
            allApps = allApps.filter(a =>
                a.submittedBy === currentUser.uid ||
                a.submittedBy === currentUser.username ||
                (!a.submittedBy && a.applicantName === currentUser.displayName)
            );
        }
    }

    // 搜尋
    if (search) {
        allApps = allApps.filter(a =>
            a.applicantName.toLowerCase().includes(search) ||
            a.applicantUnit.toLowerCase().includes(search) ||
            a.deviceName.toLowerCase().includes(search) ||
            String(a.id).includes(search)
        );
    }

    // 分離設備申請與繳費申請
    const equipApps = allApps.filter(a => a.type !== 'renewal');
    const renewApps = allApps.filter(a => a.type === 'renewal');

    // 更新計數
    updateCounts(equipApps, renewApps);

    // 渲染設備申請
    const equipFiltered = equipFilter !== 'all' ? equipApps.filter(a => a.status === equipFilter) : equipApps;
    renderAppListInto('equipList', equipFiltered, '設備申請', search);

    // 渲染繳費申請
    const renewFiltered = renewFilter !== 'all' ? renewApps.filter(a => a.status === renewFilter) : renewApps;
    renderAppListInto('renewList', renewFiltered, '繳費申請', search);
}

function renderAppListInto(listId, filtered, sectionLabel, search) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>${search ? '找不到符合的紀錄' : '此分類下尚無' + sectionLabel + '紀錄'}</p>
            </div>`;
        return;
    }

    const userIsAdmin = isCurrentUserAdmin();
    const userIsCommittee = isCurrentUserCommittee();
    const userIsReviewer = userIsAdmin || userIsCommittee;

    filtered.forEach(app => {
        const card = document.createElement('div');
        card.className = 'admin-card';

        const statusInfo = getStatusInfo(app.status);
        const isRenewal = app.type === 'renewal';
        const cabinetLabel = app.assignedCabinet !== null
            ? `機櫃 ${CABINET_NAMES[app.assignedCabinet]} U${app.assignedStartU}-U${app.assignedStartU + app.uSize - 1}`
            : (app.preferCabinet !== '' ? `希望: 機櫃 ${CABINET_NAMES[app.preferCabinet]}` : '未指定');

        // 雙重審核狀態（僅設備申請需要雙重審核，繳費申請僅管理員審核）
        const needsDualApproval = !isRenewal;
        const approvalHTML = needsDualApproval ? buildApprovalStatusHTML(app) : '';

        let actionsHTML = '';
        if (app.status === 'pending') {
            if (isRenewal) {
                // 繳費申請：僅管理員審核
                if (userIsAdmin) {
                    actionsHTML += `
                        <button class="btn btn-success btn-xs" onclick="approveRenewal(${app.id})">
                            <i class="fas fa-check"></i> 核准
                        </button>
                        <button class="btn btn-danger btn-xs" onclick="rejectApplication(${app.id})">
                            <i class="fas fa-times"></i> 拒絕
                        </button>
                    `;
                }
            } else {
                // 設備申請：雙重審核
                // 管理員操作
                if (userIsAdmin && !app.adminApproval) {
                    actionsHTML += `
                        <button class="btn btn-success btn-xs" onclick="openAssignModal(${app.id})">
                            <i class="fas fa-check"></i> 管理員核准
                        </button>
                    `;
                } else if (userIsAdmin && app.adminApproval && app.adminApproval.approved) {
                    actionsHTML += `
                        <button class="btn btn-outline btn-xs" disabled>
                            <i class="fas fa-check-double"></i> 管理員已核准
                        </button>
                    `;
                }

                // 機房主委操作
                if (userIsCommittee && !app.committeeApproval) {
                    actionsHTML += `
                        <button class="btn btn-success btn-xs" onclick="committeeApprove(${app.id})">
                            <i class="fas fa-check"></i> 主委核准
                        </button>
                    `;
                } else if (userIsCommittee && app.committeeApproval && app.committeeApproval.approved) {
                    actionsHTML += `
                        <button class="btn btn-outline btn-xs" disabled>
                            <i class="fas fa-check-double"></i> 主委已核准
                        </button>
                    `;
                }

                // 拒絕按鈕
                if (userIsAdmin && (!app.adminApproval || !app.adminApproval.approved)) {
                    actionsHTML += `
                        <button class="btn btn-danger btn-xs" onclick="rejectApplication(${app.id})">
                            <i class="fas fa-times"></i> 拒絕
                        </button>
                    `;
                }
                if (userIsCommittee && (!app.committeeApproval || !app.committeeApproval.approved)) {
                    actionsHTML += `
                        <button class="btn btn-danger btn-xs" onclick="rejectApplication(${app.id})">
                            <i class="fas fa-times"></i> 拒絕
                        </button>
                    `;
                }
            }
        } else if (userIsAdmin && app.status === 'approved' && !isRenewal) {
            actionsHTML += `
                <button class="btn btn-primary btn-xs" onclick="installDevice(${app.id})">
                    <i class="fas fa-server"></i> 確認上架
                </button>
            `;
        }

        // 刪除按鈕：pending 狀態 → 擁有者或管理員可刪；非 pending → 僅管理員可刪
        if (app.status === 'pending') {
            const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
            const isOwner = currentUser && (
                app.submittedBy === currentUser.uid ||
                app.submittedBy === currentUser.username ||
                (!app.submittedBy && app.applicantName === currentUser.displayName)
            );
            if (isOwner || userIsAdmin) {
                actionsHTML += `
                    <button class="btn btn-danger btn-xs" onclick="deleteApplication(${app.id})" title="刪除申請">
                        <i class="fas fa-trash"></i> 刪除
                    </button>
                `;
            }
        } else if (userIsAdmin) {
            actionsHTML += `
                <button class="btn btn-danger btn-xs" onclick="deleteApplication(${app.id})" title="刪除申請">
                    <i class="fas fa-trash"></i> 刪除
                </button>
            `;
        }

        actionsHTML += `
            <button class="btn btn-secondary btn-xs" onclick="openReviewModal(${app.id})">
                <i class="fas fa-eye"></i> 詳情
            </button>
        `;

        const typeBadge = isRenewal
            ? `<span style="display:inline-block;background:#dbeafe;color:#2563eb;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-top:3px;"><i class="fas fa-rotate"></i> 繳費延期</span>`
            : '';

        card.innerHTML = `
            <div class="admin-card-main">
                <div class="admin-card-status">
                    <span class="status-badge status-${app.status}">${statusInfo.icon} ${statusInfo.label}</span>
                    <div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">#${app.id}</div>
                    ${typeBadge}
                    ${approvalHTML}
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
                        <label>${isRenewal ? '類型' : '申請日期'}</label>
                        <span>${isRenewal ? '繳費延期 (原#' + app.originalAppId + ')' : formatDate(app.submitDate)}</span>
                    </div>
                    <div class="info-group">
                        <label>${isRenewal ? '延期至' : '上架日期'}</label>
                        <span>${isRenewal ? app.endDate : app.startDate}</span>
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

// ===== 雙重審核狀態顯示（僅設備申請）=====
function buildApprovalStatusHTML(app) {
    if (app.status !== 'pending') return '';
    // 繳費申請不需要雙重審核
    if (app.type === 'renewal') return '';
    let html = '<div class="dual-approval-status">';
    // 管理員審核狀態
    if (app.adminApproval && app.adminApproval.approved) {
        html += `<div class="approval-item approved"><i class="fas fa-check-circle"></i> 管理員已核准</div>`;
    } else {
        html += `<div class="approval-item waiting"><i class="fas fa-clock"></i> 待管理員審核</div>`;
    }
    // 主委審核狀態
    if (app.committeeApproval && app.committeeApproval.approved) {
        html += `<div class="approval-item approved"><i class="fas fa-check-circle"></i> 主委已核准</div>`;
    } else {
        html += `<div class="approval-item waiting"><i class="fas fa-clock"></i> 待主委審核</div>`;
    }
    html += '</div>';
    return html;
}

function updateCounts(equipApps, renewApps) {
    // 設備申請計數
    const equipAll = equipApps.length;
    const equipPending = equipApps.filter(a => a.status === 'pending').length;
    const equipApproved = equipApps.filter(a => a.status === 'approved').length;
    const equipRejected = equipApps.filter(a => a.status === 'rejected').length;
    const equipInstalled = equipApps.filter(a => a.status === 'installed').length;

    document.getElementById('tabEquipAll').textContent = equipAll;
    document.getElementById('tabEquipPending').textContent = equipPending;
    document.getElementById('tabEquipApproved').textContent = equipApproved;
    document.getElementById('tabEquipRejected').textContent = equipRejected;
    document.getElementById('tabEquipInstalled').textContent = equipInstalled;

    // 繳費申請計數
    const renewAll = renewApps.length;
    const renewPending = renewApps.filter(a => a.status === 'pending').length;
    const renewApproved = renewApps.filter(a => a.status === 'approved').length;
    const renewRejected = renewApps.filter(a => a.status === 'rejected').length;

    document.getElementById('tabRenewAll').textContent = renewAll;
    document.getElementById('tabRenewPending').textContent = renewPending;
    document.getElementById('tabRenewApproved').textContent = renewApproved;
    document.getElementById('tabRenewRejected').textContent = renewRejected;

    // Header 徽章總數
    const totalPending = equipPending + renewPending;
    const totalApproved = equipApproved + renewApproved;
    const totalRejected = equipRejected + renewRejected;
    document.getElementById('pendingCount').textContent = `${totalPending} 待審核`;
    document.getElementById('approvedCount').textContent = `${totalApproved} 已通過`;
    document.getElementById('rejectedCount').textContent = `${totalRejected} 已拒絕`;
}

// ===== 審核詳情彈窗 =====
function openReviewModal(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) return;
    currentReviewId = appId;

    const content = document.getElementById('reviewContent');
    const statusInfo = getStatusInfo(app.status);

    const isRenewal = app.type === 'renewal';

    content.innerHTML = `
        <div style="text-align:center;margin-bottom:16px;">
            <span class="status-badge status-${app.status}" style="font-size:0.9rem;padding:6px 16px;">
                ${statusInfo.icon} ${statusInfo.label}
            </span>
            ${isRenewal ? '<div style="margin-top:6px;"><span style="background:#dbeafe;color:#2563eb;font-size:0.8rem;padding:3px 10px;border-radius:6px;"><i class="fas fa-rotate"></i> 繳費延期申請</span></div>' : ''}
            <div style="color:#94a3b8;font-size:0.8rem;margin-top:6px;">申請編號 #${app.id}${isRenewal ? ' (原申請 #' + app.originalAppId + ')' : ''}</div>
        </div>
        ${app.status === 'pending' && !isRenewal ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-user-check"></i> 雙重審核狀態</div>
            <div class="detail-row">
                <span class="detail-label">管理員審核</span>
                <span class="detail-value">${app.adminApproval && app.adminApproval.approved
                    ? '<span class="status-badge status-approved"><i class="fas fa-check-circle"></i> 已核准</span> <small>(' + (app.adminApproval.byName || '') + ' ' + formatDate(app.adminApproval.date) + ')</small>'
                    : '<span class="status-badge status-pending"><i class="fas fa-clock"></i> 待審核</span>'}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">主委審核</span>
                <span class="detail-value">${app.committeeApproval && app.committeeApproval.approved
                    ? '<span class="status-badge status-approved"><i class="fas fa-check-circle"></i> 已核准</span> <small>(' + (app.committeeApproval.byName || '') + ' ' + formatDate(app.committeeApproval.date) + ')</small>'
                    : '<span class="status-badge status-pending"><i class="fas fa-clock"></i> 待審核</span>'}</span>
            </div>
        </div>` : ''}
        ${isRenewal ? `
        <div class="detail-section">
            <div class="detail-section-title"><i class="fas fa-calendar-plus"></i> 延期資訊</div>
            <div class="detail-row"><span class="detail-label">原到期日</span><span class="detail-value">${app.originalEndDate || '-'}</span></div>
            <div class="detail-row"><span class="detail-label">延期起始</span><span class="detail-value">${app.startDate}</span></div>
            <div class="detail-row"><span class="detail-label">新到期日</span><span class="detail-value" style="color:#16a34a;font-weight:700;">${app.endDate}</span></div>
            <div class="detail-row"><span class="detail-label">延期費用</span><span class="detail-value" style="font-weight:700;">NT$ ${(app.fee || 0).toLocaleString()}</span></div>
            <div class="detail-row"><span class="detail-label">繳費狀態</span><span class="detail-value"><span class="status-badge status-${app.paymentStatus}">${app.paymentStatus === 'paid' ? '已繳費' : '待繳費'}</span></span></div>
        </div>` : ''}
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
            ${app.adminApproval ? `<div class="detail-row"><span class="detail-label">管理員審核</span><span class="detail-value">${app.adminApproval.approved ? '✅ 已核准' : '❌ 已拒絕'} <small>(${app.adminApproval.byName || ''} ${formatDate(app.adminApproval.date)})</small></span></div>` : ''}
            ${app.committeeApproval ? `<div class="detail-row"><span class="detail-label">主委審核</span><span class="detail-value">${app.committeeApproval.approved ? '✅ 已核准' : '❌ 已拒絕'} <small>(${app.committeeApproval.byName || ''} ${formatDate(app.committeeApproval.date)})</small></span></div>` : ''}
        </div>` : ''}
    `;

    // 底部按鈕（審核操作僅審核者可見）
    const actions = document.getElementById('reviewActions');
    let btns = '';
    const userIsAdmin = isCurrentUserAdmin();
    const userIsCommittee = isCurrentUserCommittee();

    if (app.status === 'pending') {
        if (isRenewal) {
            // 繳費申請：僅管理員審核
            if (userIsAdmin && !app.adminApproval) {
                btns += `
                    <button class="btn btn-success" onclick="closeReviewModalDirect();approveRenewal(${app.id})">
                        <i class="fas fa-check"></i> 核准延期
                    </button>
                    <button class="btn btn-danger" onclick="closeReviewModalDirect();rejectApplication(${app.id})">
                        <i class="fas fa-times"></i> 拒絕
                    </button>
                `;
            }
        } else {
            // 設備申請：雙重審核
            // 管理員審核按鈕
            if (userIsAdmin && !app.adminApproval) {
                btns += `
                    <button class="btn btn-success" onclick="closeReviewModalDirect();openAssignModal(${app.id})">
                        <i class="fas fa-check"></i> 管理員核准
                    </button>
                    <button class="btn btn-danger" onclick="closeReviewModalDirect();rejectApplication(${app.id})">
                        <i class="fas fa-times"></i> 拒絕
                    </button>
                `;
            } else if (userIsAdmin && app.adminApproval && app.adminApproval.approved) {
                btns += `<button class="btn btn-outline" disabled><i class="fas fa-check-double"></i> 管理員已核准</button>`;
            }
            // 機房主委審核按鈕
            if (userIsCommittee && !app.committeeApproval) {
                btns += `
                    <button class="btn btn-success" onclick="closeReviewModalDirect();committeeApprove(${app.id})">
                        <i class="fas fa-check"></i> 主委核准
                    </button>
                    <button class="btn btn-danger" onclick="closeReviewModalDirect();rejectApplication(${app.id})">
                        <i class="fas fa-times"></i> 拒絕
                    </button>
                `;
            } else if (userIsCommittee && app.committeeApproval && app.committeeApproval.approved) {
                btns += `<button class="btn btn-outline" disabled><i class="fas fa-check-double"></i> 主委已核准</button>`;
            }
        }
    } else if (app.status === 'approved' && !isRenewal) {
        if (userIsAdmin) {
            btns += `
                <button class="btn btn-primary" onclick="closeReviewModalDirect();installDevice(${app.id})">
                    <i class="fas fa-server"></i> 確認上架
                </button>
            `;
        }
    }
    // 刪除按鈕（審核詳情彈窗）
    if (app.status === 'pending') {
        const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
        const isOwner = currentUser && (
            app.submittedBy === currentUser.uid ||
            app.submittedBy === currentUser.username ||
            (!app.submittedBy && app.applicantName === currentUser.displayName)
        );
        if (isOwner || userIsAdmin) {
            btns += `<button class="btn btn-danger" onclick="closeReviewModalDirect();deleteApplication(${app.id})">
                <i class="fas fa-trash"></i> 刪除申請
            </button>`;
        }
    } else if (userIsAdmin) {
        btns += `<button class="btn btn-danger" onclick="closeReviewModalDirect();deleteApplication(${app.id})">
            <i class="fas fa-trash"></i> 刪除申請
        </button>`;
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

// ===== 刪除申請 =====
async function deleteApplication(appId) {
    await loadData();
    const app = applications.find(a => a.id === appId);
    if (!app) { alert('找不到此申請'); return; }

    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser()) || null;
    const isAdmin = isCurrentUserAdmin();

    // 權限檢查
    if (app.status === 'pending') {
        // pending 狀態：擁有者或管理員可刪除
        const isOwner = currentUser && (
            app.submittedBy === currentUser.uid ||
            app.submittedBy === currentUser.username ||
            (!app.submittedBy && app.applicantName === currentUser.displayName)
        );
        if (!isOwner && !isAdmin) {
            alert('只有申請人本人或管理員可以刪除此申請');
            return;
        }
    } else {
        // 非 pending 狀態：僅管理員可刪除
        if (!isAdmin) {
            alert('此申請已經審核，只有管理員可以刪除');
            return;
        }
    }

    const typeLabel = app.type === 'renewal' ? '繳費申請' : '設備申請';
    if (!confirm(`確定要刪除${typeLabel} #${appId}（${app.deviceName}）嗎？\n此操作無法復原。`)) return;

    // 如果是已上架的設備申請，同時從 devices 中移除
    if (app.status === 'installed' && app.assignedCabinet !== null) {
        const deviceIdx = devices.findIndex(d =>
            d.cabinet === app.assignedCabinet &&
            d.startU === app.assignedStartU &&
            d.size === app.uSize
        );
        if (deviceIdx !== -1) {
            devices.splice(deviceIdx, 1);
            await saveDevices();
        }
    }

    const idx = applications.findIndex(a => a.id === appId);
    if (idx !== -1) {
        applications.splice(idx, 1);
        await saveApplications();
        renderAdminList();
        alert(`✅ ${typeLabel} #${appId} 已刪除`);
    }
}

// ===== 核准繳費申請（續約延期）=====
async function approveRenewal(appId) {
    if (!isCurrentUserAdmin()) { alert('僅管理員可執行此操作'); return; }
    await loadData();
    const app = applications.find(a => a.id === appId);
    if (!app || app.type !== 'renewal') return;

    const originalApp = applications.find(a => a.id === app.originalAppId);
    const originalEndDate = app.originalEndDate || (originalApp ? originalApp.endDate : '-');
    const currentUser = Auth.getCurrentUser();

    const notes = prompt(
        `管理員核准繳費申請 #${appId}\n` +
        `設備: ${app.deviceName} (${app.uSize}U)\n` +
        `原到期日: ${originalEndDate}\n` +
        `新到期日: ${app.endDate}\n` +
        `延期費用: NT$ ${(app.fee || 0).toLocaleString()}\n\n` +
        `請輸入管理員備註（可留空）:`
    );
    if (notes === null) return; // 取消

    // 記錄管理員審核
    app.adminApproval = {
        approved: true,
        by: currentUser ? currentUser.uid : '',
        byName: currentUser ? currentUser.displayName : '管理員',
        date: new Date().toISOString(),
        notes: notes || ''
    };
    app.reviewDate = new Date().toISOString();
    app.adminNotes = notes || '';

    // 繳費申請僅需管理員核准，直接通過
    app.status = 'approved';
    if (app.fee > 0) {
        app.paymentStatus = 'unpaid';
    }

    // 不再直接修改原始申請的 endDate 和 fee
    if (originalApp) {
        repairCorruptedApplications(applications);
    }

    await saveApplications();
    renderAdminList();
    alert(`✅ 繳費申請 #${appId} 已核准！\n設備「${app.deviceName}」到期日已延長至 ${app.endDate}\n延期費用: NT$ ${(app.fee || 0).toLocaleString()}`);
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
    const cabinetMaxU = getCabinetU(cabinetIdx);
    for (let u = 1; u <= cabinetMaxU; u++) {
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
    const cabinetMaxU = getCabinetU(cabinet);
    if (startU < 1 || startU > cabinetMaxU) {
        alert(`起始 U 位置必須在 1 ~ ${cabinetMaxU} 之間`);
        return;
    }
    if (startU + app.uSize - 1 > cabinetMaxU) {
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

    // 更新申請（管理員審核）
    const currentUser = Auth.getCurrentUser();
    app.adminApproval = {
        approved: true,
        by: currentUser ? currentUser.uid : '',
        byName: currentUser ? currentUser.displayName : '管理員',
        date: new Date().toISOString(),
        notes: notes
    };
    app.reviewDate = new Date().toISOString();
    app.assignedCabinet = cabinet;
    app.assignedStartU = startU;
    app.assignedIP = ip;
    app.fee = fee;
    app.adminNotes = notes;

    // 檢查是否雙方都已核准
    if (app.committeeApproval && app.committeeApproval.approved) {
        app.status = 'approved';
        if (fee > 0) {
            app.paymentStatus = 'unpaid';
        }
    }

    await saveApplications();
    closeAssignModalDirect();
    renderAdminList();

    if (app.status === 'approved') {
        alert(`✅ 申請 #${appId} 已核准（雙方審核完成）！\n位置：機櫃 ${CABINET_NAMES[cabinet]} U${startU}-U${startU + app.uSize - 1}`);
    } else {
        alert(`✅ 管理員已核准申請 #${appId}！\n位置：機櫃 ${CABINET_NAMES[cabinet]} U${startU}-U${startU + app.uSize - 1}\n等待機房主委審核。`);
    }
}

// ===== 機房主委核准 =====
async function committeeApprove(appId) {
    if (!isCurrentUserCommittee()) { alert('僅機房主委可執行此操作'); return; }
    await loadData();
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const currentUser = Auth.getCurrentUser();
    const isRenewal = app.type === 'renewal';

    const notes = prompt(
        `機房主委核准申請 #${appId}\n` +
        `設備: ${app.deviceName} (${app.uSize}U)\n` +
        `申請人: ${app.applicantName} (${app.applicantUnit})\n` +
        (isRenewal ? `類型: 繳費延期\n新到期日: ${app.endDate}\n` : `上架日期: ${app.startDate}\n`) +
        `\n請輸入主委備註（可留空）:`
    );
    if (notes === null) return; // 取消

    app.committeeApproval = {
        approved: true,
        by: currentUser ? currentUser.uid : '',
        byName: currentUser ? currentUser.displayName : '機房主委',
        date: new Date().toISOString(),
        notes: notes || ''
    };

    // 檢查是否雙方都已核准
    if (app.adminApproval && app.adminApproval.approved) {
        app.status = 'approved';
        app.reviewDate = app.reviewDate || new Date().toISOString();
        if (app.fee > 0) {
            app.paymentStatus = 'unpaid';
        }
    }

    await saveApplications();
    renderAdminList();

    if (app.status === 'approved') {
        alert(`✅ 申請 #${appId} 已核准（雙方審核完成）！`);
    } else {
        alert(`✅ 主委已核准申請 #${appId}！\n等待管理員審核。`);
    }
}

// ===== 拒絕 =====
async function rejectApplication(appId) {
    if (!isCurrentUserReviewer()) { alert('僅審核者可執行此操作'); return; }
    await loadData(); // 確保最新資料
    const app = applications.find(a => a.id === appId);
    if (!app) return;

    const currentUser = Auth.getCurrentUser();
    const roleName = isCurrentUserAdmin() ? '管理員' : '機房主委';

    const reason = prompt(`${roleName}拒絕申請 #${appId}「${app.deviceName}」\n請輸入拒絕原因：`);
    if (reason === null) return; // 取消

    app.status = 'rejected';
    app.reviewDate = new Date().toISOString();
    app.adminNotes = (app.adminNotes ? app.adminNotes + '\n' : '') + `[${roleName}拒絕] ${reason || '未說明原因'}`;

    // 記錄誰拒絕的
    const rejectionRecord = {
        approved: false,
        by: currentUser ? currentUser.uid : '',
        byName: currentUser ? currentUser.displayName : roleName,
        date: new Date().toISOString(),
        notes: reason || '未說明原因'
    };
    if (isCurrentUserAdmin()) {
        app.adminApproval = rejectionRecord;
    } else {
        app.committeeApproval = rejectionRecord;
    }

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
        const section = document.getElementById('systemMgmtSection');
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
        const roleClass = u.role === 'admin' ? 'role-admin' : u.role === 'committee' ? 'role-committee' : 'role-user';
        const roleLabel = u.role === 'admin' ? '管理員' : u.role === 'committee' ? '機房主委' : '使用者';
        const currentUser = Auth.getCurrentUser();
        const isSelf = currentUser && currentUser.uid === u.uid;
        const unitDisplay = u.unit ? `<span class="unit-badge" style="display:inline-block;background:#e0f2fe;color:#0369a1;font-size:0.75rem;padding:2px 8px;border-radius:4px;">${u.unit}</span>` : '<span style="color:#94a3b8;font-size:0.8rem">未指定</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${u.displayName}</strong><br><small style="color:#94a3b8">${u.email || ''}</small></td>
            <td>${unitDisplay}</td>
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

    // 填充所屬單位下拉選單
    const unitSelect = document.getElementById('userFormUnit');
    unitSelect.innerHTML = '<option value="">-- 未指定 --</option>';
    ownerUnits.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.name;
        opt.textContent = u.name;
        unitSelect.appendChild(opt);
    });

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
            document.getElementById('userFormUnit').value = user.unit || '';
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
    const unit = document.getElementById('userFormUnit').value;

    if (!displayName) {
        alert('請填寫顯示名稱');
        return;
    }

    let result;
    if (original) {
        // 編輯模式：只更新 Firestore profile
        result = await Auth.updateUser(original, role, displayName, unit);
    } else {
        // 新增模式：建立 Firebase Auth 帳號 + Firestore profile
        if (!email || !password) {
            alert('請填寫電子郵件和密碼');
            return;
        }
        result = await Auth.addUser(email, password, role, displayName, unit);
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
    setTimeout(() => {
        initUserManagement();
        initUnitManagement();
    }, 100);
});

// ===== 所屬單位管理 =====
let ownerUnits = []; // { name, color }

function initUnitManagement() {
    if (typeof Auth !== 'undefined' && Auth.isAdmin()) {
        // systemMgmtSection 已由 initUserManagement 顯示
        loadAndRenderUnits();
    }
    // 色碼即時顯示
    const colorInput = document.getElementById('unitFormColor');
    if (colorInput) {
        colorInput.addEventListener('input', () => {
            document.getElementById('unitColorHex').textContent = colorInput.value;
        });
    }
}

async function loadAndRenderUnits() {
    const stored = await DB.getOwnerUnits();
    if (stored && stored.length > 0) {
        ownerUnits = stored;
    } else {
        // 以 OWNER_COLORS 預設值初始化
        ownerUnits = Object.entries(OWNER_COLORS).map(([name, color]) => ({ name, color }));
        await DB.saveOwnerUnits(ownerUnits);
    }
    renderUnitTable();
}

function renderUnitTable() {
    const tbody = document.getElementById('unitTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    ownerUnits.forEach((u, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <span class="unit-color-dot" style="background:${u.color};"></span>
                <code style="font-size:0.75rem;color:#64748b">${u.color}</code>
            </td>
            <td><strong>${u.name}</strong></td>
            <td class="actions-cell">
                <button class="btn btn-primary btn-xs" onclick="editUnit(${idx})">
                    <i class="fas fa-edit"></i> 編輯
                </button>
                <button class="btn btn-danger btn-xs" onclick="deleteUnit(${idx})">
                    <i class="fas fa-trash"></i> 刪除
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openUnitModal(editIdx) {
    const modal = document.getElementById('unitModal');
    const title = document.getElementById('unitModalTitle');
    const form = document.getElementById('unitForm');
    const indexInput = document.getElementById('unitEditIndex');
    form.reset();

    if (editIdx !== undefined && editIdx !== null) {
        const unit = ownerUnits[editIdx];
        if (!unit) return;
        title.innerHTML = '<i class="fas fa-building"></i> 編輯單位';
        indexInput.value = editIdx;
        document.getElementById('unitFormName').value = unit.name;
        document.getElementById('unitFormColor').value = unit.color;
        document.getElementById('unitColorHex').textContent = unit.color;
    } else {
        title.innerHTML = '<i class="fas fa-building"></i> 新增單位';
        indexInput.value = '';
        document.getElementById('unitFormColor').value = '#3b82f6';
        document.getElementById('unitColorHex').textContent = '#3b82f6';
    }

    modal.classList.add('active');
}

function editUnit(idx) {
    openUnitModal(idx);
}

function closeUnitModal(e) {
    if (e.target === e.currentTarget) closeUnitModalDirect();
}

function closeUnitModalDirect() {
    document.getElementById('unitModal').classList.remove('active');
}

async function handleUnitFormSubmit(e) {
    e.preventDefault();
    const indexVal = document.getElementById('unitEditIndex').value;
    const name = document.getElementById('unitFormName').value.trim();
    const color = document.getElementById('unitFormColor').value;

    if (!name) { alert('請填寫單位名稱'); return; }

    if (indexVal !== '') {
        // 編輯模式
        const idx = parseInt(indexVal);
        ownerUnits[idx].name = name;
        ownerUnits[idx].color = color;
    } else {
        // 新增模式：檢查重複
        if (ownerUnits.some(u => u.name === name)) {
            alert('此單位名稱已存在！');
            return;
        }
        ownerUnits.push({ name, color });
    }

    await DB.saveOwnerUnits(ownerUnits);
    // 同步更新執行期的 OWNER_COLORS
    syncOwnerColors();
    closeUnitModalDirect();
    renderUnitTable();
}

async function deleteUnit(idx) {
    const unit = ownerUnits[idx];
    if (!confirm(`確定要刪除單位「${unit.name}」嗎？`)) return;
    ownerUnits.splice(idx, 1);
    await DB.saveOwnerUnits(ownerUnits);
    syncOwnerColors();
    renderUnitTable();
}

/** 將 ownerUnits 陣列同步回 OWNER_COLORS 全域物件 */
function syncOwnerColors() {
    // 清空現有 key
    for (const key of Object.keys(OWNER_COLORS)) {
        delete OWNER_COLORS[key];
    }
    ownerUnits.forEach(u => {
        OWNER_COLORS[u.name] = u.color;
    });
}
