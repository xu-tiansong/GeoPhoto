/**
 * fix-inferred-locations.js —— 一次性数据修复
 *
 * 老版本扫描代码（main.old.js）给没有 GPS 的视频推断位置时没有时间窗口限制：
 * 直接把"时间最接近的那张带 GPS 照片"的坐标抄过来，哪怕相差几个月。
 * 现在的 PhotoFilesManager 已加上 1 小时窗口，但库里的老数据还在。
 *
 * 本脚本找出这类记录并清空其坐标，让它们回到"无定位"状态，
 * 之后完整扫描时若有 Takeout json 会填回真实坐标。
 *
 * 默认只清除时间差超过 24 小时的：相差几小时的照片还算同一次外出，坐标作为近似值有参考价值；
 * 隔天以上的就纯属张冠李戴了。用 --min-gap-hours 可以调整这个界限。
 *
 * 用法（必须用 Electron 的 node 运行，better-sqlite3 是按 Electron ABI 编译的）：
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/fix-inferred-locations.js          # 只列清单
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/fix-inferred-locations.js --apply  # 实际清除
 *   ... --apply --min-gap-hours=1    # 更激进：1 小时以外的全清
 */

const path = require('path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const DB_PATH = path.join(__dirname, '..', 'photos.db');
const APPLY = process.argv.includes('--apply');
const ONE_HOUR_MS = 3600000;

const gapArg = process.argv.find(a => a.startsWith('--min-gap-hours='));
const MIN_GAP_HOURS = gapArg ? Number(gapArg.split('=')[1]) : 24;

const db = new Database(DB_PATH, { readonly: !APPLY });

// 判定依据：
// 视频自己的 GPS 是独立定位，浮点值几乎不可能和某张照片的坐标一模一样；
// 而推断出来的坐标是从照片"抄"过来的，必然完全相等。
// 于是：坐标与某张照片完全相同，但 ±1 小时内没有任何一张同坐标的照片
//      → 按现在的规则根本推不出这个坐标，只能是老代码无窗口抄来的。
const coordTimes = new Map(); // "lat,lng" -> 该坐标上所有照片的时间戳（升序）
for (const p of db.prepare(`
    SELECT lat, lng, time FROM photos
    WHERE type = 'photo' AND lat IS NOT NULL AND time IS NOT NULL AND directory != 'Bin'
`).all()) {
    const t = new Date(p.time).getTime();
    if (isNaN(t)) continue;
    const key = p.lat + ',' + p.lng;
    const arr = coordTimes.get(key);
    if (arr) arr.push(t); else coordTimes.set(key, [t]);
}
for (const arr of coordTimes.values()) arr.sort((a, b) => a - b);

// 该坐标上是否存在与 t 相差 1 小时以内的照片
function hasPhotoNearby(key, t) {
    const arr = coordTimes.get(key);
    if (!arr) return false;
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (Math.abs(arr[mid] - t) <= ONE_HOUR_MS) return true;
        if (arr[mid] < t) lo = mid + 1; else hi = mid - 1;
    }
    for (let i = Math.max(0, lo - 1); i < Math.min(arr.length, lo + 2); i++) {
        if (Math.abs(arr[i] - t) <= ONE_HOUR_MS) return true;
    }
    return false;
}

// 最近一张同坐标照片的时间差（仅用于展示）
function nearestGap(key, t) {
    const arr = coordTimes.get(key) || [];
    let best = Infinity;
    for (const x of arr) best = Math.min(best, Math.abs(x - t));
    return best;
}

// 候选：有坐标的视频。edited=1 的是用户手工设过的，不动
const videos = db.prepare(`
    SELECT id, directory, filename, time, lat, lng FROM photos
    WHERE type = 'video' AND lat IS NOT NULL AND time IS NOT NULL
      AND directory != 'Bin' AND COALESCE(edited, 0) != 1
`).all();

const suspects = [];
for (const v of videos) {
    const t = new Date(v.time).getTime();
    if (isNaN(t)) continue;
    const key = v.lat + ',' + v.lng;
    if (!coordTimes.has(key)) continue;       // 坐标不等于任何照片 → 多半是视频自带 GPS，保留
    if (hasPhotoNearby(key, t)) continue;     // 1 小时内有同坐标照片 → 合理推断，保留
    suspects.push({ ...v, gapHours: nearestGap(key, t) / ONE_HOUR_MS });
}

console.log(`带坐标的视频（未手工编辑过）: ${videos.length}`);
console.log(`坐标无法用"1 小时内同坐标照片"解释的: ${suspects.length}\n`);

const buckets = { '1-6h': 0, '6-24h': 0, '1-7天': 0, '7-30天': 0, '30天-1年': 0, '>1年': 0 };
for (const s of suspects) {
    const h = s.gapHours;
    if (h < 6) buckets['1-6h']++;
    else if (h < 24) buckets['6-24h']++;
    else if (h < 24 * 7) buckets['1-7天']++;
    else if (h < 24 * 30) buckets['7-30天']++;
    else if (h < 24 * 365) buckets['30天-1年']++;
    else buckets['>1年']++;
}
console.log('与最近的同坐标照片相差:');
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(10)} ${v} 条`);

const targets = suspects.filter(s => s.gapHours > MIN_GAP_HOURS);
console.log(`\n阈值 ${MIN_GAP_HOURS} 小时 → 实际处理 ${targets.length} 条，保留 ${suspects.length - targets.length} 条（时间接近，坐标仍有参考价值）\n`);

const byDir = {};
for (const s of targets) byDir[s.directory] = (byDir[s.directory] || 0) + 1;
console.log('按目录分布:');
for (const [d, c] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(3)} 条  ${d}`);
}

console.log('\n明细:');
for (const s of targets) {
    console.log(`  [${s.id}] ${s.time}  相差 ${s.gapHours.toFixed(1)}h  ${s.directory}\\${s.filename}`);
}

if (!APPLY) {
    console.log('\n(未加 --apply，以上仅为清单，数据库未改动)');
    db.close();
    return;
}

const stmt = db.prepare('UPDATE photos SET lat = NULL, lng = NULL WHERE id = ? AND COALESCE(edited, 0) != 1');
let changed = 0;
db.transaction(() => {
    for (const s of targets) changed += stmt.run(s.id).changes;
})();

console.log(`\n已清除 ${changed} 条记录的坐标。`);
db.close();
