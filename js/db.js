/**
 * NYCU BMI 機房管理系統 - Firestore 資料存取層
 * 
 * 使用 Firestore 作為共享資料庫。
 * 使用者認證由 Firebase Authentication 處理，
 * 使用者 profile 存在 users/{uid} collection 中。
 *
 * Firestore 結構:
 *   devices/{deviceId}       → 單筆設備文件
 *   applications/{appId}     → 單筆申請文件
 *   users/{uid}              → { email, role, displayName }
 */

const DB = {
    _normalizeDevice(device) {
        const normalized = { ...device };
        const numericId = Number(normalized.id);
        if (!Number.isNaN(numericId)) {
            normalized.id = numericId;
        }
        if (!normalized.unit || !String(normalized.unit).trim()) {
            normalized.unit = normalized.owner || '';
        }
        return normalized;
    },

    _sortDevicesById(devices) {
        return [...devices].sort((a, b) => {
            const aid = Number(a.id);
            const bid = Number(b.id);
            if (!Number.isNaN(aid) && !Number.isNaN(bid)) return aid - bid;
            return String(a.id).localeCompare(String(b.id));
        });
    },

    _normalizeApplication(application) {
        const normalized = { ...application };
        const numericId = Number(normalized.id);
        if (!Number.isNaN(numericId)) {
            normalized.id = numericId;
        }
        normalized.submittedBy = normalized.submittedBy || '';
        normalized.applicantUnit = normalized.applicantUnit || '';
        return normalized;
    },

    _sortApplicationsById(applications) {
        return [...applications].sort((a, b) => {
            const aid = Number(a.id);
            const bid = Number(b.id);
            if (!Number.isNaN(aid) && !Number.isNaN(bid)) return aid - bid;
            return String(a.id).localeCompare(String(b.id));
        });
    },

    // ===== 設備 (devices) =====
    async getDevices() {
        try {
            const isReviewer = typeof Auth !== 'undefined' && typeof Auth.isReviewer === 'function' && Auth.isReviewer();
            const currentUser = (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function')
                ? Auth.getCurrentUser()
                : null;

            let query = db.collection('devices');
            if (!isReviewer) {
                const currentUnit = (currentUser && currentUser.unit) ? String(currentUser.unit).trim() : '';
                if (!currentUnit) return [];
                query = query.where('unit', '==', currentUnit);
            }

            const snapshot = await query.get();
            if (!snapshot.empty) {
                const devices = [];
                snapshot.forEach(doc => {
                    const raw = doc.data() || {};
                    const normalized = this._normalizeDevice({ id: raw.id ?? doc.id, ...raw });
                    devices.push(normalized);
                });
                return this._sortDevicesById(devices);
            }
        } catch (e) {
            console.error('DB.getDevices error:', e);
        }

        return null; // null 表示尚未初始化
    },

    async saveDevices(devices) {
        try {
            const normalizedDevices = (devices || []).map(d => this._normalizeDevice(d));
            const deviceCollection = db.collection('devices');

            // 同步新結構：devices/{deviceId}
            const existingSnapshot = await deviceCollection.get();
            const batch = db.batch();
            const incomingIds = new Set();

            normalizedDevices.forEach(device => {
                const docId = String(device.id);
                incomingIds.add(docId);
                batch.set(deviceCollection.doc(docId), device);
            });

            existingSnapshot.forEach(doc => {
                if (!incomingIds.has(doc.id)) {
                    batch.delete(doc.ref);
                }
            });

            await batch.commit();
        } catch (e) {
            console.error('DB.saveDevices error:', e);
            alert('儲存設備資料失敗，請檢查網路連線。');
        }
    },

    // ===== 申請單 (applications) =====
    async getApplications() {
        try {
            const isReviewer = typeof Auth !== 'undefined' && typeof Auth.isReviewer === 'function' && Auth.isReviewer();
            const currentUser = (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function')
                ? Auth.getCurrentUser()
                : null;

            let query = db.collection('applications');
            if (!isReviewer) {
                const uid = currentUser ? currentUser.uid : '';
                if (!uid) return [];
                query = query.where('submittedBy', '==', uid);
            }

            const snapshot = await query.get();
            if (!snapshot.empty) {
                const applications = [];
                snapshot.forEach(doc => {
                    const raw = doc.data() || {};
                    const normalized = this._normalizeApplication({ id: raw.id ?? doc.id, ...raw });
                    applications.push(normalized);
                });
                return this._sortApplicationsById(applications);
            }
        } catch (e) {
            console.error('DB.getApplications error:', e);
        }

        return [];
    },

    async saveApplications(applications) {
        try {
            const normalizedApplications = (applications || []).map(a => this._normalizeApplication(a));
            const appCollection = db.collection('applications');
            const isReviewer = typeof Auth !== 'undefined' && typeof Auth.isReviewer === 'function' && Auth.isReviewer();
            const currentUser = (typeof Auth !== 'undefined' && typeof Auth.getCurrentUser === 'function')
                ? Auth.getCurrentUser()
                : null;
            const uid = currentUser ? currentUser.uid : '';

            const batch = db.batch();

            if (isReviewer) {
                // reviewer 可全量同步（含刪除）
                const existingSnapshot = await appCollection.get();
                const incomingIds = new Set();

                normalizedApplications.forEach(app => {
                    const docId = String(app.id);
                    incomingIds.add(docId);
                    batch.set(appCollection.doc(docId), app);
                });

                existingSnapshot.forEach(doc => {
                    if (!incomingIds.has(doc.id)) {
                        batch.delete(doc.ref);
                    }
                });

                await batch.commit();

            } else {
                // 一般使用者僅同步自己的申請（含刪除自己的）
                if (!uid) {
                    throw new Error('尚未登入，無法儲存申請資料');
                }

                const mine = normalizedApplications.filter(app => app.submittedBy === uid);
                const existingMineSnapshot = await appCollection.where('submittedBy', '==', uid).get();
                const incomingMineIds = new Set();

                mine.forEach(app => {
                    const docId = String(app.id);
                    incomingMineIds.add(docId);
                    batch.set(appCollection.doc(docId), app);
                });

                existingMineSnapshot.forEach(doc => {
                    if (!incomingMineIds.has(doc.id)) {
                        batch.delete(doc.ref);
                    }
                });

                await batch.commit();
            }
        } catch (e) {
            console.error('DB.saveApplications error:', e);
            if (e && (e.code === 'permission-denied' || String(e.message || '').includes('Missing or insufficient permissions'))) {
                alert('儲存申請資料失敗：目前帳號沒有寫入申請資料的權限，請聯絡管理員檢查 Firestore Rules。');
            } else {
                alert('儲存申請資料失敗，請檢查網路連線。');
            }
        }
    },

    // ===== 所屬單位 (ownerUnits) =====
    async getOwnerUnits() {
        try {
            const doc = await db.collection('collections').doc('ownerUnits').get();
            if (doc.exists && doc.data().items) {
                return doc.data().items;
            }
        } catch (e) {
            console.error('DB.getOwnerUnits error:', e);
        }
        return null; // null 表示尚未初始化，使用預設值
    },

    async saveOwnerUnits(units) {
        try {
            await db.collection('collections').doc('ownerUnits').set({ items: units });
        } catch (e) {
            console.error('DB.saveOwnerUnits error:', e);
            alert('儲存單位資料失敗，請檢查網路連線。');
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

        // applications 已採單筆文件，不需初始化空陣列
    }
};
