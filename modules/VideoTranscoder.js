/**
 * VideoTranscoder.js - 借助 ffmpeg 处理 Chromium 不能解码的视频（mpg/avi/mts/wmv 等）
 *  - generateThumbnail: 截取一帧生成 .gpt 缩略图
 *  - prepareForPlayback: 转码成 H.264/AAC 的 mp4 缓存，供 <video> 播放
 * 仅在主进程使用。ffmpeg 查找顺序：npm 包 ffmpeg-static（若已安装）→ 系统 PATH。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

class VideoTranscoder {
    /**
     * @param {string} cacheDir 转码缓存目录（建议 app.getPath('userData')/video-cache）
     */
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this._ffmpeg = undefined;      // undefined=未查找, null=没有, string=可执行路径
        this._inflight = new Map();    // 同一文件的并发请求共用一次转码
    }

    /** 这些格式 Chromium 无法解码，直接走 ffmpeg */
    static needsFfmpeg(filename) {
        return /\.(mpg|mpeg|avi|mts|m2ts|vob|asf|wmv|flv|3g2)$/i.test(filename);
    }

    findFfmpeg() {
        if (this._ffmpeg !== undefined) return this._ffmpeg;
        let found = null;
        try {
            // ffmpeg-static 打进 asar 时可执行文件会被解到 app.asar.unpacked
            const p = require('ffmpeg-static');
            if (p) {
                const real = p.replace('app.asar', 'app.asar.unpacked');
                found = fs.existsSync(real) ? real : (fs.existsSync(p) ? p : null);
            }
        } catch (_) { /* 未安装，使用系统 ffmpeg */ }
        this._ffmpeg = found || 'ffmpeg';
        return this._ffmpeg;
    }

    _run(args, timeoutMs) {
        return new Promise((resolve, reject) => {
            execFile(this.findFfmpeg(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
                (err, _stdout, stderr) => {
                    if (!err) return resolve();
                    if (err.code === 'ENOENT') return reject(new Error('未找到 ffmpeg，请安装 ffmpeg 并加入 PATH'));
                    reject(new Error((stderr || err.message || '').toString().trim().split('\n').slice(-3).join(' ')));
                });
        });
    }

    /**
     * 生成缩略图（224px 以内，保持比例）。先跳过约 1 秒片头，再用 thumbnail 滤镜在
     * 后续帧里挑最有代表性的一帧，避免黑场。
     */
    async generateThumbnail(filePath, thumbPath) {
        const scale = 'scale=224:224:force_original_aspect_ratio=decrease';
        const attempt = (seek) => this._run([
            '-v', 'error', '-y',
            ...(seek ? ['-ss', '1'] : []),
            '-i', filePath,
            '-vf', `thumbnail=60,${scale}`,
            '-frames:v', '1', '-q:v', '3',
            '-f', 'image2', thumbPath
        ], 60000);
        try {
            await attempt(true);
            if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) return thumbPath;
        } catch (_) { /* 视频短于 1 秒时 -ss 会没有输出，退回从头取 */ }
        await attempt(false);
        if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size === 0) {
            throw new Error('ffmpeg 没有输出缩略图');
        }
        return thumbPath;
    }

    /**
     * 转码为可播放的 mp4（按 路径+大小+修改时间 缓存，源文件变了会重新转）
     * @returns {Promise<string>} mp4 缓存文件路径
     */
    prepareForPlayback(filePath) {
        const st = fs.statSync(filePath);
        const key = crypto.createHash('md5')
            .update(`${filePath}|${st.size}|${st.mtimeMs}`).digest('hex');
        const out = path.join(this.cacheDir, `${key}.mp4`);

        if (fs.existsSync(out) && fs.statSync(out).size > 0) return Promise.resolve(out);
        if (this._inflight.has(out)) return this._inflight.get(out);

        fs.mkdirSync(this.cacheDir, { recursive: true });
        const tmp = out + '.part.mp4';
        const job = this._run([
            '-v', 'error', '-y', '-i', filePath,
            '-map', '0:v:0', '-map', '0:a:0?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-vf', 'yadif=deint=interlaced,scale=trunc(iw/2)*2:trunc(ih/2)*2',   // 仅对标记为隔行的帧去隔行（DV/DVD 常见），宽高取偶数
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',
            tmp
        ], 30 * 60 * 1000)
            .then(() => { fs.renameSync(tmp, out); return out; })
            .catch((err) => { try { fs.unlinkSync(tmp); } catch (_) {} throw err; })
            .finally(() => this._inflight.delete(out));

        this._inflight.set(out, job);
        return job;
    }
}

module.exports = VideoTranscoder;
