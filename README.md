# NYCU_ServerRoom# NYCU BMI 機房機櫃管理系統

> NYCU BMI Server Room Management System — 純前端靜態網站，使用 HTML / CSS / JavaScript + localStorage 實現機櫃設備管理、設備申請、審核、繳費與使用者認證。

---

## 目錄

- [功能總覽](#功能總覽)
- [專案結構](#專案結構)
- [頁面說明](#頁面說明)
- [角色與權限](#角色與權限)
- [認證系統](#認證系統)
- [費用計算機制](#費用計算機制)
- [資料儲存](#資料儲存)
- [快速開始](#快速開始)
- [技術細節](#技術細節)

---

## 功能總覽

| 功能模組 | 說明 |
|----------|------|
| **登入 / 登出** | 帳號密碼驗證，Session 管理，未登入自動跳轉 |
| **機櫃總覽** | 8 座機櫃（A–H）×42U 視覺化呈現，依擁有者著色，使用率統計 |
| **設備管理** | 新增 / 編輯 / 刪除設備，位置衝突偵測，匯出 / 匯入 JSON |
| **設備申請** | 線上填寫上架申請單，即時費用預估，追蹤申請狀態 |
| **管理審核** | 管理員審核申請、指派機櫃位置、自動計算費用、確認上架 |
| **繳費管理** | 費用圖表儀表板、部分繳費 / 繳清全部、批次繳費、逾期判斷 |
| **使用者管理** | 管理員可新增 / 編輯 / 刪除使用者帳號 |

---

## 專案結構

```
NYCU_Server_Room_Web/
├── index.html          # 登入頁面（GitHub Pages 入口）
├── dashboard.html      # 機櫃總覽
├── apply.html          # 設備上架申請
├── admin.html          # 管理員審核 + 使用者管理
├── payment.html        # 繳費紀錄
├── README.md
├── LICENSE
├── css/
│   ├── style.css       # 全域樣式（按鈕、表單、機櫃、Modal 等）
│   └── pages.css       # 頁面專用樣式（導覽列、登入頁、表格、徽章等）
└── js/
    ├── auth.js         # 認證模組（登入/登出/使用者管理/頁面守衛）
    ├── data.js         # 預設機櫃與設備資料
    ├── app.js          # 機櫃總覽頁面邏輯
    ├── apply.js        # 設備申請頁面邏輯
    ├── admin.js        # 管理審核 + 使用者管理邏輯
    └── payment.js      # 繳費管理頁面邏輯
```

---

## 頁面說明

### 1. 登入頁面 (`index.html`)

- 帳號 / 密碼登入表單
- 密碼顯示 / 隱藏切換
- 登入失敗顯示錯誤訊息 + 抖動動畫
- 按鈕 Loading 狀態（模擬短暫延遲）
- 已登入者自動導向機櫃總覽

### 2. 機櫃總覽 (`dashboard.html`)

- 顯示 8 座機櫃（A–H），每座 42U
- 每個 U 位置以擁有者顏色填色，點擊可查看設備詳情
- 每座機櫃上方顯示使用率條（綠 / 黃 / 紅 依使用率變色）
- 支援依擁有者篩選（下拉選單 + 圖例列點擊）
- 高亮同擁有者設備、淡化其他設備
- 設備 Hover 浮動提示（名稱、擁有者、大小、IP、聯絡人等）
- 提供新增 / 編輯 / 刪除設備功能（僅管理員）
- 新增 / 編輯時即時顯示可用 U 位置區間
- 位置衝突偵測（新增或編輯時自動檢查重疊）
- 統計面板：設備總數、已使用 U 數、使用率
- 資料匯出（JSON）/ 匯入功能（僅管理員）
- 預設 48 筆範例設備資料，涵蓋 10 個擁有者

### 3. 設備申請 (`apply.html`)

- 填寫申請人資訊（姓名、單位、信箱、電話）
- 已登入使用者自動帶入姓名（唯讀）
- 填寫設備資訊（名稱、型號、U 數、用電、期望機櫃、IP 需求等）
- 使用期間設定（預計上架日期、使用到期日）
- **即時費用預估**：依 U 數與使用期間自動計算預估費用（含按比例明細）
- 送出後可在右側追蹤自己的申請狀態
- 申請紀錄搜尋功能
- 點擊申請卡片可查看完整詳情彈窗

### 4. 管理審核 (`admin.html`)

- **管理員視角**：
  - 審核申請單：核准（指派機櫃位置 + 自動計算費用）/ 拒絕（填寫拒絕原因）
  - 核准時自動帶入按比例費用計算、顯示可用 U 位置
  - 已通過申請可確認上架（自動寫入機櫃設備資料）
  - 上架時再次檢查衝突、未繳費提醒
  - 搜尋功能（搜尋申請人 / 設備名）
  - **使用者管理區塊**：新增 / 編輯 / 刪除使用者帳號
- **一般使用者視角**：
  - 頁面標題顯示「我的申請進度」
  - 只能看到自己提交的申請
  - 隱藏待審核分頁、搜尋框、統計徽章
- 分頁篩選：全部 / 待審核 / 已通過 / 已拒絕 / 已上架

### 5. 繳費管理 (`payment.html`)

- **管理員視角**：
  - 費用圖表儀表板（Chart.js）：
    - 統計卡片：應收總額、已收金額、未收金額、收繳率
    - 甜甜圈圖：繳費狀態分佈（已繳 / 待繳 / 逾期）
    - 長條圖：各單位費用統計
  - 繳費列表表格（申請編號、申請人、設備、金額、狀態等）
  - 確認繳費功能
- **一般使用者視角**：
  - 個人待繳費用面板
  - 繳費範圍選擇：繳清全部 / 繳費到指定月份（部分繳費）
  - 繳費明細預覽（逐筆列出金額與期間）
  - 批次繳費功能
- **繳費方式**：銀行轉帳、現金繳費、支票、校內經費核銷
- 分頁篩選：全部 / 待繳費 / 已繳費 / 逾期

---

## 角色與權限

### 角色說明

| 角色 | 權限 |
|------|------|
| `admin`（管理員）| 所有功能 + 使用者管理 + 設備管理 + 審核 + 匯出匯入 |
| `user`（一般使用者）| 機櫃總覽（僅查看）、設備申請、查看自己的申請進度、個人繳費 |

### 管理員 vs 一般使用者 UI 差異

| 頁面 | 管理員 | 一般使用者 |
|------|--------|-----------|
| **導覽列** | 顯示「管理審核」 | 顯示「申請進度」 |
| **機櫃總覽** | 可新增 / 編輯 / 刪除設備、匯出匯入 | 僅能查看，操作按鈕隱藏 |
| **管理審核** | 看到所有申請、可審核操作、使用者管理 | 只看到自己的申請、無操作按鈕 |
| **繳費管理** | 看到所有人的紀錄 + 圖表儀表板 | 只看到個人待繳費面板 |

---

## 認證系統

### 架構

認證邏輯集中在 `js/auth.js`，所有頁面（除 `index.html` 登入頁外）在載入時自動檢查登入狀態。

```
┌─────────────┐     未登入      ┌─────────────┐
│  任何頁面    │ ──────────────→ │  index.html  │
│  (載入時)    │                 │  (登入頁)    │
└─────────────┘     登入成功     └──────┬───────┘
       ↑            ←───────────────────┘
       │
       ▼
  導覽列顯示使用者名稱 + 登出按鈕
  依角色動態調整導覽列連結文字
```

### Firebase 管理員帳號設定

本專案使用 **Firebase Authentication + Firestore**，管理員權限不是看 Authentication 裡「帳號名稱」，而是看 Firestore `users/{uid}` 內的 `role` 欄位。

1. 先在 Firebase Console → **Authentication** 建立帳號（Email/Password）。
2. 用該帳號登入一次網站（讓系統建立 `users/{uid}` 基本資料）。
3. 到 Firebase Console → **Firestore Database** → `users` collection，找到該使用者文件（文件 ID 應為該帳號的 `uid`）。
4. 將文件內容設成（或至少包含）以下欄位：

```json
{
  "email": "your-admin@example.com",
  "displayName": "系統管理員",
  "role": "admin"
}
```

5. 重新整理頁面或重新登入，`Auth.isAdmin()` 會變成 `true`。

> 補充：若你已經用 email 當文件 ID 建過舊資料，`js/auth.js` 會在登入時自動搬移到 `users/{uid}`。

### Auth API 參考

| 方法 | 說明 |
|------|------|
| `Auth.login(email, password)` | 登入，回傳 `{ success, user/message }` |
| `Auth.logout()` | 登出並導向登入頁 |
| `Auth.getCurrentUser()` | 取得目前登入者 `{ uid, email, role, displayName }` |
| `Auth.isLoggedIn()` | 是否已登入 |
| `Auth.isAdmin()` | 是否為管理員 |
| `Auth.requireAuth()` | 認證守衛，未登入自動跳轉 |
| `Auth.requireAdmin()` | 管理員守衛 |
| `Auth.getUsers()` | 取得所有使用者列表 |
| `Auth.addUser(email, password, role, displayName)` | 新增使用者（建立 Firebase Auth + Firestore profile） |
| `Auth.updateUser(uid, role, displayName)` | 更新使用者角色/名稱 |
| `Auth.deleteUser(uid)` | 刪除使用者 Firestore profile |

---

## 費用計算機制

### 計費規則

- **每 U 每月費用**：`NT$ 350`（常數 `PRICE_PER_U_PER_MONTH`）
- **按比例計算**：不足一個月按天數比例計算（`calculateProRatedFee()`）
- **公式**：`費用 = 每U月費 × U數 × 使用月數（含比例）`

### 計算範例

```
設備 2U，使用期間 2026-01-15 ~ 2026-03-31

  2026/1: 17/31 天 = 0.548 個月
  2026/2: 28/28 天 = 1.000 個月
  2026/3: 31/31 天 = 1.000 個月
  合計 = 2.548 個月

  費用 = 350 × 2 × 2.548 = NT$ 1,784
```

### 費用計算時機

| 場景 | 說明 |
|------|------|
| **申請表填寫** | 即時預估費用（U 數 × 使用期間） |
| **管理員核准** | 自動帶入計算結果，可手動調整 |
| **部分繳費** | 計算從已繳費截止日到指定月份的費用 |

---

## 資料儲存

所有資料使用瀏覽器 `localStorage` 儲存，無需後端伺服器。

| Key | 說明 |
|-----|------|
| `bmi_server_room_devices` | 機櫃設備資料（JSON 陣列） |
| `bmi_applications` | 設備申請紀錄（JSON 陣列） |
| `bmi_users` | 使用者帳號列表（JSON 陣列） |
| `bmi_current_user` | 目前登入者 Session（JSON 物件） |

### 設備資料結構

```json
{
  "id": 1,
  "name": "Core Switch",
  "cabinet": 0,
  "startU": 1,
  "uSize": 2,
  "owner": "網路管理中心",
  "contact": "陳小明",
  "email": "network@nycu.edu.tw",
  "ip": "140.113.0.1",
  "description": "核心交換器"
}
```

### 申請資料結構

```json
{
  "id": 1001,
  "submittedBy": "admin",
  "applicantName": "王大名",
  "applicantUnit": "王教授實驗室",
  "applicantEmail": "wang@nycu.edu.tw",
  "applicantPhone": "0912-345-678",
  "deviceName": "GPU Server 03",
  "deviceModel": "Dell PowerEdge R740",
  "uSize": 4,
  "power": 750,
  "preferCabinet": "0",
  "ipNeed": "need",
  "existingIP": "",
  "startDate": "2026-03-01",
  "endDate": "2027-03-01",
  "purpose": "深度學習模型訓練",
  "notes": "",
  "status": "pending",
  "submitDate": "2026-02-24T12:00:00.000Z",
  "reviewDate": null,
  "adminNotes": "",
  "assignedCabinet": null,
  "assignedStartU": null,
  "assignedIP": "",
  "fee": 0,
  "paymentStatus": "unpaid",
  "paidAmount": 0,
  "paidUpTo": null,
  "paymentDate": null,
  "paymentMethod": "",
  "paymentRef": ""
}
```

> **申請狀態流程**：`pending`（待審核）→ `approved`（已通過）→ `installed`（已上架），或 `pending` → `rejected`（已拒絕）

> **繳費狀態**：`unpaid`（待繳費）→ `partial`（部分繳費）→ `paid`（已繳清），或 `overdue`（逾期）

### 使用者資料結構

```json
{
  "username": "admin",
  "password": "admin",
  "role": "admin",
  "displayName": "系統管理員"
}
```

### 擁有者顏色系統

系統預設 10 組擁有者對應顏色，超出時從 15 組備用顏色自動分配：

| 擁有者 | 顏色 |
|--------|------|
| 王教授實驗室 | 🔵 藍色 `#3b82f6` |
| 李教授實驗室 | 🔴 紅色 `#ef4444` |
| 張教授實驗室 | 🟢 綠色 `#10b981` |
| 陳教授實驗室 | 🟡 琥珀色 `#f59e0b` |
| 林教授實驗室 | 🟣 紫色 `#8b5cf6` |
| 黃教授實驗室 | 🩷 粉色 `#ec4899` |
| 劉教授實驗室 | 🩵 青色 `#06b6d4` |
| 網路管理中心 | 🟠 橙色 `#f97316` |
| BMI 系辦 | 🔷 靛藍色 `#6366f1` |
| 資訊工程系 | 💚 碧綠色 `#14b8a6` |

### 預設範例資料

系統首次使用時載入 **48 筆設備**，分佈於 8 座機櫃（A–H），涵蓋上述 10 個擁有者，包含 GPU Server、NAS、交換器、防火牆、Kubernetes 叢集、醫學影像伺服器等各類設備。

---

## 快速開始

### 1. 直接開啟

由於是純靜態網站，直接用瀏覽器開啟 `index.html` 即可使用（GitHub Pages 部署後會自動以 `index.html` 為入口）。

### 2. 使用本地伺服器（建議）

```bash
# 使用 Python
python3 -m http.server 8080

# 或使用 Node.js
npx serve .

# 或使用 VS Code Live Server 擴充套件
```

開啟瀏覽器前往 `http://localhost:8080`，系統會自動跳轉至登入頁面。

### 3. 首次使用

1. 使用預設帳號 `admin` / `admin` 登入
2. 進入「管理審核」頁面底部的「使用者管理」新增其他使用者
3. 開始使用各項功能

---

## 技術細節

- **前端框架**：無框架，純 Vanilla JavaScript
- **樣式**：原生 CSS，使用 CSS Variables 統一色彩主題
- **圖示**：Font Awesome 6.4（CDN）
- **圖表**：Chart.js 4.4（CDN，用於繳費管理頁面的甜甜圈圖與長條圖）
- **資料持久化**：瀏覽器 localStorage
- **認證機制**：前端 Session（localStorage），頁面載入時自動驗證
- **RWD 響應式**：支援桌面與行動裝置
- **動畫效果**：CSS animation（登入抖動、Modal 淡入、成功提示等）

### 外部依賴（皆透過 CDN 載入）

| 套件 | 版本 | 用途 |
|------|------|------|
| [Font Awesome](https://fontawesome.com/) | 6.4.0 | 圖示 |
| [Chart.js](https://www.chartjs.org/) | 4.4.7 | 繳費管理頁面圖表 |

---

## License

詳見 [LICENSE](LICENSE) 檔案。
