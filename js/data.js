/**
 * 機房機櫃管理系統 - 預設資料
 * 
 * 機櫃名稱: B ~ I (共 8 個)
 * BCDE 每櫃 41U, FGHI 每櫃 42U
 * 
 * 設備資料結構:
 * {
 *   id: 唯一 ID,
 *   name: 設備名稱,
 *   cabinet: 機櫃索引 (0-7),
 *   startU: 起始 U 位置 (1 = 底部),
 *   uSize: 設備大小 (U 數),
 *   owner: 擁有者名稱,
 *   contact: 聯絡人,
 *   email: 聯絡信箱,
 *   ip: IP 位址,
 *   description: 備註
 * }
 */

const CABINET_NAMES = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const CABINET_U = [41, 41, 41, 41, 42, 42, 42, 42]; // BCDE=41U, FGHI=42U

/** 取得指定機櫃的 U 數 */
function getCabinetU(cabinetIdx) {
    return CABINET_U[cabinetIdx] || 42;
}

/** 取得所有機櫃的總 U 數 */
function getTotalU() {
    return CABINET_U.reduce((sum, u) => sum + u, 0);
}

// 擁有者對應顏色
const OWNER_COLORS = {
    '王禹超實驗室':   '#3b82f6',  // 藍色
    '吳俊穎實驗室':   '#ef4444',  // 紅色
    '巫坤品實驗室':   '#10b981',  // 綠色
    '洪哲倫實驗室':   '#f59e0b',  // 琥珀色
    '張博論實驗室':   '#8b5cf6',  // 紫色
    '黃宣誠實驗室':   '#ec4899',  // 粉色
    '鍾翊方實驗室':   '#06b6d4',  // 青色
    '蘇家玉實驗室':   '#0e7490', 
    '林振慶實驗室':   '#b45309', 
    '黃彥華實驗室':   '#6d28d9', 
    '陳卓逸實驗室':   '#047857',
    '數位醫學中心':   '#f97316',  // 橙色
    'BMI 所辦':      '#6366f1',  // 靛藍色
    '醫學院':    '#14b8a6',  // 碧綠色
};

// 每 U 每月費用
const PRICE_PER_U_PER_MONTH = 350;

/**
 * 計算按比例的費用（不足一個月按天數比例計算）
 * @param {string} startDateStr - 起始日期 (YYYY-MM-DD)
 * @param {string} endDateStr - 結束日期 (YYYY-MM-DD)，含當天
 * @param {number} uSize - 設備 U 數
 * @returns {{ fee: number, months: number, breakdown: string }}
 */
function calculateProRatedFee(startDateStr, endDateStr, uSize) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start) || isNaN(end) || end < start) {
        return { fee: 0, months: 0, breakdown: '日期無效' };
    }

    let totalMonths = 0;
    const parts = [];
    let cursor = new Date(start);

    while (cursor <= end) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dayStart = cursor.getDate();

        // 計算此月最後一天（受 end 限制）
        const monthEnd = new Date(year, month, daysInMonth);
        const effectiveEnd = monthEnd <= end ? monthEnd : end;
        const dayEnd = effectiveEnd.getDate();

        const daysUsed = dayEnd - dayStart + 1;

        if (daysUsed === daysInMonth) {
            totalMonths += 1;
            parts.push(`${year}/${month + 1} 整月`);
        } else {
            const fraction = daysUsed / daysInMonth;
            totalMonths += fraction;
            parts.push(`${year}/${month + 1}: ${daysUsed}/${daysInMonth}天`);
        }

        // 移到下個月第一天
        cursor = new Date(year, month + 1, 1);
    }

    const fee = Math.round(PRICE_PER_U_PER_MONTH * uSize * totalMonths);
    const breakdown = parts.join(' + ');
    return { fee, months: totalMonths, breakdown };
}

/**
 * 取得設備的有效到期日（考慮所有已核准的延期申請）
 * 原始申請的 endDate 只記錄「原始計費期間」的到期日，
 * 實際有效到期日需從已核准的延期申請中推算。
 * @param {number} appId - 原始設備申請 ID
 * @param {Array} apps - 所有申請陣列
 * @returns {string|null} 有效到期日 (YYYY-MM-DD)
 */
function getEffectiveEndDate(appId, apps) {
    const original = apps.find(a => a.id === appId);
    if (!original) return null;

    const approvedRenewals = apps.filter(a =>
        a.type === 'renewal' &&
        a.originalAppId === appId &&
        (a.status === 'approved' || a.status === 'installed')
    );

    if (approvedRenewals.length === 0) return original.endDate;

    // 取所有已核准延期中最遠的到期日
    return approvedRenewals.reduce((latest, r) =>
        r.endDate > latest ? r.endDate : latest,
        original.endDate
    );
}

/**
 * 修復被舊程式碼錯誤更新的申請資料
 * 舊版 approveRenewal 會把原始申請的 endDate 和 fee 更新成涵蓋整個延期期間，
 * 此函式偵測並修正這些錯誤。
 * @param {Array} apps - 所有申請陣列
 * @returns {boolean} 是否有資料被修復
 */
function repairCorruptedApplications(apps) {
    let repaired = false;

    // 依原始申請 ID 分組所有已核准的延期申請
    const renewalsByOriginal = {};
    apps.filter(a => a.type === 'renewal' && (a.status === 'approved' || a.status === 'installed'))
        .forEach(r => {
            if (!renewalsByOriginal[r.originalAppId]) renewalsByOriginal[r.originalAppId] = [];
            renewalsByOriginal[r.originalAppId].push(r);
        });

    for (const [origId, renewals] of Object.entries(renewalsByOriginal)) {
        const originalApp = apps.find(a => a.id === parseInt(origId) && a.type !== 'renewal');
        if (!originalApp) continue;

        // 以最早的延期申請中記錄的 originalEndDate 作為正確的原始到期日
        renewals.sort((a, b) => new Date(a.submitDate) - new Date(b.submitDate));
        const correctEndDate = renewals[0].originalEndDate;
        if (!correctEndDate) continue;

        // 檢查原始申請的 endDate 是否被錯誤更新（比正確值晚）
        if (originalApp.endDate > correctEndDate) {
            console.log(`修復申請 #${originalApp.id}: endDate ${originalApp.endDate} → ${correctEndDate}`);
            originalApp.endDate = correctEndDate;
            // 重新計算正確的費用（僅涵蓋原始計費期間）
            const correctFee = calculateProRatedFee(originalApp.startDate, correctEndDate, originalApp.uSize).fee;
            originalApp.fee = correctFee;
            // 更新繳費狀態
            if ((originalApp.paidAmount || 0) >= correctFee) {
                originalApp.paymentStatus = 'paid';
            } else if ((originalApp.paidAmount || 0) > 0) {
                originalApp.paymentStatus = 'partial';
            }
            repaired = true;
        }
    }

    if (repaired) {
        console.log('已自動修復被舊程式碼錯誤更新的申請資料');
    }
    return repaired;
}

// 備用顏色 (當擁有者超過預設顏色時自動分配)
const EXTRA_COLORS = [
    '#a855f7', '#e11d48', '#0d9488', '#ca8a04', '#7c3aed',
    '#db2777', '#0891b2', '#d97706', '#4f46e5', '#059669',
    '#be185d', 
];

// 預設範例設備資料
// const DEFAULT_DEVICES = [
//     // === 機櫃 A ===
//     { id: 1,  name: 'Core Switch',           cabinet: 0, startU: 1,  uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.1',   description: '核心交換器' },
//     { id: 2,  name: 'Firewall',              cabinet: 0, startU: 3,  uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.2',   description: '防火牆設備' },
//     { id: 3,  name: 'NAS Storage 01',        cabinet: 0, startU: 5,  uSize: 4, owner: 'BMI 系辦',    contact: '林小華', email: 'bmi@nycu.edu.tw',     ip: '140.113.10.10', description: '系辦公用儲存' },
//     { id: 4,  name: 'GPU Server 01',         cabinet: 0, startU: 10, uSize: 4, owner: '王教授實驗室', contact: '王大名', email: 'wang@nycu.edu.tw',    ip: '140.113.20.1',  description: 'NVIDIA A100 x4, Deep Learning' },
//     { id: 5,  name: 'GPU Server 02',         cabinet: 0, startU: 14, uSize: 4, owner: '王教授實驗室', contact: '王大名', email: 'wang@nycu.edu.tw',    ip: '140.113.20.2',  description: 'NVIDIA A100 x4, Training' },
//     { id: 6,  name: 'Web Server',            cabinet: 0, startU: 20, uSize: 2, owner: 'BMI 系辦',    contact: '林小華', email: 'bmi@nycu.edu.tw',     ip: '140.113.10.20', description: '系網站伺服器' },
//     { id: 7,  name: 'Backup Server',         cabinet: 0, startU: 22, uSize: 3, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.10',  description: '備份伺服器' },

//     // === 機櫃 B ===
//     { id: 8,  name: 'Compute Node 01',       cabinet: 1, startU: 1,  uSize: 2, owner: '李教授實驗室', contact: '李明哲', email: 'lee@nycu.edu.tw',     ip: '140.113.21.1',  description: 'HPC 運算節點' },
//     { id: 9,  name: 'Compute Node 02',       cabinet: 1, startU: 3,  uSize: 2, owner: '李教授實驗室', contact: '李明哲', email: 'lee@nycu.edu.tw',     ip: '140.113.21.2',  description: 'HPC 運算節點' },
//     { id: 10, name: 'Compute Node 03',       cabinet: 1, startU: 5,  uSize: 2, owner: '李教授實驗室', contact: '李明哲', email: 'lee@nycu.edu.tw',     ip: '140.113.21.3',  description: 'HPC 運算節點' },
//     { id: 11, name: 'Storage Array',         cabinet: 1, startU: 8,  uSize: 4, owner: '李教授實驗室', contact: '李明哲', email: 'lee@nycu.edu.tw',     ip: '140.113.21.10', description: '分散式儲存陣列' },
//     { id: 12, name: 'ML Server 01',          cabinet: 1, startU: 15, uSize: 3, owner: '張教授實驗室', contact: '張美玲', email: 'chang@nycu.edu.tw',   ip: '140.113.22.1',  description: 'Machine Learning 訓練伺服器' },
//     { id: 13, name: 'ML Server 02',          cabinet: 1, startU: 18, uSize: 3, owner: '張教授實驗室', contact: '張美玲', email: 'chang@nycu.edu.tw',   ip: '140.113.22.2',  description: 'Machine Learning 推論伺服器' },
//     { id: 14, name: 'DB Server',             cabinet: 1, startU: 25, uSize: 2, owner: '張教授實驗室', contact: '張美玲', email: 'chang@nycu.edu.tw',   ip: '140.113.22.10', description: 'PostgreSQL 資料庫' },

//     // === 機櫃 C ===
//     { id: 15, name: 'Bio Server 01',         cabinet: 2, startU: 1,  uSize: 4, owner: '陳教授實驗室', contact: '陳志偉', email: 'chen@nycu.edu.tw',    ip: '140.113.23.1',  description: '生物資訊運算主機' },
//     { id: 16, name: 'Bio Server 02',         cabinet: 2, startU: 5,  uSize: 4, owner: '陳教授實驗室', contact: '陳志偉', email: 'chen@nycu.edu.tw',    ip: '140.113.23.2',  description: '基因序列分析' },
//     { id: 17, name: 'Bio Storage',           cabinet: 2, startU: 9,  uSize: 3, owner: '陳教授實驗室', contact: '陳志偉', email: 'chen@nycu.edu.tw',    ip: '140.113.23.10', description: '生物資料儲存' },
//     { id: 18, name: 'Image Server',          cabinet: 2, startU: 15, uSize: 2, owner: '林教授實驗室', contact: '林佳蓉', email: 'lin@nycu.edu.tw',     ip: '140.113.24.1',  description: '醫學影像處理' },
//     { id: 19, name: 'AI Inference',          cabinet: 2, startU: 17, uSize: 3, owner: '林教授實驗室', contact: '林佳蓉', email: 'lin@nycu.edu.tw',     ip: '140.113.24.2',  description: 'AI 推論伺服器' },
//     { id: 20, name: 'Dev Server',            cabinet: 2, startU: 22, uSize: 2, owner: '林教授實驗室', contact: '林佳蓉', email: 'lin@nycu.edu.tw',     ip: '140.113.24.5',  description: '開發測試環境' },

//     // === 機櫃 D ===
//     { id: 21, name: 'EHR Server 01',         cabinet: 3, startU: 1,  uSize: 3, owner: '黃教授實驗室', contact: '黃建文', email: 'huang@nycu.edu.tw',   ip: '140.113.25.1',  description: '電子病歷系統' },
//     { id: 22, name: 'EHR Server 02',         cabinet: 3, startU: 4,  uSize: 3, owner: '黃教授實驗室', contact: '黃建文', email: 'huang@nycu.edu.tw',   ip: '140.113.25.2',  description: '電子病歷備援' },
//     { id: 23, name: 'Analytics Engine',      cabinet: 3, startU: 7,  uSize: 4, owner: '黃教授實驗室', contact: '黃建文', email: 'huang@nycu.edu.tw',   ip: '140.113.25.10', description: '大數據分析引擎' },
//     { id: 24, name: 'NLP Server',            cabinet: 3, startU: 15, uSize: 2, owner: '劉教授實驗室', contact: '劉雅婷', email: 'liu@nycu.edu.tw',     ip: '140.113.26.1',  description: '自然語言處理' },
//     { id: 25, name: 'LLM Server',            cabinet: 3, startU: 17, uSize: 4, owner: '劉教授實驗室', contact: '劉雅婷', email: 'liu@nycu.edu.tw',     ip: '140.113.26.2',  description: 'LLM 大語言模型訓練' },
//     { id: 26, name: 'Text Mining',           cabinet: 3, startU: 21, uSize: 2, owner: '劉教授實驗室', contact: '劉雅婷', email: 'liu@nycu.edu.tw',     ip: '140.113.26.3',  description: '文字探勘伺服器' },

//     // === 機櫃 E ===
//     { id: 27, name: 'Edge Node 01',          cabinet: 4, startU: 1,  uSize: 2, owner: '王教授實驗室', contact: '王大名', email: 'wang@nycu.edu.tw',    ip: '140.113.20.10', description: '邊緣運算節點' },
//     { id: 28, name: 'Edge Node 02',          cabinet: 4, startU: 3,  uSize: 2, owner: '王教授實驗室', contact: '王大名', email: 'wang@nycu.edu.tw',    ip: '140.113.20.11', description: '邊緣運算節點' },
//     { id: 29, name: 'IoT Gateway',           cabinet: 4, startU: 5,  uSize: 2, owner: '資訊工程系',  contact: '吳建志', email: 'csie@nycu.edu.tw',    ip: '140.113.30.1',  description: 'IoT 閘道器' },
//     { id: 30, name: 'K8s Master',            cabinet: 4, startU: 10, uSize: 2, owner: '資訊工程系',  contact: '吳建志', email: 'csie@nycu.edu.tw',    ip: '140.113.30.10', description: 'Kubernetes Master' },
//     { id: 31, name: 'K8s Worker 01',         cabinet: 4, startU: 12, uSize: 2, owner: '資訊工程系',  contact: '吳建志', email: 'csie@nycu.edu.tw',    ip: '140.113.30.11', description: 'Kubernetes Worker' },
//     { id: 32, name: 'K8s Worker 02',         cabinet: 4, startU: 14, uSize: 2, owner: '資訊工程系',  contact: '吳建志', email: 'csie@nycu.edu.tw',    ip: '140.113.30.12', description: 'Kubernetes Worker' },

//     // === 機櫃 F ===
//     { id: 33, name: 'VM Host 01',            cabinet: 5, startU: 1,  uSize: 4, owner: 'BMI 系辦',    contact: '林小華', email: 'bmi@nycu.edu.tw',     ip: '140.113.10.30', description: 'VMware ESXi Host' },
//     { id: 34, name: 'VM Host 02',            cabinet: 5, startU: 5,  uSize: 4, owner: 'BMI 系辦',    contact: '林小華', email: 'bmi@nycu.edu.tw',     ip: '140.113.10.31', description: 'VMware ESXi Host' },
//     { id: 35, name: 'SAN Storage',           cabinet: 5, startU: 9,  uSize: 4, owner: 'BMI 系辦',    contact: '林小華', email: 'bmi@nycu.edu.tw',     ip: '140.113.10.40', description: 'SAN 儲存設備' },
//     { id: 36, name: 'Monitoring',            cabinet: 5, startU: 16, uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.20',  description: 'Zabbix / Grafana 監控' },
//     { id: 37, name: 'Log Server',            cabinet: 5, startU: 18, uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.21',  description: 'ELK Stack 日誌系統' },

//     // === 機櫃 G ===
//     { id: 38, name: 'DICOM Server',          cabinet: 6, startU: 1,  uSize: 3, owner: '陳教授實驗室', contact: '陳志偉', email: 'chen@nycu.edu.tw',    ip: '140.113.23.20', description: 'DICOM 醫學影像伺服器' },
//     { id: 39, name: 'PACS Storage',          cabinet: 6, startU: 4,  uSize: 4, owner: '陳教授實驗室', contact: '陳志偉', email: 'chen@nycu.edu.tw',    ip: '140.113.23.21', description: 'PACS 影像儲存' },
//     { id: 40, name: 'Research Node 01',      cabinet: 6, startU: 10, uSize: 2, owner: '張教授實驗室', contact: '張美玲', email: 'chang@nycu.edu.tw',   ip: '140.113.22.20', description: '研究運算節點' },
//     { id: 41, name: 'Research Node 02',      cabinet: 6, startU: 12, uSize: 2, owner: '張教授實驗室', contact: '張美玲', email: 'chang@nycu.edu.tw',   ip: '140.113.22.21', description: '研究運算節點' },
//     { id: 42, name: 'Federated Learning',    cabinet: 6, startU: 18, uSize: 3, owner: '林教授實驗室', contact: '林佳蓉', email: 'lin@nycu.edu.tw',     ip: '140.113.24.10', description: '聯邦學習伺服器' },

//     // === 機櫃 H ===
//     { id: 43, name: 'GPU Cluster 01',        cabinet: 7, startU: 1,  uSize: 4, owner: '劉教授實驗室', contact: '劉雅婷', email: 'liu@nycu.edu.tw',     ip: '140.113.26.10', description: 'NVIDIA H100 x8' },
//     { id: 44, name: 'GPU Cluster 02',        cabinet: 7, startU: 5,  uSize: 4, owner: '劉教授實驗室', contact: '劉雅婷', email: 'liu@nycu.edu.tw',     ip: '140.113.26.11', description: 'NVIDIA H100 x8' },
//     { id: 45, name: 'CI/CD Server',          cabinet: 7, startU: 12, uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.30',  description: 'Jenkins / GitLab Runner' },
//     { id: 46, name: 'DNS Server',            cabinet: 7, startU: 14, uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.31',  description: 'DNS 名稱伺服器' },
//     { id: 47, name: 'Mail Server',           cabinet: 7, startU: 16, uSize: 2, owner: 'BMI 系辦',    contact: '林小華', email: 'bmi@nycu.edu.tw',     ip: '140.113.10.50', description: '郵件伺服器' },
//     { id: 48, name: 'UPS Controller',        cabinet: 7, startU: 40, uSize: 2, owner: '網路管理中心', contact: '陳小明', email: 'network@nycu.edu.tw', ip: '140.113.0.50',  description: 'UPS 不斷電控制器' },
// ];

