/**
 * ThumbnailGenerator.js - 缩略图生成和缓存工具
 * 自动检查和生成 .gpt 格式的缩略图文件
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

class ThumbnailGenerator {
    constructor() {
        this.thumbnailSize = 224; // 缩略图尺寸
    }

    /**
     * 获取缩略图路径（如果存在）或原始文件路径
     * @param {string} originalPath - 原始文件路径
     * @returns {Object} { path: string, isThumbnail: boolean }
     */
    getThumbnailPath(originalPath) {
        const dir = path.dirname(originalPath);
        const ext = path.extname(originalPath);
        const basename = path.basename(originalPath, ext);
        const thumbnailPath = path.join(dir, `${basename}.gpt`);

        // 检查缩略图是否存在
        if (fs.existsSync(thumbnailPath)) {
            return { path: thumbnailPath, isThumbnail: true };
        }

        return { path: originalPath, isThumbnail: false };
    }

    /**
     * 删除指定原图对应的 .gpt 缩略图缓存（用于强制重建）
     * @param {string} originalPath - 原始文件路径
     * @returns {boolean} 是否删除了文件
     */
    deleteThumbnailCache(originalPath) {
        const dir = path.dirname(originalPath);
        const ext = path.extname(originalPath);
        const basename = path.basename(originalPath, ext);
        const thumbnailPath = path.join(dir, `${basename}.gpt`);
        try {
            if (fs.existsSync(thumbnailPath)) { fs.unlinkSync(thumbnailPath); return true; }
        } catch (err) {
            console.error('删除缩略图缓存失败:', err);
        }
        return false;
    }

    toFileUrl(filePath) {
        try {
            return pathToFileURL(path.resolve(filePath)).href;
        } catch (err) {
            return `file:///${String(filePath).replace(/\\/g, '/')}`;
        }
    }

    /**
     * 生成并保存缩略图
     * @param {HTMLImageElement|HTMLVideoElement} mediaElement - 媒体元素
     * @param {string} originalPath - 原始文件路径
     * @returns {Promise<string>} 缩略图路径
     */
    async generateAndSaveThumbnail(mediaElement, originalPath) {
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // 获取原始尺寸
                let width, height;
                if (mediaElement.tagName === 'VIDEO') {
                    width = mediaElement.videoWidth;
                    height = mediaElement.videoHeight;
                } else {
                    width = mediaElement.naturalWidth;
                    height = mediaElement.naturalHeight;
                }

                // 计算缩略图尺寸（保持宽高比）
                let thumbWidth, thumbHeight;
                if (width > height) {
                    thumbWidth = this.thumbnailSize;
                    thumbHeight = Math.round((height / width) * this.thumbnailSize);
                } else {
                    thumbHeight = this.thumbnailSize;
                    thumbWidth = Math.round((width / height) * this.thumbnailSize);
                }

                canvas.width = thumbWidth;
                canvas.height = thumbHeight;

                // 绘制缩略图
                ctx.drawImage(mediaElement, 0, 0, thumbWidth, thumbHeight);

                // 转换为 blob
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to generate thumbnail blob'));
                        return;
                    }

                    // 读取 blob 为 buffer
                    const reader = new FileReader();
                    reader.onload = () => {
                        const buffer = Buffer.from(reader.result);
                        
                        // 保存为 .gpt 文件
                        const dir = path.dirname(originalPath);
                        const ext = path.extname(originalPath);
                        const basename = path.basename(originalPath, ext);
                        const thumbnailPath = path.join(dir, `${basename}.gpt`);

                        try {
                            fs.writeFileSync(thumbnailPath, buffer);
                            console.log(`缩略图已保存: ${thumbnailPath}`);
                            resolve(thumbnailPath);
                        } catch (err) {
                            console.error('保存缩略图失败:', err);
                            reject(err);
                        }
                    };
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(blob);
                }, 'image/jpeg', 0.85);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 为视频智能生成缩略图：很多视频开头/结尾有黑场，固定取 0.1s 会得到全黑缩略图。
     * 这里在若干候选时间点采样亮度，挑选第一帧非黑（或最亮）的画面再生成。
     * @param {HTMLVideoElement} video - 已加载元数据的视频元素
     * @param {string} originalPath - 原始文件路径
     * @returns {Promise<string>} 缩略图路径
     */
    async generateVideoThumbnailSmart(video, originalPath) {
        const dur = isFinite(video.duration) ? video.duration : 0;
        const cand = [];
        const push = (t) => {
            t = +(+t).toFixed(2);
            if (t >= 0 && (dur === 0 || t < dur) && !cand.includes(t)) cand.push(t);
        };
        // 优先 ~1s（跳过常见黑场片头），再退而求其次
        push(dur ? Math.min(1.0, dur * 0.1) : 1.0);
        push(2.0); push(dur * 0.25); push(dur * 0.5); push(0.5); push(0.1);

        const probe = document.createElement('canvas');
        probe.width = 32; probe.height = 18;
        const pctx = probe.getContext('2d');

        const seekTo = (t) => new Promise((resolve) => {
            let done = false;
            const onSeeked = () => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); resolve(); };
            video.addEventListener('seeked', onSeeked);
            try { video.currentTime = t; } catch (_) { onSeeked(); }
            setTimeout(onSeeked, 3000); // 容错：seek 卡住时超时继续
        });
        const brightnessAt = async (t) => {
            await seekTo(t);
            await new Promise(r => setTimeout(r, 150)); // 等待该帧绘制
            try {
                pctx.drawImage(video, 0, 0, 32, 18);
                const d = pctx.getImageData(0, 0, 32, 18).data;
                let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
                return s / (d.length / 4);
            } catch (_) { return 0; }
        };

        const BLACK = 18;     // 平均亮度阈值（0=纯黑）
        let bestT = cand.length ? cand[0] : 0.1, bestB = -1;
        for (const t of cand) {
            const b = await brightnessAt(t);
            if (b > bestB) { bestB = b; bestT = t; }
            if (b >= BLACK) break;   // 命中非黑帧即可
        }
        // 定位到选中的帧再生成
        await seekTo(bestT);
        await new Promise(r => setTimeout(r, 150));
        return this.generateAndSaveThumbnail(video, originalPath);
    }

    /**
     * 该视频格式是否要走 ffmpeg（Chromium 的 <video> 无法解码，如 mpg/avi/wmv）
     */
    needsFfmpeg(filename) {
        return /\.(mpg|mpeg|avi|mts|m2ts|vob|asf|wmv|flv|3g2)$/i.test(filename);
    }

    /**
     * 让主进程用 ffmpeg 生成视频缩略图（.gpt）
     * @returns {Promise<string>} 缩略图路径；失败时 reject
     */
    async generateVideoThumbnailFfmpeg(originalPath) {
        const { ipcRenderer } = require('electron');
        const res = await ipcRenderer.invoke('generate-video-thumbnail', { filePath: originalPath });
        if (!res || !res.success) throw new Error((res && res.error) || 'ffmpeg thumbnail failed');
        return res.thumbPath;
    }

    /**
     * 为图片元素设置缩略图源
     * @param {HTMLImageElement} img - 图片元素
     * @param {string} originalPath - 原始文件路径
     */
    setImageThumbnail(img, originalPath) {
        const { path: filePath, isThumbnail } = this.getThumbnailPath(originalPath);
        const fileUrl = this.toFileUrl(filePath);

        img.src = fileUrl;

        // 如果使用的是原始文件，加载后生成缩略图
        if (!isThumbnail) {
            img.onload = () => {
                // 异步生成缩略图，不阻塞显示
                this.generateAndSaveThumbnail(img, originalPath).catch(err => {
                    console.error('生成缩略图失败:', err);
                });
            };
        }
    }

    /**
     * 为视频元素设置缩略图
     * @param {HTMLVideoElement} video - 视频元素
     * @param {string} originalPath - 原始文件路径
     * @param {number} seekTime - 截取时间点（秒）
     */
    setVideoThumbnail(video, originalPath, seekTime = 0.1) {
        const { path: filePath, isThumbnail } = this.getThumbnailPath(originalPath);

        if (isThumbnail) {
            // 如果缩略图存在，使用 img 显示
            const img = document.createElement('img');
            const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
            img.src = fileUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            
            // 替换 video 元素
            if (video.parentNode) {
                video.parentNode.replaceChild(img, video);
            }
            return img;
        } else {
            // 使用原始视频
            const fileUrl = this.toFileUrl(originalPath);
            video.src = fileUrl;
            video.preload = 'metadata';
            video.muted = true;

            video.addEventListener('loadedmetadata', () => {
                video.currentTime = seekTime;
                
                // 在seeked事件中生成缩略图
                video.addEventListener('seeked', () => {
                    this.generateAndSaveThumbnail(video, originalPath).catch(err => {
                        console.error('生成视频缩略图失败:', err);
                    });
                }, { once: true });
            });

            return video;
        }
    }
}

// 单例导出
const thumbnailGenerator = new ThumbnailGenerator();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = thumbnailGenerator;
}

// 浏览器环境
if (typeof window !== 'undefined') {
    window.ThumbnailGenerator = thumbnailGenerator;
}
