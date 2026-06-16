// ============================================================================
//  PhotoEditWindow.js
//  始终置顶的「照片编辑工具」窗体管理类（Electron 主进程侧）
//
//  设计目标：
//    - 单例：同一时间只存在一个编辑窗体，再次打开会聚焦已有窗体并切换照片
//    - 始终置顶（alwaysOnTop）、无边框（frame:false，标题栏自绘）、可拖动
//    - 320x420 默认尺寸，可折叠为一行图标（折叠时由渲染进程调用 setSize）
//    - 与「调用方窗口」(opener，通常是 photo-window) 解耦：
//        编辑窗 → 主进程 → 转发回 opener
//
//  IPC 约定：
//    渲染→主：
//      'open-photo-edit-window'  (handle)  opener 请求打开，携带 photoData
//      'photo-edit-close'                  关闭窗体（退出编辑）
//      'photo-edit-apply'                  应用编辑，携带编辑参数 edits
//      'photo-edit-cancel'                 取消编辑
//      'photo-edit-set-collapsed'          折叠/展开 {collapsed:boolean}
//    主→编辑窗：
//      'photo-edit-load'                   下发当前照片 photoData
//    主→opener（转发）：
//      'photo-edit-applied'                编辑已应用，携带 {photo, edits}
//      'photo-edit-cancelled'              编辑已取消，携带 {photo}
// ============================================================================

const { BrowserWindow, ipcMain, webContents, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/** @type {BrowserWindow|null} 单例窗体引用 */
let editWin = null;
/** @type {number|null} 发起方 webContents id，用于把结果转发回去 */
let openerWcId = null;
/** @type {object|null} 当前正在编辑的照片数据 */
let currentPhoto = null;
/** 本次编辑是否已有最终结果（applied/cancelled），保证只回传一次 */
let settled = false;
/** @type {object|null} Database 实例，用于持久化窗体尺寸/位置 */
let dbRef = null;
/** 折叠状态（折叠时不持久化窗高，避免把一行高度记成展开尺寸） */
let isCollapsed = false;
/** 记住的展开高度（折叠/展开切换时用） */
let expandedHeight = 420;

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 420;
const COLLAPSED_HEIGHT = 72;
const WIN_STATE_KEY = 'photo_edit_win_state';

/**
 * 打开（或聚焦并复用）照片编辑窗体。
 * @param {object} photoData            当前照片数据 {id, directory, filename, ...}
 * @param {number} openerWebContentsId  发起方窗口的 webContents id（结果回传目标）
 */
/** 读取持久化的窗体尺寸/位置，并校验位置仍在某个显示器可视区域内。 */
function loadWinState() {
    // 注意：Database.getSetting 对以 { 开头的值会自动 JSON.parse，返回对象
    let st = dbRef ? dbRef.getSetting(WIN_STATE_KEY) : null;
    if (typeof st === 'string') { try { st = JSON.parse(st); } catch (_e) { st = null; } }

    const out = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, x: undefined, y: undefined };
    if (st) {
        if (Number.isFinite(st.width)  && st.width  >= 280) out.width  = st.width;
        if (Number.isFinite(st.height) && st.height >= 200) out.height = st.height;
        // 仅当保存的位置仍落在某个显示器工作区内才恢复，避免窗体跑到屏幕外
        if (Number.isFinite(st.x) && Number.isFinite(st.y)) {
            const onScreen = screen.getAllDisplays().some(d => {
                const wa = d.workArea;
                return st.x >= wa.x - 40 && st.y >= wa.y - 10 &&
                       st.x <= wa.x + wa.width - 40 && st.y <= wa.y + wa.height - 40;
            });
            if (onScreen) { out.x = st.x; out.y = st.y; }
        }
    }
    expandedHeight = out.height;
    return out;
}

/** 持久化当前窗体尺寸/位置（折叠时保留展开高度，仅更新位置与宽度）。 */
function saveWinState() {
    if (!dbRef || !editWin || editWin.isDestroyed()) return;
    const b = editWin.getBounds();
    if (!isCollapsed) expandedHeight = b.height;
    const state = { x: b.x, y: b.y, width: b.width, height: expandedHeight };
    try { dbRef.saveSetting(WIN_STATE_KEY, state); } catch (_e) { /* 忽略写盘失败；saveSetting 会自行序列化对象 */ }
}

function openPhotoEditWindow(photoData, openerWebContentsId) {
    currentPhoto = photoData || null;
    openerWcId = openerWebContentsId != null ? openerWebContentsId : null;
    settled = false;
    isCollapsed = false;

    // 已存在则复用：聚焦并切换照片，不重复创建
    if (editWin && !editWin.isDestroyed()) {
        editWin.focus();
        editWin.webContents.send('photo-edit-load', currentPhoto);
        return;
    }

    const st = loadWinState();
    editWin = new BrowserWindow({
        width: st.width,
        height: st.height,
        x: st.x,               // undefined 时由系统居中
        y: st.y,
        minWidth: 280,
        minHeight: 0,          // 允许折叠到很矮的一行
        frame: false,          // 无系统边框，标题栏自绘
        resizable: true,
        alwaysOnTop: true,     // 始终置顶
        skipTaskbar: true,     // 不在任务栏单独占位
        backgroundColor: '#1e1e1e',
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    editWin.setMenuBarVisibility(false);
    // 置顶层级设为浮动面板，确保盖在普通窗口之上
    editWin.setAlwaysOnTop(true, 'floating');
    editWin.loadFile(path.join(__dirname, '..', 'photo-edit-window.html'));

    // 用户拖动调整尺寸/移动位置时持久化（'resized'/'moved' 仅用户操作触发，
    // 程序化的折叠 setSize 不会触发，故不会污染记忆的尺寸）
    editWin.on('resized', saveWinState);
    editWin.on('moved', saveWinState);

    editWin.once('ready-to-show', () => {
        if (editWin && !editWin.isDestroyed()) {
            editWin.show();
            editWin.webContents.send('photo-edit-load', currentPhoto);
        }
    });

    editWin.on('closed', () => {
        // 兜底：任何未经「应用」的关闭路径都视为取消，让照片窗恢复原图
        settleCancel();
        editWin = null;
        openerWcId = null;
        currentPhoto = null;
    });
}

/** 把消息安全地转发回发起方窗口。 */
function sendToOpener(channel, payload) {
    if (openerWcId == null) return;
    const wc = webContents.fromId(openerWcId);
    if (wc && !wc.isDestroyed()) {
        wc.send(channel, payload);
    }
}

/** 结算为「已应用」，仅一次。 */
function settleApply(edits) {
    if (settled) return;
    settled = true;
    sendToOpener('photo-edit-applied', { photo: currentPhoto, edits });
}

/** 结算为「已取消」，仅一次——通知照片窗清除预览、恢复原图。 */
function settleCancel() {
    if (settled) return;
    settled = true;
    sendToOpener('photo-edit-cancelled', { photo: currentPhoto });
}

function closeEditWindow() {
    if (editWin && !editWin.isDestroyed()) {
        editWin.close();
    }
}

// canvas 能重新编码的栅格格式（用于判断「覆盖原图」能否原地写回）
const ENCODABLE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * 注册全部 IPC 处理器（在 main.js 的 registerIpcHandlers 中调用一次）。
 * @param {object} db - Database 实例，用于「另存副本」入库及 HEIC 覆盖时的改名
 */
function registerIPC(db) {
    dbRef = db;

    // opener 请求打开编辑窗
    ipcMain.handle('open-photo-edit-window', (event, photoData) => {
        openPhotoEditWindow(photoData, event.sender.id);
        return true;
    });

    // 实时预览：编辑窗每次参数变化都转发给 opener（照片窗）做无损 CSS 预览
    ipcMain.on('photo-edit-preview', (_event, edits) => {
        sendToOpener('photo-edit-preview', { edits });
    });

    // 关闭 / 退出编辑（不应用）→ 视为取消，恢复原图
    ipcMain.on('photo-edit-close', () => {
        settleCancel();
        closeEditWindow();
    });

    // 应用编辑：转发回 opener，再关闭
    ipcMain.on('photo-edit-apply', (_event, edits) => {
        settleApply(edits);
        closeEditWindow();
    });

    // 取消编辑：恢复原图，再关闭
    ipcMain.on('photo-edit-cancel', () => {
        settleCancel();
        closeEditWindow();
    });

    // 落盘：把渲染好的 dataURL 写入磁盘。
    //  mode === 'overwrite' 覆盖原图：
    //     - 原图扩展名可被 canvas 重新编码（jpg/png/webp）→ 原地写回，不动数据库
    //     - 原图为 HEIC 等不可编码格式 → 写 `<base>.jpg`、删除原文件，并用 movePhoto
    //       更新该记录的 filename（保持同一 id / time / lat / lng / 标签），返回新文件名
    //  mode === 'copy' 另存副本：
    //     - 写 `<base>_edited.<ext>`（重名追加序号），并 addEditedCopy 入库为独立照片，
    //       继承原图 time/lat/lng/tags，返回新照片完整记录供跳转
    ipcMain.handle('save-edited-photo', (_event, payload) => {
        try {
            const { mode, directory, filename, fullPath, dataUrl, originalPhotoId } = payload || {};
            const m = /^data:(image\/\w+);base64,([\s\S]+)$/.exec(dataUrl || '');
            if (!m) return { success: false, error: 'invalid dataUrl' };
            const buf = Buffer.from(m[2], 'base64');

            const srcPath = fullPath || path.join(directory || '', filename || '');
            const dir = path.dirname(srcPath);
            const renderedExt = m[1] === 'image/png' ? '.png' : '.jpg';
            const origExt = path.extname(filename || '').toLowerCase();
            const base = path.basename(filename || 'photo', path.extname(filename || ''));

            // -------- 覆盖原图 --------
            if (mode === 'overwrite') {
                if (ENCODABLE_EXT.has(origExt)) {
                    // 原地写回，文件名/扩展名不变，无需数据库操作
                    fs.writeFileSync(srcPath, buf);
                    return { success: true, mode: 'overwrite', path: srcPath, filename, renamed: false };
                }
                // 不可编码格式（HEIC 等）：写 .jpg 取代原文件，并改名数据库记录
                const newName = `${base}${renderedExt}`;
                const newPath = path.join(dir, newName);
                fs.writeFileSync(newPath, buf);
                if (newPath !== srcPath && fs.existsSync(srcPath)) {
                    try { fs.unlinkSync(srcPath); } catch (_e) { /* 原文件可能被占用，忽略 */ }
                }
                if (db && originalPhotoId != null) {
                    db.movePhoto(originalPhotoId, directory, newName);
                }
                return { success: true, mode: 'overwrite', path: newPath, filename: newName, renamed: true };
            }

            // -------- 另存副本 --------
            let outName = `${base}_edited${renderedExt}`;
            let outPath = path.join(dir, outName);
            let i = 2;
            while (fs.existsSync(outPath)) {
                outName = `${base}_edited_${i}${renderedExt}`;
                outPath = path.join(dir, outName);
                i++;
            }
            fs.writeFileSync(outPath, buf);

            let newPhoto = null;
            if (db && originalPhotoId != null) {
                const newId = db.addEditedCopy(originalPhotoId, directory, outName);
                const row = db.getPhotoById(newId);
                newPhoto = db.addFullPathToPhoto ? db.addFullPathToPhoto(row) : row;
            }
            return { success: true, mode: 'copy', path: outPath, filename: outName, photo: newPhoto };
        } catch (err) {
            return { success: false, error: String((err && err.message) || err) };
        }
    });

    // 折叠/展开（由渲染进程驱动）。折叠收到一行高度，展开恢复记忆的展开高度。
    // 用程序化 setSize，不触发 'resized'，因此不会覆盖持久化的展开尺寸。
    ipcMain.on('photo-edit-set-collapsed', (_event, { collapsed }) => {
        if (!editWin || editWin.isDestroyed()) return;
        const b = editWin.getBounds();
        if (collapsed) {
            expandedHeight = b.height;          // 折叠前先记住当前展开高度
            isCollapsed = true;
            editWin.setSize(b.width, COLLAPSED_HEIGHT);
        } else {
            isCollapsed = false;
            editWin.setSize(b.width, Math.round(expandedHeight || DEFAULT_HEIGHT));
        }
    });
}

module.exports = { registerIPC, openPhotoEditWindow };
