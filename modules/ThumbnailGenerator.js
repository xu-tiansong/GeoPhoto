/**
 * ThumbnailGenerator.js - 缩略图生成和缓存工具
 * 自动检查和生成 .gpt 格式的缩略图文件
 */

const fs = require('fs');
const path = require('path');

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
     * 为图片元素设置缩略图源
     * @param {HTMLImageElement} img - 图片元素
     * @param {string} originalPath - 原始文件路径
     */
    setImageThumbnail(img, originalPath) {
        const { path: filePath, isThumbnail } = this.getThumbnailPath(originalPath);
        const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;

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
            const fileUrl = `file://${originalPath.replace(/\\/g, '/')}`;
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
