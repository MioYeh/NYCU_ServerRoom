/**
 * NYCU BMI 機房管理系統 - Firestore 資料存取層
 * 
 * 使用 Firestore 作為共享資料庫。
 * 使用者認證由 Firebase Authentication 處理，
 * 使用者 profile 存在 users/{uid} collection 中。
 *
 * Firestore 結構:
 *   collections/devices      → doc "all" → { items: [...] }
 *   collections/applications → doc "all" → { items: [...] }
 *   users/{uid}              → { email, role, displayName }
 */

const DB = {
    // ===== 設備 (devices) =====
    async getDevices() {
        try {
            const doc = await db.collection('collections').doc('devices').get();
            if (doc.exists && doc.data().items) {
                return doc.data().items;
            }
        } catch (e) {
            console.error('DB.getDevices error:', e);
        }
        return null; // null 表示尚未初始化
    },

    async saveDevices(devices) {
        try {
            await db.collection('collections').doc('devices').set({ items: devices });
        } catch (e) {
            console.error('DB.saveDevices error:', e);
            alert('儲存設備資料失敗，請檢查網路連線。');
        }
    },

    // ===== 申請單 (applications) =====
    async getApplications() {
        try {
            const doc = await db.collection('collections').doc('applications').get();
            if (doc.exists && doc.data().items) {
                return doc.data().items;
            }
        } catch (e) {
            console.error('DB.getApplications error:', e);
        }
        return [];
    },

    async saveApplications(applications) {
        try {
            await db.collection('collections').doc('applications').set({ items: applications });
        } catch (e) {
            console.error('DB.saveApplications error:', e);
            alert('儲存申請資料失敗，請檢查網路連線。');
        }
    },

    // ===== 使用者 (users) - 已遷移至 Firebase Authentication =====
    // 使用者 profile 現在存在 Firestore users/{uid} collection 中
    // 由 auth.js 中的 Auth 物件管理

    // ===== 初始化：確保 Firestore 有預設資料 =====
    async initDefaults(defaultDevices) {
        // 初始化 devices
        const existingDevices = await this.getDevices();
        if (existingDevices === null) {
            console.log('初始化 Firestore: 寫入預設設備資料');
            await this.saveDevices(defaultDevices);
        }

        // 初始化 applications (空陣列)
        const existingApps = await this.getApplications();
        if (!existingApps || existingApps.length === 0) {
            const doc = await db.collection('collections').doc('applications').get();
            if (!doc.exists) {
                await this.saveApplications([]);
            }
        }
    }
};
