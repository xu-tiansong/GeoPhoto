/**
 * AutoFaceScan.js - 自动人脸识别进程
 *
 * 后台扫描照片库，对指定人物标签逐张识别未标注的照片。
 * 使用隐藏的 BrowserWindow 作为识别 worker（face-api.js 需要浏览器环境）。
 *
 * 状态存储（settings 表）：
 *   face_scan_tag_id       : 正在扫描的标签 ID，-1 表示无任务
 *   face_scan_last_photo_id: 最后处理的照片 ID（游标，用于断点续扫）
 *   face_scan_scanned      : 累计已扫张数（含历次会话）
 *   face_scan_total        : 本次任务总张数（用于进度显示）
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

class AutoFaceScan {
    /**
     * @param {import('./Database')} db
     * @param {Electron.BrowserWindow} mainWindow
     */
    constructor(db, mainWindow) {
        this.db           = db;
        this.mainWindow   = mainWindow;
        this.workerWindow = null;
        this.isRunning    = false;
        this.cancelled    = false;
    }

    /** 取消正在进行的扫描（异步生效，当前照片处理完毕后停止） */
    cancel() {
        if (!this.isRunning) return false;
        this.cancelled = true;
        return true;
    }

    /**
     * 立即销毁 worker 窗口（用于应用退出时强制清理，防止隐藏窗口阻塞进程退出）。
     * 与 cancel() 不同：不等待当前照片处理完毕，直接销毁窗口。
     * 注意：故意不清除数据库扫描状态，以便下次启动时由 checkAndResume 断点续扫。
     */
    destroy() {
        this.cancelled = true;
        if (this.workerWindow && !this.workerWindow.isDestroyed()) {
            this.workerWindow.destroy();
            this.workerWindow = null;
        }
        this.isRunning = false;
    }

    // ── 公开方法 ─────────────────────────────────────────────

    /**
     * 启动全局人脸扫描
     * @param {number} tagId - 人物标签 ID（必须已有 face descriptors）
     * @returns {{ success: boolean, error?: string }}
     */
    async start(tagId, mode = 'balanced') {
        // 检查互斥锁：同一时间只能扫描一个人物
        const state = this.db.getFaceScanState();
        if (state.tagId !== -1) {
            // 若对象本身未在运行（进程重启后遗留的脏状态），自动清除以允许新扫描
            if (!this.isRunning) {
                console.warn('AutoFaceScan: 检测到遗留扫描状态，自动清除');
                this.db.clearFaceScanState();
            } else {
                return { success: false, error: '每次只能扫描一个人物' };
            }
        }

        // 获取标签及其人脸特征向量
        const tagData = this.db.getTagById(tagId);
        if (!tagData || !tagData.descriptors || tagData.descriptors.length === 0) {
            return { success: false, error: '该标签没有人脸识别数据' };
        }

        // 读取上次扫描完成时记录的游标，仅扫描新照片
        const autoScanCursor = this.db.getTagAutoScanCursor(tagId);

        // 预先获取全部待扫描照片，计算总数
        const photos     = this.db.getPhotosForFaceScan(tagId, autoScanCursor);
        const grandTotal = photos.length;

        // 写入扫描状态标志（从游标位置开始 → lastPhotoId=autoScanCursor, scanned=0, total=grandTotal）
        this.db.saveFaceScanProgress(tagId, autoScanCursor, 0, grandTotal);

        // 异步执行扫描，不阻塞调用方
        this._startScan(tagId, tagData, photos, 0, grandTotal, mode).catch(err => {
            console.error('AutoFaceScan._startScan 错误:', err);
            this.db.clearFaceScanState();
            this.isRunning = false;
        });

        return { success: true };
    }

    // ── 内部方法 ─────────────────────────────────────────────

    /**
     * 扫描主循环
     * @param {number}   tagId        - 标签 ID
     * @param {object}   tagData      - 含 descriptors 的标签对象
     * @param {object[]} photos       - 待扫描照片列表（已预取）
     * @param {number}   startScanned - 本次开始前已累计扫描张数（断点续扫时 > 0）
     * @param {number}   grandTotal   - 本次任务总张数（包含已扫部分）
     */
    async _startScan(tagId, tagData, photos, startScanned, grandTotal, mode = 'balanced') {
        this.isRunning = true;

        // tagData.descriptors 来自 _mergeTagExtension，descriptor 字段未经 JSON.parse，仍为字符串
        const descriptors = (tagData.descriptors || []).map(d => {
            const raw = d.descriptor;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        });
        const tagName     = tagData.name;

        // 发送初始进度（体现已经扫过的部分）
        this._sendProgress(startScanned, grandTotal, tagId);

        if (photos.length === 0) {
            this._onScanComplete(tagId, tagName, 0, grandTotal);
            return;
        }

        // 创建隐藏 worker 窗口
        const worker = await this._createWorkerWindow();
        if (!worker) {
            this.db.clearFaceScanState();
            this.isRunning = false;
            return;
        }

        // 初始化 worker（加载模型 + 构建 FaceMatcher）
        const initOk = await this._initWorker(worker, tagId, descriptors, mode);
        if (!initOk) {
            console.error('AutoFaceScan: worker 初始化失败');
            if (!worker.isDestroyed()) worker.close();
            this.db.clearFaceScanState();
            this.isRunning = false;
            return;
        }

        let scanned = 0; // 本次会话新扫张数
        let matched = 0;

        for (let i = 0; i < photos.length; i++) {
            if (worker.isDestroyed() || this.cancelled) break;

            const photo    = photos[i];
            const fullPath = this._resolvePhotoPath(photo);

            if (fullPath) {
                const result = await this._processPhoto(worker, photo.id, fullPath);
                if (result.matched) {
                    this.db.linkTagToPhoto(photo.id, tagId);
                    matched++;
                }
            }

            scanned++;
            const totalScanned = startScanned + scanned;

            // 更新游标及累计进度
            this.db.saveFaceScanProgress(tagId, photo.id, totalScanned, grandTotal);

            // 发送进度更新（cumulative）
            this._sendProgress(totalScanned, grandTotal, tagId);

            // 每 10 张睡眠 500ms，避免长时间占用资源
            if (scanned % 10 === 0) {
                await this._sleep(500);
            }
        }

        // 关闭 worker 窗口
        if (!worker.isDestroyed()) worker.close();
        this.workerWindow = null;

        if (this.cancelled) {
            if (!worker.isDestroyed()) {
                // 用户主动取消（cancel() 被调用）：清除状态并通知 UI
                this._onScanCancelled(tagId, tagName);
            } else {
                // 应用正在退出（destroy() 被调用）：保留 DB 状态，下次启动由 checkAndResume 恢复
                this.isRunning = false;
                this.cancelled = false;
            }
        } else {
            this._onScanComplete(tagId, tagName, matched, grandTotal);
        }
    }

    /** 扫描被用户取消：清除状态 + 通知主窗口隐藏指示器 */
    _onScanCancelled(tagId, tagName) {
        this.db.clearFaceScanState();
        this.isRunning = false;
        this.cancelled = false;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('face-scan-cancelled', { tagId, tagName });
        }
    }

    /** 扫描完成：清除状态 + 更新标签游标 + 通知主窗口 */
    _onScanComplete(tagId, tagName, matched, total) {
        // 将游标更新为当前系统最大照片 ID，下次扫描从此之后开始
        const maxPhotoId = this.db.getMaxPhotoId();
        this.db.setTagAutoScanCursor(tagId, maxPhotoId);
        this.db.clearFaceScanState();
        this.isRunning = false;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            // 查询该标签累计识别出的照片总数（含历次会话）
            const taggedTotal = this.db.countPhotosByTag(tagId);
            this.mainWindow.webContents.send('face-scan-complete', { tagId, tagName, matched, total, taggedTotal });
        }
    }

    /** 解析照片完整路径 */
    _resolvePhotoPath(photo) {
        const enriched = this.db.addFullPathToPhoto({ ...photo });
        return enriched && !enriched.isMissing ? enriched.fullPath : null;
    }

    /** 创建隐藏的 face-api worker BrowserWindow */
    _createWorkerWindow() {
        return new Promise((resolve) => {
            const win = new BrowserWindow({
                show: false,
                webPreferences: {
                    nodeIntegration:  true,
                    contextIsolation: false
                }
            });
            win.loadFile(path.join(__dirname, '..', 'face-scan-worker.html'));
            win.webContents.once('dom-ready', () => resolve(win));
            win.on('closed', () => {
                if (this.workerWindow === win) this.workerWindow = null;
            });
            this.workerWindow = win;
        });
    }

    /** 等待 worker 加载完毕并初始化（face-worker-ready 信号） */
    _initWorker(worker, tagId, descriptors, mode = 'balanced') {
        return new Promise((resolve) => {
            let done = false;
            const handler = (_event, result) => {
                if (done) return;
                done = true;
                resolve(result.success);
            };
            ipcMain.once('face-worker-ready', handler);
            worker.webContents.send('face-worker-init', { tagId, descriptors, mode });
            // 超时保护（模型从 CDN 加载可能较慢，给 60 秒）
            setTimeout(() => {
                if (!done) {
                    done = true;
                    ipcMain.removeListener('face-worker-ready', handler);
                    resolve(false);
                }
            }, 60000);
        });
    }

    /** 向 worker 发送单张照片处理请求，等待结果 */
    _processPhoto(worker, photoId, photoPath) {
        return new Promise((resolve) => {
            let done = false;
            const handler = (_event, result) => {
                if (result.photoId !== photoId) return; // 忽略不匹配的结果
                if (done) return;
                done = true;
                ipcMain.removeListener('face-worker-result', handler);
                resolve(result);
            };
            ipcMain.on('face-worker-result', handler);

            if (!worker.isDestroyed()) {
                worker.webContents.send('face-worker-process', { photoId, photoPath });
            }

            // 超时保护（每张照片 30 秒）
            setTimeout(() => {
                if (!done) {
                    done = true;
                    ipcMain.removeListener('face-worker-result', handler);
                    resolve({ photoId, matched: false, timeout: true });
                }
            }, 30000);
        });
    }

    /** 向主窗口发送扫描进度 */
    _sendProgress(scanned, total, tagId) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('face-scan-progress', { scanned, total, tagId });
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ── 静态方法 ─────────────────────────────────────────────

    /**
     * 应用启动时检查并自动恢复中断的扫描任务
     * @param {import('./Database')} db
     * @param {Electron.BrowserWindow} mainWindow
     * @returns {AutoFaceScan|null}
     */
    static checkAndResume(db, mainWindow) {
        const state = db.getFaceScanState();
        if (state.tagId === -1) return null;

        // 验证标签仍存在且有人脸数据
        const tagData = db.getTagById(state.tagId);
        if (!tagData || !tagData.descriptors || tagData.descriptors.length === 0) {
            db.clearFaceScanState();
            return null;
        }

        // 只获取尚未扫描的剩余照片
        const remainingPhotos = db.getPhotosForFaceScan(state.tagId, state.lastPhotoId);

        // 兼容旧版（未保存 total/scanned 的扫描状态）：回退到用剩余张数估算
        const grandTotal   = state.total > 0 ? state.total : (state.scanned + remainingPhotos.length);
        const startScanned = state.total > 0 ? state.scanned : 0;

        console.log(`AutoFaceScan: 恢复扫描 "${tagData.name}"，从 photo id ${state.lastPhotoId} 继续（已扫 ${startScanned}/${grandTotal}）`);

        const scanner = new AutoFaceScan(db, mainWindow);
        scanner._startScan(state.tagId, tagData, remainingPhotos, startScanned, grandTotal, 'balanced').catch(err => {
            console.error('AutoFaceScan 恢复失败:', err);
            db.clearFaceScanState();
        });
        return scanner;
    }
}

module.exports = AutoFaceScan;
