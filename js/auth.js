/**
 * NYCU BMI 機房管理系統 - 認證與使用者管理
 * 使用 Firebase Authentication (Email/Password) 進行登入驗證。
 * 使用 Firestore 儲存使用者的 role 和 displayName 等額外資訊。
 *
 * Firestore 結構:
 *   users/{uid} → { email, role, displayName }
 *
 * 首次部署時，請：
 *   1. 在 Firebase Console → Authentication 中手動新增管理員帳號 (email/password)
 *   2. 在 Firestore 中建立對應的 users/{uid} 文件：
 *      { email: "admin@example.com", role: "admin", displayName: "系統管理員" }
 */


// 取得 secondary Auth（用於管理員建立新帳號，避免影響目前登入狀態）
function getSecondaryAuth() {
    if (typeof secondaryAuth !== 'undefined' && secondaryAuth) {
        return secondaryAuth;
    }

    // 若 firebase-config.js 未預先建立 secondaryAuth，這裡自動補建
    const appName = 'secondary';
    const existing = firebase.apps.find(app => app.name === appName);
    const secondaryApp = existing || firebase.initializeApp(firebase.app().options, appName);
    return secondaryApp.auth();
}

// ===== 認證工具函式 =====
const Auth = {
    // 內部快取：目前使用者的 profile（從 Firestore 取得）
    _cachedProfile: null,
    _authResolved: false,

    /**
     * 登入（使用 Firebase Auth email/password）
     * email 可以是 "xxx@example.com" 格式
     */
    async login(email, password) {
        try {
            const credential = await auth.signInWithEmailAndPassword(email, password);
            const uid = credential.user.uid;
            // 從 Firestore 取得使用者角色資訊（支援用 email 回退查找）
            const profile = await this._getProfile(uid, credential.user.email);
            if (profile) {
                this._cachedProfile = { uid, ...profile };
                localStorage.setItem('bmi_current_user', JSON.stringify(this._cachedProfile));
            } else {
                // Firestore 中尚無此使用者的 profile，建立預設
                const defaultProfile = {
                    email: credential.user.email,
                    role: 'user',
                    displayName: credential.user.email.split('@')[0]
                };
                await db.collection('users').doc(uid).set(defaultProfile);
                this._cachedProfile = { uid, ...defaultProfile };
                localStorage.setItem('bmi_current_user', JSON.stringify(this._cachedProfile));
            }
            return { success: true, user: this._cachedProfile };
        } catch (error) {
            console.error('Auth.login error:', error);
            let message = '登入失敗';
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    message = '帳號或密碼錯誤';
                    break;
                case 'auth/invalid-email':
                    message = '電子郵件格式不正確';
                    break;
                case 'auth/too-many-requests':
                    message = '登入嘗試次數過多，請稍後再試';
                    break;
                case 'auth/network-request-failed':
                    message = '網路連線失敗，請檢查網路';
                    break;
                default:
                    message = error.message || '登入失敗';
            }
            return { success: false, message };
        }
    },

    // 登出
    async logout() {
        try {
            await auth.signOut();
        } catch (e) {
            console.error('Auth.logout error:', e);
        }
        this._cachedProfile = null;
        localStorage.removeItem('bmi_current_user');
        window.location.href = 'index.html';
    },

    // 取得目前登入的使用者（同步，讀取快取/localStorage）
    getCurrentUser() {
        if (this._cachedProfile) return this._cachedProfile;
        try {
            const saved = localStorage.getItem('bmi_current_user');
            if (saved) {
                this._cachedProfile = JSON.parse(saved);
                return this._cachedProfile;
            }
        } catch (e) { }
        return null;
    },

    // Firebase Auth 使用者是否已登入
    isFirebaseLoggedIn() {
        return auth.currentUser !== null;
    },

    // 是否已登入（檢查 localStorage 快取）
    isLoggedIn() {
        if (this.isFirebaseLoggedIn()) return true;
        // Firebase 尚未完成 session 還原前，允許用 localStorage 做短暫過渡
        if (!this._authResolved) {
            return this.getCurrentUser() !== null;
        }
        return false;
    },

    // 是否為管理員
    isAdmin() {
        const user = this.getCurrentUser();
        return user && user.role === 'admin';
    },

    // 是否為機房主委
    isCommittee() {
        const user = this.getCurrentUser();
        return user && user.role === 'committee';
    },

    // 是否為審核者（管理員或機房主委）
    isReviewer() {
        return this.isAdmin() || this.isCommittee();
    },

    // 認證守衛：未登入則導向登入頁
    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = 'index.html';
            return false;
        }
        return true;
    },

    // 是否在登入頁
    isLoginPage() {
        return document.getElementById('loginForm') !== null;
    },

    // 處理 Firebase Auth 狀態變更後的導頁
    handlePostAuthStateChange() {
        const onLoginPage = this.isLoginPage();
        if (this.isFirebaseLoggedIn() && onLoginPage) {
            window.location.href = 'dashboard.html';
            return;
        }
        if (!this.isFirebaseLoggedIn() && !onLoginPage) {
            window.location.href = 'index.html';
        }
    },

    // 認證守衛：需要管理員身份
    requireAdmin() {
        if (!this.requireAuth()) return false;
        if (!this.isAdmin()) {
            alert('此頁面需要管理員權限');
            window.location.href = 'dashboard.html';
            return false;
        }
        return true;
    },

    // 認證守衛：需要審核者身份（管理員或機房主委）
    requireReviewer() {
        if (!this.requireAuth()) return false;
        if (!this.isReviewer()) {
            alert('此頁面需要審核權限');
            window.location.href = 'dashboard.html';
            return false;
        }
        return true;
    },

    // === 從 Firestore 取得使用者 profile ===
    // 先用 uid 查找，找不到則用 email 查找（相容手動建立的文件）
    async _getProfile(uid, email) {
        try {
            // 1. 先用 UID 作為文件 ID 查找
            const doc = await db.collection('users').doc(uid).get();
            if (doc.exists) return doc.data();
        } catch (e) {
            console.error('Auth._getProfile (uid) error:', e);
        }

        // 2. 用 email 欄位查詢（處理手動建立的文件 ID 不是 UID 的情況）
        if (email) {
            try {
                const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
                if (!snapshot.empty) {
                    const oldDoc = snapshot.docs[0];
                    const profileData = oldDoc.data();
                    console.log(`找到 email 匹配的文件 (ID: ${oldDoc.id})，自動遷移到 UID: ${uid}`);
                    // 自動修正：將資料複製到以 UID 為 ID 的新文件，刪除舊文件
                    await db.collection('users').doc(uid).set(profileData);
                    if (oldDoc.id !== uid) {
                        await db.collection('users').doc(oldDoc.id).delete();
                    }
                    return profileData;
                }
            } catch (e) {
                console.error('Auth._getProfile (email query) error:', e);
            }
        }

        return null;
    },

    // === 使用者管理（管理員功能）===

    // 取得所有使用者（從 Firestore users collection）
    async getUsers() {
        try {
            const snapshot = await db.collection('users').get();
            const users = [];
            snapshot.forEach(doc => {
                users.push({ uid: doc.id, ...doc.data() });
            });
            return users;
        } catch (e) {
            console.error('Auth.getUsers error:', e);
            return [];
        }
    },

    // 新增使用者（建立 Firebase Auth 帳號 + Firestore profile）
    // 使用第二個 Firebase App 實例建立帳號，不影響管理員的登入狀態
    async addUser(email, password, role, displayName, unit) {
        try {
            // 透過 secondaryAuth 建立帳號，不會影響主實例的 auth.currentUser
            const secondaryAuthInstance = getSecondaryAuth();
            const credential = await secondaryAuthInstance.createUserWithEmailAndPassword(email, password);
            const newUid = credential.user.uid;

            // 在 Firestore 中建立使用者 profile
            await db.collection('users').doc(newUid).set({
                email,
                role,
                displayName,
                unit: unit || ''
            });

            // 立即登出 secondary 實例（僅用於建立帳號）
            await secondaryAuthInstance.signOut();

            return { success: true, message: '使用者已建立' };
        } catch (error) {
            console.error('Auth.addUser error:', error);
            let message = '新增使用者失敗';
            switch (error.code) {
                case 'auth/email-already-in-use':
                    message = '此電子郵件已被註冊';
                    break;
                case 'auth/weak-password':
                    message = '密碼強度不足（至少 6 個字元）';
                    break;
                case 'auth/invalid-email':
                    message = '電子郵件格式不正確';
                    break;
                default:
                    message = error.message || message;
            }
            return { success: false, message };
        }
    },

    // 更新使用者（僅更新 Firestore profile，密碼無法從前端修改其他使用者的）
    async updateUser(uid, role, displayName, unit) {
        try {
            await db.collection('users').doc(uid).update({ role, displayName, unit: unit || '' });
            // 如果修改的是目前登入者，更新快取
            const current = this.getCurrentUser();
            if (current && current.uid === uid) {
                current.role = role;
                current.displayName = displayName;
                current.unit = unit || '';
                this._cachedProfile = current;
                localStorage.setItem('bmi_current_user', JSON.stringify(current));
            }
            return { success: true };
        } catch (e) {
            console.error('Auth.updateUser error:', e);
            return { success: false, message: '更新使用者失敗: ' + e.message };
        }
    },

    // 刪除使用者（僅刪除 Firestore profile，Firebase Auth 帳號需在 Console 手動刪除）
    async deleteUser(uid) {
        try {
            // 不允許刪除自己
            const current = this.getCurrentUser();
            if (current && current.uid === uid) {
                return { success: false, message: '無法刪除目前登入的帳號' };
            }
            await db.collection('users').doc(uid).delete();
            return { success: true, message: '已刪除 Firestore 中的使用者資料。\n如需完全刪除帳號，請至 Firebase Console → Authentication 移除。' };
        } catch (e) {
            console.error('Auth.deleteUser error:', e);
            return { success: false, message: '刪除使用者失敗: ' + e.message };
        }
    }
};

// ===== 監聽 Firebase Auth 狀態變更 =====
auth.onAuthStateChanged(async (firebaseUser) => {
    if (firebaseUser) {
        // 使用者已登入，同步 profile（支援 email 回退查找）
        let profile = await Auth._getProfile(firebaseUser.uid, firebaseUser.email);

        // Firestore 尚無 profile 時補建，避免 refresh 後角色/名稱遺失
        if (!profile) {
            profile = {
                email: firebaseUser.email,
                role: 'user',
                displayName: (firebaseUser.email || 'user').split('@')[0]
            };
            await db.collection('users').doc(firebaseUser.uid).set(profile);
        }

        Auth._cachedProfile = { uid: firebaseUser.uid, ...profile };
        localStorage.setItem('bmi_current_user', JSON.stringify(Auth._cachedProfile));
        Auth._authResolved = true;
        Auth._profileReady = true;
        Auth.handlePostAuthStateChange();
        // 通知各頁面 auth 已就緒，可重新渲染（使用 CustomEvent 確保不受時序影響）
        document.dispatchEvent(new CustomEvent('auth-profile-ready'));
    } else {
        Auth._cachedProfile = null;
        localStorage.removeItem('bmi_current_user');
        Auth._authResolved = true;
        Auth.handlePostAuthStateChange();
    }
});

// ===== 初始化導覽列使用者資訊 =====
function initAuthNav() {
    const user = Auth.getCurrentUser();
    if (!user) return;
    if (document.querySelector('.nav-user')) return;
    // 找到 nav-links 並加入使用者資訊
    const navLinks = document.querySelector('.nav-links');
    if (navLinks) {
        // 建立使用者區塊
        const userBlock = document.createElement('div');
        userBlock.className = 'nav-user';
        userBlock.innerHTML = `
            <span class="nav-user-name"><i class="fas fa-user-circle"></i> ${escapeHTML(user.displayName)}</span>
            <button class="nav-logout-btn" onclick="Auth.logout()" title="登出">
                <i class="fas fa-sign-out-alt"></i> 登出
            </button>
        `;
        // 插入到 nav 層級
        const topNav = document.querySelector('.top-nav');
        if (topNav) {
            topNav.appendChild(userBlock);
        }
    }
}

// ===== 依角色動態調整導覽列連結 =====
function updateNavByRole() {
    const isAdmin = Auth.isAdmin();
    const isCommittee = Auth.isCommittee();
    const isReviewer = isAdmin || isCommittee;
    // 將「管理審核」連結文字依角色調整
    const navLinks = document.querySelectorAll('.nav-links .nav-link');
    navLinks.forEach(link => {
        if (link.getAttribute('href') === 'admin.html') {
            if (isCommittee && !isAdmin) {
                link.innerHTML = '<i class="fas fa-clipboard-check"></i> 主委審核';
            } else if (!isReviewer) {
                link.innerHTML = '<i class="fas fa-list-check"></i> 申請進度';
            }
        }
    });
}

// 頁面載入時自動初始化 nav
document.addEventListener('DOMContentLoaded', () => {
    // 如果不是登入頁面，執行認證守衛
    const isLoginPage = document.getElementById('loginForm') !== null;
    if (!isLoginPage) {
        if (!Auth.isLoggedIn()) {
            window.location.href = 'index.html';
            return;
        }
        initAuthNav();
        updateNavByRole();
    }
});
