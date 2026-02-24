/**
 * NYCU BMI 機房機櫃管理系統 - 主要應用邏輯
 */

// ===== 全域狀態 =====
let devices = [];
let ownerColorMap = {};
let extraColorIndex = 0;
let selectedOwner = null;
let currentDetailDeviceId = null;

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
    await loadDevices();
    render();
    initAdminOnlyButtons();
});

// ===== 權限控制：顯示/隱藏管理員專用按鈕 =====
function initAdminOnlyButtons() {
    const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin();
    document.querySelectorAll('.admin-only-btn').forEach(btn => {
        btn.style.display = isAdmin ? '' : 'none';
    });
}

// ===== 資料載入與儲存 (Firestore) =====
async function loadDevices() {
    const saved = await DB.getDevices();
    if (saved && saved.length > 0) {
        devices = saved;
    } else {
        devices = [...DEFAULT_DEVICES];
        await DB.saveDevices(devices);
    }
    buildOwnerColorMap();
}

async function saveDevices() {
    await DB.saveDevices(devices);
}

function getNextId() {
    return devices.length > 0 ? Math.max(...devices.map(d => d.id)) + 1 : 1;
}

// ===== 擁有者顏色對應 =====
function buildOwnerColorMap() {
    ownerColorMap = {};
    extraColorIndex = 0;
    const owners = [...new Set(devices.map(d => d.owner))];
    owners.forEach(owner => {
        ownerColorMap[owner] = getOwnerColor(owner);
    });
}

function getOwnerColor(owner) {
    if (OWNER_COLORS[owner]) return OWNER_COLORS[owner];
    if (ownerColorMap[owner]) return ownerColorMap[owner];
    const color = EXTRA_COLORS[extraColorIndex % EXTRA_COLORS.length];
    extraColorIndex++;
    return color;
}

// ===== 主要渲染 =====
function render() {
    buildOwnerColorMap();
    renderCabinets();
    renderLegend();
    renderOwnerFilter();
    renderStats();
    applyFilter();
}

function renderCabinets() {
    const container = document.getElementById('cabinetContainer');
    container.innerHTML = '';

    CABINET_NAMES.forEach((name, cabinetIdx) => {
        const cabinetDevices = devices.filter(d => d.cabinet === cabinetIdx);
        const usedU = cabinetDevices.reduce((sum, d) => sum + d.uSize, 0);
        const usagePercent = Math.round((usedU / TOTAL_U) * 100);

        // 顏色
        let barColor = '#10b981';
        if (usagePercent > 80) barColor = '#ef4444';
        else if (usagePercent > 60) barColor = '#f59e0b';

        const cabinet = document.createElement('div');
        cabinet.className = 'cabinet';
        cabinet.innerHTML = `
            <div class="cabinet-header">
                機櫃 ${name}
                <div class="cabinet-usage">${usedU} / ${TOTAL_U} U (${usagePercent}%)</div>
                <div class="usage-bar-bg"><div class="usage-bar-fill" style="width:${usagePercent}%;background:${barColor}"></div></div>
            </div>
            <div class="cabinet-body" id="cabinet-body-${cabinetIdx}"></div>
        `;
        container.appendChild(cabinet);

        const body = cabinet.querySelector('.cabinet-body');
        renderCabinetBody(body, cabinetIdx, cabinetDevices);
    });
}

function renderCabinetBody(body, cabinetIdx, cabinetDevices) {
    body.style.position = 'relative';

    // 建立 42U 的空格 (由上到下: U42 → U1)
    for (let u = TOTAL_U; u >= 1; u--) {
        const slot = document.createElement('div');
        slot.className = 'u-slot empty';
        slot.dataset.cabinet = cabinetIdx;
        slot.dataset.u = u;

        const label = document.createElement('span');
        label.className = 'u-label';
        label.textContent = u;
        slot.appendChild(label);

        // 點選空格可新增設備
        slot.addEventListener('click', (e) => {
            if (e.target.closest('.device')) return;
            openFormPanel(cabinetIdx, u);
        });

        body.appendChild(slot);
    }

    // 放置設備
    cabinetDevices.forEach(device => {
        placeDevice(body, device);
    });
}

function placeDevice(body, device) {
    const el = document.createElement('div');
    el.className = 'device';
    el.dataset.id = device.id;
    el.dataset.owner = device.owner;

    const color = ownerColorMap[device.owner] || '#64748b';
    el.style.background = color;

    // 用實際 DOM 元素位置來定位，避免像素累積偏差
    const topU = device.startU + device.uSize - 1; // 設備最頂端的 U 編號
    const bottomU = device.startU;                  // 設備最底端的 U 編號
    const topSlot = body.querySelector(`.u-slot[data-u="${topU}"]`);
    const bottomSlot = body.querySelector(`.u-slot[data-u="${bottomU}"]`);

    if (topSlot && bottomSlot) {
        const top = topSlot.offsetTop;
        const height = (bottomSlot.offsetTop + bottomSlot.offsetHeight) - topSlot.offsetTop;
        el.style.top = top + 'px';
        el.style.height = height + 'px';
    }

    const label = document.createElement('span');
    label.className = 'device-label';
    label.textContent = device.name;
    el.appendChild(label);

    // 標記佔用的 slot 為非空
    for (let u = device.startU; u < device.startU + device.uSize; u++) {
        const slot = body.querySelector(`.u-slot[data-u="${u}"]`);
        if (slot) slot.classList.remove('empty');
    }

    // Hover 顯示提示
    el.addEventListener('mouseenter', (e) => showTooltip(e, device));
    el.addEventListener('mousemove', (e) => moveTooltip(e));
    el.addEventListener('mouseleave', hideTooltip);

    // 點選: 高亮同擁有者 & 顯示詳情
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeviceClick(device);
    });

    body.appendChild(el);
}

// ===== 圖例列 =====
function renderLegend() {
    const bar = document.getElementById('legendBar');
    bar.innerHTML = '';

    const owners = [...new Set(devices.map(d => d.owner))].sort();
    owners.forEach(owner => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        if (selectedOwner === owner) item.classList.add('active');
        item.innerHTML = `<span class="legend-color" style="background:${ownerColorMap[owner]}"></span>${owner}`;
        item.addEventListener('click', () => toggleOwnerHighlight(owner));
        bar.appendChild(item);
    });
}

// ===== 篩選下拉 =====
function renderOwnerFilter() {
    const select = document.getElementById('ownerFilter');
    const current = select.value;
    select.innerHTML = '<option value="">-- 全部顯示 --</option>';
    const owners = [...new Set(devices.map(d => d.owner))].sort();
    owners.forEach(owner => {
        const opt = document.createElement('option');
        opt.value = owner;
        opt.textContent = owner;
        select.appendChild(opt);
    });
    select.value = selectedOwner || '';

    // 更新 datalist
    const datalist = document.getElementById('ownerList');
    datalist.innerHTML = '';
    owners.forEach(owner => {
        const opt = document.createElement('option');
        opt.value = owner;
        datalist.appendChild(opt);
    });
}

// ===== 統計 =====
function renderStats() {
    const total = devices.length;
    const usedU = devices.reduce((sum, d) => sum + d.uSize, 0);
    const totalU = TOTAL_U * CABINET_NAMES.length;
    const rate = totalU > 0 ? Math.round((usedU / totalU) * 100) : 0;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statUsed').textContent = `${usedU} / ${totalU}`;
    document.getElementById('statRate').textContent = `${rate}%`;
}

// ===== 高亮邏輯 =====
function toggleOwnerHighlight(owner) {
    if (selectedOwner === owner) {
        selectedOwner = null;
    } else {
        selectedOwner = owner;
    }
    applyFilter();
    renderLegend();
    document.getElementById('ownerFilter').value = selectedOwner || '';
}

function filterByOwner(owner) {
    selectedOwner = owner || null;
    applyFilter();
    renderLegend();
}

function clearFilter() {
    selectedOwner = null;
    document.getElementById('ownerFilter').value = '';
    applyFilter();
    renderLegend();
}

function applyFilter() {
    const allDevices = document.querySelectorAll('.device');
    allDevices.forEach(el => {
        el.classList.remove('highlighted', 'dimmed');
        if (selectedOwner) {
            if (el.dataset.owner === selectedOwner) {
                el.classList.add('highlighted');
            } else {
                el.classList.add('dimmed');
            }
        }
    });
}

// ===== 設備點選 =====
function handleDeviceClick(device) {
    toggleOwnerHighlight(device.owner);
    showDetailModal(device);
}

// ===== Tooltip =====
function showTooltip(e, device) {
    const tip = document.getElementById('tooltip');
    const color = ownerColorMap[device.owner] || '#64748b';
    tip.innerHTML = `
        <div class="tip-title">${device.name}</div>
        <div class="tip-row"><span class="tip-label">擁有者</span><span class="tip-value" style="color:${color};font-weight:600">${device.owner}</span></div>
        <div class="tip-row"><span class="tip-label">大小</span><span class="tip-value">${device.uSize}U (U${device.startU}-U${device.startU + device.uSize - 1})</span></div>
        <div class="tip-row"><span class="tip-label">位置</span><span class="tip-value">機櫃 ${CABINET_NAMES[device.cabinet]}</span></div>
        ${device.ip ? `<div class="tip-row"><span class="tip-label">IP</span><span class="tip-value">${device.ip}</span></div>` : ''}
        ${device.contact ? `<div class="tip-row"><span class="tip-label">聯絡人</span><span class="tip-value">${device.contact}</span></div>` : ''}
        ${device.description ? `<div class="tip-row"><span class="tip-label">備註</span><span class="tip-value">${device.description}</span></div>` : ''}
    `;
    tip.style.display = 'block';
    moveTooltip(e);
}

function moveTooltip(e) {
    const tip = document.getElementById('tooltip');
    const x = e.clientX + 15;
    const y = e.clientY + 15;

    // 避免超出畫面
    const tipRect = tip.getBoundingClientRect();
    const maxX = window.innerWidth - tipRect.width - 10;
    const maxY = window.innerHeight - tipRect.height - 10;

    tip.style.left = Math.min(x, maxX) + 'px';
    tip.style.top = Math.min(y, maxY) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

// ===== 詳情彈窗 =====
function showDetailModal(device) {
    currentDetailDeviceId = device.id;
    const color = ownerColorMap[device.owner] || '#64748b';
    const content = document.getElementById('detailContent');
    content.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">設備名稱</span>
            <span class="detail-value"><strong>${device.name}</strong></span>
        </div>
        <div class="detail-row">
            <span class="detail-label">機櫃位置</span>
            <span class="detail-value">機櫃 ${CABINET_NAMES[device.cabinet]} (U${device.startU} - U${device.startU + device.uSize - 1})</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">設備大小</span>
            <span class="detail-value">${device.uSize}U</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">擁有者</span>
            <span class="detail-value"><span class="owner-color-badge" style="background:${color}"></span>${device.owner}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">聯絡人</span>
            <span class="detail-value">${device.contact || '-'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">信箱</span>
            <span class="detail-value">${device.email ? `<a href="mailto:${device.email}">${device.email}</a>` : '-'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">IP 位址</span>
            <span class="detail-value">${device.ip || '-'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">備註</span>
            <span class="detail-value">${device.description || '-'}</span>
        </div>
    `;
    document.getElementById('detailModal').classList.add('active');
}

function closeDetailModal(e) {
    if (e.target === document.getElementById('detailModal')) {
        closeDetailModalDirect();
    }
}

function closeDetailModalDirect() {
    document.getElementById('detailModal').classList.remove('active');
    currentDetailDeviceId = null;
}

function editFromDetailModal() {
    if (typeof Auth !== 'undefined' && !Auth.isAdmin()) { alert('僅管理員可編輯設備'); return; }
    if (currentDetailDeviceId === null) return;
    const deviceId = currentDetailDeviceId;
    closeDetailModalDirect();
    const device = devices.find(d => d.id === deviceId);
    if (device) openFormPanelForEdit(device);
}

async function deleteFromDetailModal() {
    if (typeof Auth !== 'undefined' && !Auth.isAdmin()) { alert('僅管理員可刪除設備'); return; }
    if (currentDetailDeviceId === null) return;
    const device = devices.find(d => d.id === currentDetailDeviceId);
    if (!device) return;
    if (!confirm(`確定要刪除「${device.name}」嗎？\n位置：機櫃 ${CABINET_NAMES[device.cabinet]} U${device.startU}-U${device.startU + device.uSize - 1}`)) return;
    devices = devices.filter(d => d.id !== currentDetailDeviceId);
    await saveDevices();
    closeDetailModalDirect();
    render();
}

// ===== 表單面板 =====
function openFormPanel(cabinetIdx, startU) {
    if (typeof Auth !== 'undefined' && !Auth.isAdmin()) { alert('僅管理員可新增設備'); return; }
    resetForm();
    document.getElementById('formTitle').innerHTML = '<i class="fas fa-plus-circle"></i> 新增設備';
    document.getElementById('formSubmitText').textContent = '新增設備';
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('editId').value = '';

    if (cabinetIdx !== undefined) {
        document.getElementById('cabinetSelect').value = cabinetIdx;
    }
    if (startU !== undefined) {
        document.getElementById('startU').value = startU;
    }

    updateAvailableSlots();
    showPanel();
}

function openFormPanelForEdit(device) {
    if (typeof Auth !== 'undefined' && !Auth.isAdmin()) { alert('僅管理員可編輯設備'); return; }
    resetForm();
    document.getElementById('formTitle').innerHTML = '<i class="fas fa-edit"></i> 編輯設備';
    document.getElementById('formSubmitText').textContent = '儲存變更';
    document.getElementById('deleteBtn').style.display = 'block';
    document.getElementById('editId').value = device.id;

    document.getElementById('deviceName').value = device.name;
    document.getElementById('cabinetSelect').value = device.cabinet;
    document.getElementById('startU').value = device.startU;
    document.getElementById('uSize').value = device.uSize;
    document.getElementById('owner').value = device.owner;
    document.getElementById('contact').value = device.contact || '';
    document.getElementById('email').value = device.email || '';
    document.getElementById('ip').value = device.ip || '';
    document.getElementById('description').value = device.description || '';

    updateAvailableSlots();
    showPanel();
}

function showPanel() {
    document.getElementById('overlay').classList.add('active');
    document.getElementById('formPanel').classList.add('active');
}

function closeFormPanel() {
    document.getElementById('overlay').classList.remove('active');
    document.getElementById('formPanel').classList.remove('active');
}

function resetForm() {
    document.getElementById('deviceForm').reset();
    document.getElementById('availableHint').textContent = '';
}

// ===== 可用位置提示 =====
function updateAvailableSlots() {
    const cabinetIdx = parseInt(document.getElementById('cabinetSelect').value);
    const hint = document.getElementById('availableHint');
    if (isNaN(cabinetIdx)) {
        hint.textContent = '';
        return;
    }

    const editId = parseInt(document.getElementById('editId').value) || null;
    const cabinetDevices = devices.filter(d => d.cabinet === cabinetIdx && d.id !== editId);
    const occupied = new Set();
    cabinetDevices.forEach(d => {
        for (let u = d.startU; u < d.startU + d.uSize; u++) {
            occupied.add(u);
        }
    });

    const free = [];
    for (let u = 1; u <= TOTAL_U; u++) {
        if (!occupied.has(u)) free.push(u);
    }

    if (free.length === 0) {
        hint.textContent = '⚠️ 此機櫃已滿';
        hint.style.color = '#dc2626';
    } else {
        // 顯示可用區間
        const ranges = [];
        let start = free[0], end = free[0];
        for (let i = 1; i < free.length; i++) {
            if (free[i] === end + 1) {
                end = free[i];
            } else {
                ranges.push(start === end ? `U${start}` : `U${start}-U${end}`);
                start = end = free[i];
            }
        }
        ranges.push(start === end ? `U${start}` : `U${start}-U${end}`);
        hint.textContent = `可用: ${ranges.join(', ')} (${free.length}U 空閒)`;
        hint.style.color = '#16a34a';
    }
}

// ===== 表單提交 =====
async function handleFormSubmit(e) {
    e.preventDefault();

    const editId = parseInt(document.getElementById('editId').value) || null;
    const name = document.getElementById('deviceName').value.trim();
    const cabinet = parseInt(document.getElementById('cabinetSelect').value);
    const startU = parseInt(document.getElementById('startU').value);
    const uSize = parseInt(document.getElementById('uSize').value);
    const owner = document.getElementById('owner').value.trim();
    const contact = document.getElementById('contact').value.trim();
    const email = document.getElementById('email').value.trim();
    const ip = document.getElementById('ip').value.trim();
    const description = document.getElementById('description').value.trim();

    // 驗證 U 位置範圍
    if (startU < 1 || startU > TOTAL_U) {
        alert(`起始 U 位置必須在 1 ~ ${TOTAL_U} 之間`);
        return;
    }
    if (startU + uSize - 1 > TOTAL_U) {
        alert(`設備超出機櫃範圍 (U${startU} + ${uSize}U = U${startU + uSize - 1}，超過 ${TOTAL_U}U)`);
        return;
    }

    // 衝突偵測
    const conflict = devices.find(d => {
        if (d.id === editId) return false;
        if (d.cabinet !== cabinet) return false;
        const dEnd = d.startU + d.uSize - 1;
        const newEnd = startU + uSize - 1;
        return !(newEnd < d.startU || startU > dEnd);
    });
    if (conflict) {
        alert(`位置衝突！與 "${conflict.name}" (U${conflict.startU}-U${conflict.startU + conflict.uSize - 1}) 重疊。`);
        return;
    }

    const deviceData = { name, cabinet, startU, uSize, owner, contact, email, ip, description };

    if (editId) {
        // 編輯
        const idx = devices.findIndex(d => d.id === editId);
        if (idx !== -1) {
            devices[idx] = { ...devices[idx], ...deviceData };
        }
    } else {
        // 新增
        deviceData.id = getNextId();
        devices.push(deviceData);
    }

    await saveDevices();
    closeFormPanel();
    render();
}

// ===== 刪除設備 =====
async function deleteDevice() {
    const editId = parseInt(document.getElementById('editId').value);
    if (!editId) return;

    const device = devices.find(d => d.id === editId);
    if (!device) return;

    if (!confirm(`確定要刪除「${device.name}」嗎？`)) return;

    devices = devices.filter(d => d.id !== editId);
    await saveDevices();
    closeFormPanel();
    render();
}

// ===== 匯出 / 匯入 =====
function exportData() {
    const data = JSON.stringify(devices, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bmi_server_room_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData() {
    document.getElementById('importFileInput').click();
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) throw new Error('格式錯誤');

            if (confirm(`匯入 ${imported.length} 筆設備資料？\n（將取代目前所有資料）`)) {
                devices = imported;
                await saveDevices();
                render();
            }
        } catch (err) {
            alert('匯入失敗：JSON 格式不正確。\n' + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // 重置 input
}
