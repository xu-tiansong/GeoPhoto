/**
 * AutoDupScan.js - 自动重复照片移除进程
 *
 * 后台扫描照片库，找出拍摄时间、拍摄位置、照片尺寸均相同的照片组，
 * 仅保留文件最大的一张，其余移入 Bin。
 *
 * 状态存储（settings 表）：
 *   dup_scan_done_count : 已处理的组数，-1 表示无任务
 *   dup_scan_total      : 本次扫描总组数（用于进度显示）
 */

const fs   = require('fs');
const path = require('path');

class AutoDupScan {
    /**
     * @param {import('./Database')} db
     * @param {Electron.BrowserWindow} mainWindow
     * @param {Function} moveToBinFn      - (photoId, fullPath, dir, filename, remark) => void
     * @param {Function|null} confirmCallback - 逐组确认回调，签名：
     *   (photoData: object[], stats: object) => Promise<{ action: 'skip'|'interrupt'|'confirm', keepIndices?: number[] }>
     *   为 null 时走自动模式（保留最大文件）
     * @param {Function|null} onStop      - 扫描完成或终止后的回调（无参数）
     */
    constructor(db, mainWindow, moveToBinFn, confirmCallback = null, onStop = null) {
        this.db              = db;
        this.mainWindow      = mainWindow;
        this.moveToBinFn     = moveToBinFn;
        this.confirmCallback = confirmCallback;
        this.onStop          = onStop;
        this.isRunning       = false;
        this.cancelled       = false;
    }

    /** 终止正在进行的扫描（当前组处理完毕后停止） */
    cancel() {
        if (!this.isRunning) return false;
        this.cancelled = true;
        return true;
    }

    /**
     * 应用退出时强制停止（不清除 DB 状态，下次启动由 checkAndResume 恢复进度）
     */
    destroy() {
        this.cancelled = true;
        this.isRunning = false;
    }

    // ── 公开方法 ─────────────────────────────────────────────

    /**
     * 启动重复照片扫描
     * @returns {{ success: boolean, error?: string }}
     */
    async start() {
        if (this.isRunning) {
            return { success: false, error: 'already_running' };
        }

        // 查询所有重复组
        const groups = this.db.getPhotoDuplicateGroups();
        const total  = groups.length;

        // 写入初始状态
        this.db.saveDupScanProgress(0, total);

        // 异步执行，不阻塞调用方
        this._startScan(groups, 0, total).catch(err => {
            console.error('AutoDupScan._startScan 异常:', err);
            this.db.clearDupScanState();
            this.isRunning = false;
        });

        return { success: true };
    }

    // ── 内部方法 ─────────────────────────────────────────────

    /**
     * 扫描主循环
     * @param {object[]} groups      - 待检查的重复组列表
     * @param {number}   startDone   - 断点续扫时已完成的组数（仅用于进度计算）
     * @param {number}   grandTotal  - 本次任务总组数（含已完成的部分）
     */
    async _startScan(groups, startDone, grandTotal) {
        this.isRunning = true;
        this.cancelled = false;

        // 确认模式走两阶段流程（先算出准确的"需确认组数"），与自动模式分开处理
        if (this.confirmCallback) {
            return this._runConfirmMode(groups);
        }

        let removed  = 0;
        let doneDelta = 0; // 本次会话处理的组数

        // 发送初始进度
        this._sendProgress(startDone, grandTotal);

        for (let i = 0; i < groups.length; i++) {
            if (this.cancelled) break;

            try {
                const sets = this._findDuplicateSets(groups[i]);
                for (const set of sets) {
                    // 自动模式：每组同大小重复只保留第一张，移除其余
                    removed += this._removePhotos(set.slice(1));
                }
            } catch (err) {
                console.error('AutoDupScan: 处理组失败:', err.message);
            }

            if (this.cancelled) break;

            doneDelta++;
            const totalDone = startDone + doneDelta;
            this.db.saveDupScanProgress(totalDone, grandTotal);
            this._sendProgress(totalDone, grandTotal);

            // 每 5 组休眠 500ms，避免长期占用资源
            if (doneDelta % 5 === 0) {
                await this._sleep(500);
            }
        }

        const processedGroups = startDone + doneDelta;
        if (this.cancelled) {
            this._onCancelled(removed, processedGroups);
        } else {
            this._onComplete(removed, grandTotal);
        }
    }

    /**
     * 逐组确认模式：
     *  阶段一 — 校验所有候选组，筛出真正的重复组，得到准确的"需确认组数"；
     *  阶段二 — 逐组弹窗，由用户决定保留哪些。
     * 这样首次弹窗即可显示正确的总数（例如 1/3 而非 1/37）。
     * @param {object[]} candidateGroups - getPhotoDuplicateGroups() 粗筛出的候选组
     */
    async _runConfirmMode(candidateGroups) {
        let removed = 0;

        // ── 阶段一：按文件大小筛出真正的重复集合（只读大小，不解码图片，很快）──
        const qualifying = [];
        for (const group of candidateGroups) {
            if (this.cancelled) break;
            try {
                const sets = this._findDuplicateSets(group);
                for (const set of sets) qualifying.push(set);
            } catch (err) {
                console.error('AutoDupScan: 校验组失败:', err.message);
            }
        }

        const total = qualifying.length;

        // ── 阶段二：逐组弹窗确认 ──
        let processed = 0; // 已完成复核的组数（不含被中断的当前组）
        for (let i = 0; i < total; i++) {
            if (this.cancelled) break;

            const photoData = qualifying[i];
            // 展示前才读取像素尺寸（只读当前组，避免阶段一预先解码上万张图片）
            await this._fillDimensions(photoData);

            const stats = {
                groupIndex:   i + 1,
                totalGroups:  total,
                removedSoFar: removed
            };

            let result;
            try {
                result = await this.confirmCallback(photoData, stats);
            } catch (err) {
                console.error('AutoDupScan: confirmCallback 异常:', err.message);
                continue;
            }

            // 中断：当前组未完成，不计入已处理数
            if (result.action === 'interrupt') { this.cancelled = true; break; }

            processed = i + 1;
            this._sendProgress(processed, total);

            if (result.action === 'skip') continue;

            // 'confirm'：按索引保留用户选中的照片，移除其余
            const keepIndexSet = new Set(result.keepIndices);
            removed += this._removePhotos(photoData.filter((_, idx) => !keepIndexSet.has(idx)));
        }

        if (this.cancelled) {
            this._onCancelled(removed, processed);
        } else {
            this._onComplete(removed, total);
        }
    }

    /**
     * 在一个候选组（拍摄时间 + 位置相同）内找出真正的重复照片集合。
     *
     * 判据（满足其一即视为同一张照片）：
     *   1. 文件大小完全相同 —— 字节一致的副本；
     *   2. 基础文件名相同（去扩展名、忽略大小写）—— 同一张照片的不同格式/编码，
     *      如 IMG_7976.HEIC 与 IMG_7976.JPG，大小不同但是同一画面。
     * 用并查集合并：同组内只要两两满足上述任一条件即归为一簇。
     * 同一秒连拍的不同照片（如 IMG_2970 与 IMG_2971）文件名与大小都不同，不会被合并。
     * 仅读取文件大小（statSync）、不解码图片，速度快。
     *
     * @param {object} group  - 候选组 { time, lat, lng, ids }
     * @returns {Array<object[]>} 重复集合数组；每个集合为 [{ photo, fullPath, size, width:null, height:null }, ...]（≥2 张，按文件大小降序）
     */
    _findDuplicateSets(group) {
        const photoRecords = group.ids
            .map(id => this.db.getPhotoById(id))
            .filter(Boolean);

        if (photoRecords.length < 2) return [];

        // 读取每张照片的完整路径、文件大小、基础文件名
        const items = [];
        for (const photo of photoRecords) {
            const enriched = this.db.addFullPathToPhoto({ ...photo });
            if (!enriched || enriched.isMissing) continue;
            const fullPath = enriched.fullPath;

            let size;
            try { size = fs.statSync(fullPath).size; } catch (_) { continue; }

            const name = photo.filename || '';
            const base = path.basename(name, path.extname(name)).toLowerCase();
            items.push({ photo, fullPath, size, width: null, height: null, _base: base });
        }
        if (items.length < 2) return [];

        // 并查集：同大小 或 同基础文件名 → 合并为一簇
        const parent = items.map((_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                if (items[i].size === items[j].size ||
                    (items[i]._base && items[i]._base === items[j]._base)) {
                    union(i, j);
                }
            }
        }

        // 按簇根归组，保留 ≥2 张的簇
        const clusters = new Map();
        for (let i = 0; i < items.length; i++) {
            const r = find(i);
            if (!clusters.has(r)) clusters.set(r, []);
            clusters.get(r).push(items[i]);
        }

        const sets = [];
        for (const arr of clusters.values()) {
            if (arr.length >= 2) {
                arr.sort((a, b) => b.size - a.size); // 最大文件在前（建议保留）
                arr.forEach(it => delete it._base);
                sets.push(arr);
            }
        }
        return sets;
    }

    /**
     * 为展示读取一组照片的像素尺寸（确认窗口用，按需调用以避免预先解码全部图片）。
     * 直接就地填充 photoData 各项的 width/height。
     * @param {object[]} photoData
     */
    async _fillDimensions(photoData) {
        for (const item of photoData) {
            try {
                const dims = await this._getImageDimensions(item.fullPath);
                item.width  = dims.width;
                item.height = dims.height;
            } catch (_) {}
        }
    }

    /**
     * 将指定照片移入 Bin 并通知主窗口。
     * @param {object[]} toRemove - [{ photo, fullPath }, ...]
     * @returns {number} 实际移入 Bin 的数量
     */
    _removePhotos(toRemove) {
        for (const { photo, fullPath } of toRemove) {
            try {
                this.moveToBinFn(photo.id, fullPath, photo.directory, photo.filename, photo.remark);
                // 通知主窗口从地图移除照片标记
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('photo-deleted', { photoId: photo.id, fromDir: photo.directory, toDir: 'Bin' });
                }
            } catch (err) {
                console.error(`AutoDupScan: 移入 Bin 失败 [${fullPath}]:`, err.message);
            }
        }
        return toRemove.length;
    }

    /**
     * 读取图片像素尺寸。
     * JPEG：直接解析 SOF 段（不依赖 EXIF，始终可靠）；其他格式回退到 exifr。
     * @returns {{ width: number|null, height: number|null }}
     */
    async _getImageDimensions(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') {
            const dims = this._readJpegSofDimensions(filePath);
            if (dims) return dims;
        }
        // 非 JPEG 或 SOF 读取失败时回退到 exifr
        const exifr = await this._loadExifr();
        if (!exifr) return { width: null, height: null };
        try {
            const tags = await exifr.parse(filePath, {
                pick: ['PixelXDimension', 'PixelYDimension', 'ImageWidth', 'ImageHeight',
                       'ExifImageWidth', 'ExifImageHeight']
            });
            if (!tags) return { width: null, height: null };
            return {
                width:  tags.PixelXDimension  || tags.ExifImageWidth  || tags.ImageWidth  || null,
                height: tags.PixelYDimension  || tags.ExifImageHeight || tags.ImageHeight || null
            };
        } catch (_) { return { width: null, height: null }; }
    }

    /**
     * 从 JPEG 文件的 SOF 段同步读取图像尺寸（不依赖 EXIF）
     * @returns {{ width: number, height: number } | null}
     */
    _readJpegSofDimensions(filePath) {
        let fd;
        try {
            fd = fs.openSync(filePath, 'r');
            const buf = Buffer.alloc(2);
            fs.readSync(fd, buf, 0, 2, 0);
            if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // 非 JPEG
            let pos = 2;
            while (pos < 0xA00000) {
                fs.readSync(fd, buf, 0, 2, pos); pos += 2;
                if (buf[0] !== 0xFF) break;
                const m = buf[1];
                if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) ||
                    (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
                    const s = Buffer.alloc(7);
                    fs.readSync(fd, s, 0, 7, pos); // len(2)+precision(1)+height(2)+width(2)
                    return { height: s.readUInt16BE(3), width: s.readUInt16BE(5) };
                }
                if (m === 0xD9 || m === 0xDA) break; // EOI / SOS
                fs.readSync(fd, buf, 0, 2, pos);
                const segLen = buf.readUInt16BE(0);
                if (segLen < 2) break;
                pos += segLen;
            }
            return null;
        } catch (_) { return null; }
        finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
    }

    /** 缓存 exifr 模块的加载（dynamic import 只执行一次） */
    async _loadExifr() {
        if (this._exifrModule !== undefined) return this._exifrModule;
        try {
            // exifr 是纯 ESM 包，必须用 dynamic import
            const mod = await import('exifr');
            this._exifrModule = mod.default || mod;
        } catch (e) {
            console.warn('AutoDupScan: exifr 加载失败，跳过尺寸检查:', e.message);
            this._exifrModule = null;
        }
        return this._exifrModule;
    }

    /**
     * 扫描被用户终止：清除 DB 状态，通知主窗口
     * @param {number} removed   - 本次已移入 Bin 的文件数
     * @param {number} processed - 本次已处理的组数
     */
    _onCancelled(removed = 0, processed = 0) {
        // 清除 DB 状态，用户手动停止意味着不再继续
        this.db.clearDupScanState();
        this.isRunning = false;
        this.cancelled = false;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dup-scan-stopped', { removed, processed });
        }
        if (this.onStop) this.onStop();
    }

    /** 扫描完成：清除状态并通知主窗口 */
    _onComplete(removed, total) {
        this.db.clearDupScanState();
        this.isRunning = false;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dup-scan-complete', { removed, total });
        }
        if (this.onStop) this.onStop();
    }

    /** 向主窗口发送进度 */
    _sendProgress(done, total) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('dup-scan-progress', { done, total });
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ── 静态方法 ─────────────────────────────────────────────

    /**
     * 应用启动时检查并恢复中断的扫描任务
     * @param {import('./Database')} db
     * @param {Electron.BrowserWindow} mainWindow
     * @param {Function} moveToBinFn
     * @returns {AutoDupScan|null}
     */
    static checkAndResume(db, mainWindow, moveToBinFn) {
        const state = db.getDupScanState();
        if (state.doneCount === -1) return null; // 无进行中的任务

        // 重新查询剩余组（已处理的组的照片已移入 Bin，不会再出现在查询结果中）
        const remainingGroups = db.getPhotoDuplicateGroups();
        if (remainingGroups.length === 0) {
            // 没有剩余组，直接完成
            db.clearDupScanState();
            return null;
        }

        // grandTotal = 已完成 + 剩余
        const grandTotal   = state.doneCount + remainingGroups.length;
        const startDone    = state.doneCount;

        console.log(`AutoDupScan: 恢复扫描，已完成 ${startDone}/${grandTotal} 组，剩余 ${remainingGroups.length} 组`);

        // 更新 DB 中的 total（以免历史数据不一致）
        db.saveDupScanProgress(startDone, grandTotal);

        const scanner = new AutoDupScan(db, mainWindow, moveToBinFn);
        scanner._startScan(remainingGroups, startDone, grandTotal).catch(err => {
            console.error('AutoDupScan 恢复失败:', err);
            db.clearDupScanState();
        });
        return scanner;
    }
}

module.exports = AutoDupScan;
