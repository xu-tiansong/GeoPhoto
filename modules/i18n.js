/**
 * i18n.js - 国际化模块
 * 支持英文（en）和简体中文（zh）
 */

const translations = {
    en: {
        // ── 菜单 ──────────────────────────────────────────────
        'menu.photos': 'Photos',
        'menu.photos.setDirectory': 'Set Photo Directory',
        'menu.photos.directoryManagement': 'Photo Directory Management',
        'menu.photos.tagManagement': 'Tag Management',
        'menu.photos.backup': 'Backup Photos',
        'menu.photos.slideshow': 'Slideshow',
        'menu.photos.burst': 'Burst Photo Selection',
        'menu.photos.recognition': 'Photo Recognition',

        'menu.timeline': 'Timeline',
        'menu.timeline.settings': 'Timeline Settings',
        'menu.timeline.timeRange': 'Time Range Settings',

        'menu.map': 'Map',
        'menu.map.landmarks': 'Landmark Management',
        'menu.map.layers': 'Layer Settings',
        'menu.map.offline': 'Offline Map',
        'menu.map.routes': 'Travel Routes',

        'menu.system': 'System',
        'menu.system.fullscreen': 'Fullscreen Map',
        'menu.system.exitFullscreen': 'Exit Fullscreen',
        'menu.system.language': 'Language Settings',
        'menu.system.english': 'English',
        'menu.system.chinese': '简体中文',
        'menu.system.devtools': 'Developer Tools',
        'menu.system.about': 'About',
        'menu.system.quit': 'Quit',

        // ── 加载遮罩 ──────────────────────────────────────────
        'loading.scanning': 'Scanning files...',
        'loading.scanningDirs': 'Scanning directories... ({count} found)',
        'loading.processing': 'Processing {current}/{total} media files...',
        'loading.database': 'Writing to database...',

        // ── 扫描结果 ──────────────────────────────────────────
        'scan.skippedDir': 'This directory has already been scanned.\nTo rescan, delete the directory record from the database first.',
        'scan.completed': 'Scan complete!\n',
        'scan.summary': 'Found {totalPhotos} photos and {totalVideos} videos\n',
        'scan.newFiles': '{newPhotos} new photos and {newVideos} new videos added',
        'scan.noNewFiles': 'No new files ({skippedFiles} files already exist)',
        'scan.error': 'Scan error: {error}',

        // ── 关于 ──────────────────────────────────────────────
        'about.text': 'GeoPhoto v1.0\n\nA photo management application with map and timeline features.\n\n© 2026',

        // ── 开发中功能 ────────────────────────────────────────
        'feature.inDev': '{feature} is under development...',
        'feature.directoryManagement': 'Photo Directory Management',
        'feature.tagManagement': 'Tag Management',
        'feature.backup': 'Backup Photos',
        'feature.slideshow': 'Slideshow',
        'feature.burst': 'Burst Photo Selection',
        'feature.recognition': 'Photo Recognition',
        'feature.landmarks': 'Landmark Management',
        'feature.layers': 'Layer Settings',
        'feature.offline': 'Offline Map',
        'feature.routes': 'Travel Routes',

        // ── 语言切换 ──────────────────────────────────────────
        'lang.changed.en': 'Language changed to English',
        'lang.changed.zh': 'Language changed to Chinese',

        // ── 地图 ──────────────────────────────────────────────
        'map.loading': 'Loading...',
        'map.noLocation': 'No location data',
        'map.unknownDate': 'Unknown date',
        'map.unknownLocation': 'Unknown Location',
        'map.noPhotosInArea': 'No photos found in this area',
        'date.format': '{year}/{month}/{day}',

        // ── 时间轴 ────────────────────────────────────────────
        'timeline.days': 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',

        // ── 照片查看窗口 ──────────────────────────────────────
        'photo.title': 'Photo',
        'photo.zoomOut': 'Zoom Out',
        'photo.zoomIn': 'Zoom In',
        'photo.reset': 'Reset',
        'photo.tabInfo': 'Info',
        'photo.tabSimilar': 'Similar',
        'photo.tabTags': 'Tags',
        'photo.filename': 'Filename',
        'photo.directory': 'Directory',
        'photo.datetime': 'Date & Time',
        'photo.location': 'Location',
        'photo.coordinates': 'Coordinates',
        'photo.mapLocation': 'Map Location',
        'photo.remark': 'Remark',
        'photo.remarkPlaceholder': 'Add your notes here...',
        'photo.save': 'Save',
        'photo.like': 'Like this photo',
        'photo.liked': 'Liked',
        'photo.comingSoon': 'Coming soon...',
        'photo.addTag': 'Add Tag',
        'photo.matchTag': 'Match Tags',
        'photo.matching': 'Matching...',
        'photo.matchResult': 'Matched {count} tag(s)',
        'photo.matchNone': 'No matching tags found',
        'photo.loading': 'Loading...',
        'photo.failedLoad': 'Failed to load',
        'photo.noLocation': 'No location data',
        'photo.failedSave': 'Failed to save remark',

        // ── 照片管理窗口 ──────────────────────────────────────
        'manage.title': 'Photos Management',
        'manage.tabDirect': 'Direct',
        'manage.tabSelected': 'Selected',
        'manage.tabTag': 'Tag',
        'manage.directPlaceholder': 'Direct mode content will be here',
        'manage.tagPlaceholder': 'Tag management will be here',
        'manage.noPhotos': 'No photos to display',
        'manage.selected': 'Selected: ',
        'manage.photoCount': '{count} photo(s)',

        // ── 时间轴设置窗口 ────────────────────────────────────
        'tsw.title': 'Timeline Settings',
        'tsw.tabTimeline': 'Time Line',
        'tsw.tabRange': 'Time Range',
        'tsw.hourly': 'Hourly',
        'tsw.daily': 'Daily',
        'tsw.monthly': 'Monthly',
        'tsw.from': 'From:',
        'tsw.to': 'To:',
        'tsw.cancel': 'Cancel',
        'tsw.ok': 'OK',

        // ── 标签管理窗口 ──────────────────────────────────────
        'tmw.title': 'Tag Manager',
        'tmw.tab.faces': 'Faces',
        'tmw.tab.events': 'Events',
        'tmw.tab.locations': 'Locations',
        'tmw.tab.common': 'Common',
        'tmw.btn.add': '+ Add',
        'tmw.btn.addChild': '+ Child',
        'tmw.btn.edit': 'Edit',
        'tmw.btn.move': 'Move',
        'tmw.btn.delete': 'Delete',
        'tmw.btn.save': 'Save',
        'tmw.noSelection': 'Select a tag to view details',
        'tmw.tagInfo': 'Tag Info',
        'tmw.label.name': 'Name',
        'tmw.label.remark': 'Remark',
        'tmw.label.color': 'Color',
        'tmw.placeholder.name': 'Tag name',
        'tmw.placeholder.remark': 'Optional description',
        'tmw.move.title': 'Select New Parent',
        'tmw.move.makeRoot': 'Make Root',
        'tmw.move.cancel': 'Cancel',
        'tmw.move.confirm': 'Move Here',
        'tmw.cat.face.title': 'Face Settings',
        'tmw.cat.event.title': 'Event Settings',
        'tmw.cat.location.title': 'Location Settings',
        'tmw.cat.common.title': 'Additional Settings',
        'tmw.cat.face.placeholder': 'Face recognition descriptors will be managed here in a future update.',
        'tmw.cat.event.placeholder': 'Event time range and location settings will be configured here in a future update.',
        'tmw.cat.location.placeholder': 'Geographic coordinates, radius, and address will be set here in a future update.',
        'tmw.cat.common.placeholder': 'No additional settings for Common tags.',
        'tmw.tree.empty': 'No tags. Click \u201c+ Add\u201d to create one.',
        'tmw.input.placeholder': 'Tag name\u2026',
        'tmw.input.hint': 'Enter \u2713  Esc \u2717',
        'tmw.status.added': 'Tag added',
        'tmw.status.saved': 'Saved',
        'tmw.status.deleted': 'Deleted',
        'tmw.status.moved': 'Moved',
        'tmw.err.emptyName': 'Name cannot be empty',
        'tmw.err.addFailed': 'Failed to add tag',
        'tmw.err.saveFailed': 'Save failed',
        'tmw.err.deleteFailed': 'Delete failed',
        'tmw.err.moveFailed': 'Move failed',
        'tmw.confirm.deleteWithChildren': 'Delete \u201c{name}\u201d and all its {count} child tag(s)? This cannot be undone.',
        'tmw.confirm.delete': 'Delete tag \u201c{name}\u201d? This cannot be undone.',
        'tmw.face.reRecognize': 'Re-recognize',
        'tmw.face.dropHint': 'Drag & drop 3 single-person photos to recognize this person\'s face',
        'tmw.face.recognize': 'Start Recognition',
        'tmw.face.recognizing': 'Recognizing faces...',
        'tmw.face.success': 'Face recognition data saved successfully',
        'tmw.face.error.noFace': 'No face detected in image {n}',
        'tmw.face.error.multiFace': 'Multiple faces detected in image {n} \u2014 please use a single-person photo',
        'tmw.face.error.needPhotos': 'Please provide 3 photos',
        'tmw.face.error.loadModel': 'Failed to load face recognition models',
        'tmw.face.notLeaf': 'Face recognition can only be set on leaf tags (tags without children).',
        'tmw.face.hasDataNoChild': 'This tag has face data. Remove face data before adding child tags.',
        'tmw.face.descriptorCount': '{count} face descriptor(s) stored',
        'tmw.face.clearData': 'Clear Data',
        'tmw.face.clearConfirm': 'Clear all face recognition data for \u201c{name}\u201d? This cannot be undone.',
        'tmw.face.pickFace': 'Multiple faces detected in image {n}. Click the face you want to recognize:',
        'tmw.face.pickCancel': 'Cancel',
        'tmw.event.singleDay': 'Single Day',
        'tmw.event.multiDay': 'Multi-Day',
        'tmw.event.date': 'Date:',
        'tmw.event.start': 'Start:',
        'tmw.event.end': 'End:',
        'tmw.event.save': 'Save Dates',
        'tmw.event.clear': 'Clear',
        'tmw.event.saved': 'Event dates saved',
        'tmw.event.cleared': 'Event dates cleared',
        'tmw.event.noDate': 'No date set',
    },

    zh: {
        // ── 菜单 ──────────────────────────────────────────────
        'menu.photos': '照片',
        'menu.photos.setDirectory': '设置照片目录',
        'menu.photos.directoryManagement': '目录管理',
        'menu.photos.tagManagement': '标签管理',
        'menu.photos.backup': '备份照片',
        'menu.photos.slideshow': '幻灯片',
        'menu.photos.burst': '连拍筛选',
        'menu.photos.recognition': '照片识别',

        'menu.timeline': '时间轴',
        'menu.timeline.settings': '时间轴设置',
        'menu.timeline.timeRange': '时间范围设置',

        'menu.map': '地图',
        'menu.map.landmarks': '地标管理',
        'menu.map.layers': '图层设置',
        'menu.map.offline': '离线地图',
        'menu.map.routes': '旅行轨迹',

        'menu.system': '系统',
        'menu.system.fullscreen': '全屏地图',
        'menu.system.exitFullscreen': '退出全屏',
        'menu.system.language': '语言设置',
        'menu.system.english': 'English',
        'menu.system.chinese': '简体中文',
        'menu.system.devtools': '开发者工具',
        'menu.system.about': '关于',
        'menu.system.quit': '退出',

        // ── 加载遮罩 ──────────────────────────────────────────
        'loading.scanning': '正在扫描文件...',
        'loading.scanningDirs': '正在扫描目录... (已找到 {count} 个)',
        'loading.processing': '正在处理媒体文件 {current}/{total}...',
        'loading.database': '正在写入数据库...',

        // ── 扫描结果 ──────────────────────────────────────────
        'scan.skippedDir': '该目录已经扫描过，跳过扫描。\n如需重新扫描，请先从数据库删除该目录记录。',
        'scan.completed': '扫描完成！\n',
        'scan.summary': '目录中共有 {totalPhotos} 张照片和 {totalVideos} 个视频\n',
        'scan.newFiles': '其中新增 {newPhotos} 张照片和 {newVideos} 个视频',
        'scan.noNewFiles': '没有新增文件（{skippedFiles} 个文件已存在）',
        'scan.error': '扫描出错: {error}',

        // ── 关于 ──────────────────────────────────────────────
        'about.text': 'GeoPhoto v1.0\n\n一款带地图和时间轴功能的照片管理应用。\n\n© 2026',

        // ── 开发中功能 ────────────────────────────────────────
        'feature.inDev': '{feature}功能正在开发中...',
        'feature.directoryManagement': '照片目录管理',
        'feature.tagManagement': '标签管理',
        'feature.backup': '照片备份',
        'feature.slideshow': '幻灯片',
        'feature.burst': '连拍筛选',
        'feature.recognition': '照片识别',
        'feature.landmarks': '地标管理',
        'feature.layers': '图层设置',
        'feature.offline': '离线地图',
        'feature.routes': '旅行轨迹',

        // ── 语言切换 ──────────────────────────────────────────
        'lang.changed.en': 'Language changed to English',
        'lang.changed.zh': '语言已切换为简体中文',

        // ── 地图 ──────────────────────────────────────────────
        'map.loading': '加载中...',
        'map.noLocation': '无位置信息',
        'map.unknownDate': '未知日期',
        'map.unknownLocation': '未知位置',
        'map.noPhotosInArea': '在该矩形区域内没有找到照片',
        'date.format': '{year}年{month}月{day}日',

        // ── 时间轴 ────────────────────────────────────────────
        'timeline.days': '周日,周一,周二,周三,周四,周五,周六',

        // ── 照片查看窗口 ──────────────────────────────────────
        'photo.title': '照片',
        'photo.zoomOut': '缩小',
        'photo.zoomIn': '放大',
        'photo.reset': '重置',
        'photo.tabInfo': '信息',
        'photo.tabSimilar': '相似',
        'photo.tabTags': '标签',
        'photo.filename': '文件名',
        'photo.directory': '目录',
        'photo.datetime': '日期时间',
        'photo.location': '位置',
        'photo.coordinates': '坐标',
        'photo.mapLocation': '地图位置',
        'photo.remark': '备注',
        'photo.remarkPlaceholder': '在这里添加备注...',
        'photo.save': '保存',
        'photo.like': '喜欢这张照片',
        'photo.liked': '已喜欢',
        'photo.comingSoon': '即将推出...',
        'photo.addTag': '添加标签',
        'photo.matchTag': '匹配标签',
        'photo.matching': '匹配中...',
        'photo.matchResult': '匹配到 {count} 个标签',
        'photo.matchNone': '未找到匹配标签',
        'photo.loading': '加载中...',
        'photo.failedLoad': '加载失败',
        'photo.noLocation': '无位置信息',
        'photo.failedSave': '保存备注失败',

        // ── 照片管理窗口 ──────────────────────────────────────
        'manage.title': '照片管理',
        'manage.tabDirect': '直接',
        'manage.tabSelected': '已选',
        'manage.tabTag': '标签',
        'manage.directPlaceholder': '直接模式内容将显示在此处',
        'manage.tagPlaceholder': '标签管理将显示在此处',
        'manage.noPhotos': '没有照片可显示',
        'manage.selected': '已选: ',
        'manage.photoCount': '{count} 张',

        // ── 时间轴设置窗口 ────────────────────────────────────
        'tsw.title': '时间轴设置',
        'tsw.tabTimeline': '时间轴',
        'tsw.tabRange': '时间范围',
        'tsw.hourly': '小时',
        'tsw.daily': '日',
        'tsw.monthly': '月',
        'tsw.from': '从:',
        'tsw.to': '到:',
        'tsw.cancel': '取消',
        'tsw.ok': '确定',

        // ── 标签管理窗口 ──────────────────────────────────────
        'tmw.title': '标签管理',
        'tmw.tab.faces': '人物',
        'tmw.tab.events': '事件',
        'tmw.tab.locations': '地标',
        'tmw.tab.common': '其他',
        'tmw.btn.add': '+ 添加',
        'tmw.btn.addChild': '+ 子标签',
        'tmw.btn.edit': '编辑',
        'tmw.btn.move': '移动',
        'tmw.btn.delete': '删除',
        'tmw.btn.save': '保存',
        'tmw.noSelection': '选择一个标签查看详情',
        'tmw.tagInfo': '标签信息',
        'tmw.label.name': '名称',
        'tmw.label.remark': '备注',
        'tmw.label.color': '颜色',
        'tmw.placeholder.name': '标签名称',
        'tmw.placeholder.remark': '可选说明',
        'tmw.move.title': '选择新的父标签',
        'tmw.move.makeRoot': '设为根节点',
        'tmw.move.cancel': '取消',
        'tmw.move.confirm': '移动到此',
        'tmw.cat.face.title': '人物设置',
        'tmw.cat.event.title': '事件设置',
        'tmw.cat.location.title': '地标设置',
        'tmw.cat.common.title': '其他设置',
        'tmw.cat.face.placeholder': '人脸识别特征数据将在后续更新中提供管理功能。',
        'tmw.cat.event.placeholder': '事件时间范围和地点设置将在后续更新中提供。',
        'tmw.cat.location.placeholder': '地理坐标、覆盖半径和地址将在后续更新中设置。',
        'tmw.cat.common.placeholder': '其他类标签无附加设置。',
        'tmw.tree.empty': '暂无标签，点击\u201c+ 添加\u201d创建。',
        'tmw.input.placeholder': '标签名称\u2026',
        'tmw.input.hint': 'Enter \u2713  Esc \u2717',
        'tmw.status.added': '标签已添加',
        'tmw.status.saved': '已保存',
        'tmw.status.deleted': '已删除',
        'tmw.status.moved': '已移动',
        'tmw.err.emptyName': '名称不能为空',
        'tmw.err.addFailed': '添加标签失败',
        'tmw.err.saveFailed': '保存失败',
        'tmw.err.deleteFailed': '删除失败',
        'tmw.err.moveFailed': '移动失败',
        'tmw.confirm.deleteWithChildren': '删除\u201c{name}\u201d及其 {count} 个子标签？此操作不可撤销。',
        'tmw.confirm.delete': '删除标签\u201c{name}\u201d？此操作不可撤销。',
        'tmw.face.reRecognize': '重新识别',
        'tmw.face.dropHint': '拖放3张单人照片到下方框中，用于识别该人物的人脸',
        'tmw.face.recognize': '开始识别',
        'tmw.face.recognizing': '正在识别人脸...',
        'tmw.face.success': '人脸识别数据保存成功',
        'tmw.face.error.noFace': '图片 {n} 中未检测到人脸',
        'tmw.face.error.multiFace': '图片 {n} 中检测到多张人脸——请使用单人照片',
        'tmw.face.error.needPhotos': '请提供3张照片',
        'tmw.face.error.loadModel': '加载人脸识别模型失败',
        'tmw.face.notLeaf': '人脸识别只能设置在叶子标签（无子标签的标签）上。',
        'tmw.face.hasDataNoChild': '该标签已有人脸数据，移除人脸数据后才能添加子标签。',
        'tmw.face.descriptorCount': '已存储 {count} 条特征数据',
        'tmw.face.clearData': '清除数据',
        'tmw.face.clearConfirm': '清除\u300c{name}\u300d的所有人脸识别数据？此操作不可撤销。',
        'tmw.face.pickFace': '图片 {n} 中检测到多张人脸，请点击要识别的人脸：',
        'tmw.face.pickCancel': '取消',
        'tmw.event.singleDay': '单日',
        'tmw.event.multiDay': '多日',
        'tmw.event.date': '日期：',
        'tmw.event.start': '开始：',
        'tmw.event.end': '结束：',
        'tmw.event.save': '保存日期',
        'tmw.event.clear': '清除',
        'tmw.event.saved': '事件日期已保存',
        'tmw.event.cleared': '事件日期已清除',
        'tmw.event.noDate': '未设置日期',
    }
};

let currentLang = 'en';

/**
 * 设置当前语言
 */
function setLanguage(lang) {
    if (translations[lang]) {
        currentLang = lang;
    }
}

/**
 * 获取当前语言
 */
function getLanguage() {
    return currentLang;
}

/**
 * 翻译键值，支持 {placeholder} 插值
 */
function t(key, params = {}) {
    const dict = translations[currentLang] || translations.en;
    let str = dict[key] ?? translations.en[key] ?? key;
    return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}

/**
 * 将翻译应用到 DOM（通过 data-i18n 属性）
 * @param {Document} doc - 目标 document（默认当前 document）
 * @param {string} lang - 语言代码（可选，默认用 currentLang）
 */
function applyToDOM(doc, lang) {
    if (typeof document === 'undefined' && !doc) return;
    const d = doc || document;
    if (lang) setLanguage(lang);

    d.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
    d.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });
    d.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = t(key);
    });
}

module.exports = { translations, setLanguage, getLanguage, t, applyToDOM };
