/**
 * PhotoFilesManager.js - 照片文件管理类
 * 负责扫描目录、读取EXIF信息、管理照片文件
 */

const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const Photo = require('./Photo');

class PhotoFilesManager {
    constructor(databaseManager) {
        this.db = databaseManager;
    }

    /**
     * 计算相对于基础目录的相对路径
     */
    getRelativePath(fullPath, baseDir) {
        const relativePath = path.relative(baseDir, fullPath);
        return relativePath === '' ? '' : relativePath;
    }

    /**
     * 拼接完整路径（基础目录 + 相对目录）
     */
    getFullPath(relativeDir, filename, baseDir = null) {
        const photoDir = baseDir || this.db.getPhotoDirectory();
        if (!photoDir) {
            return path.join(relativeDir || '', filename);
        }
        return path.join(photoDir, relativeDir || '', filename);
    }

    /**
     * 递归获取目录下的所有文件（包括子目录）
     * skipScanned: 是否跳过已扫描的目录
     * progressCallback: 进度回调函数
     * baseDir: 基础目录，用于计算相对路径
     */
    getAllFilesRecursively(dirPath, fileList = [], skipScanned = false, visitedDirs = new Set(), progressCallback = null, baseDir = null) {
        // 获取真实路径以避免软链接循环
        let realPath;
        try {
            realPath = fs.realpathSync(dirPath);
        } catch (err) {
            console.log('无法解析路径:', dirPath, err.message);
            return fileList;
        }
        
        // 检查是否已访问过此目录（避免循环引用）
        if (visitedDirs.has(realPath)) {
            console.log('跳过循环引用目录:', realPath);
            return fileList;
        }
        visitedDirs.add(realPath);
        
        // 每遍历10个目录发送一次进度
        if (progressCallback && visitedDirs.size % 10 === 0) {
            progressCallback({ phase: 'directory', count: visitedDirs.size });
        }
        
        let items;
        try {
            items = fs.readdirSync(dirPath);
        } catch (err) {
            console.log('无法读取目录:', dirPath, err.message);
            return fileList;
        }
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            try {
                const stat = fs.lstatSync(fullPath); // 使用lstatSync以检测符号链接
                
                // 跳过符号链接（避免循环和性能问题）
                if (stat.isSymbolicLink()) {
                    continue;
                }
                
                if (stat.isDirectory()) {
                    // 跳过特殊目录
                    if (item.startsWith('.') || item === 'node_modules' || item === '$RECYCLE.BIN') {
                        continue;
                    }
                    
                    const relativeSubDir = baseDir ? this.getRelativePath(fullPath, baseDir) : fullPath;

                    // 跳过 directories 表中已存在的目录（仅对子目录生效）
                    if (skipScanned && this.db.hasDirectory(relativeSubDir)) {
                        continue;
                    }

                    // 将新发现的子目录添加到数据库（使用相对路径）
                    this.db.addDirectory(relativeSubDir);

                    // 递归处理子目录，传递visitedDirs和progressCallback
                    this.getAllFilesRecursively(fullPath, fileList, skipScanned, visitedDirs, progressCallback, baseDir);
                } else if (stat.isFile()) {
                    // 只收集媒体文件，跳过不需要的文件
                    if (Photo.isMediaFile(item)) {
                        // 计算相对目录路径
                        const relativeDir = baseDir ? this.getRelativePath(dirPath, baseDir) : dirPath;
                        fileList.push({
                            directory: relativeDir,
                            filename: item,
                            fullPath: fullPath
                        });
                    }
                }
            } catch (err) {
                // 静默跳过无法访问的文件
            }
        }
        
        return fileList;
    }

    /**
     * 从文件读取EXIF元数据（带超时保护）
     * 完全静默处理所有错误，确保扫描不会中断
     */
    async extractMetadata(fullPath, filename) {
        // 记录当前正在处理的文件（在调用 exifr 之前打印，方便调试）
        console.log(`[EXIF] 正在处理: ${fullPath}`);
        
        // 检查是否为不支持 EXIF 的文件格式（GIF、BMP、WebP 等）
        const noExifFormats = /\.(gif|bmp|webp|png)$/i;
        if (noExifFormats.test(filename)) {
            console.log(`[EXIF] 跳过不支持EXIF的格式: ${filename}`);
            return { time: null, lat: null, lng: null };
        }
        
        // 在最外层就准备好错误处理上下文
        const errorContext = {
            fullPath: fullPath,
            filename: filename,
            timestamp: new Date().toISOString()
        };
        
        // 将当前文件信息保存到全局，以便在异常时可以查看
        global._currentProcessingFile = errorContext;
        
        try {
            // 超时控制变量
            let timeoutId = null;
            let isTimedOut = false;
            
            // 添加超时保护，30秒超时（增加时间，避免误判）
            const timeoutPromise = new Promise((resolve) => {
                timeoutId = setTimeout(() => {
                    isTimedOut = true;
                    console.error(`========== EXIF读取超时 (30秒) ==========`);
                    console.error(`文件路径: ${errorContext.fullPath}`);
                    console.error(`文件名: ${errorContext.filename}`);
                    console.error(`提示: 文件过大或损坏，将使用文件修改时间`);
                    console.error(`========================================`);
                    resolve(null);
                }, 30000); // 增加到30秒
            });
            
            // 多层包装 exifr.parse，确保所有错误都能捕获并记录文件信息
            const exifPromise = (async () => {
                try {
                    // 检查是否为 HEIC 格式
                    const isHEIC = /\.heic$/i.test(filename);
                    
                    const result = await exifr.parse(fullPath, {
                        pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
                        skip: ['thumbnail'],
                        tiff: true,
                        exif: true,
                        gps: true,
                        // 明确启用 HEIC 支持
                        heic: isHEIC,
                        iptc: false,
                        icc: false,
                        jfif: false,
                        silentErrors: true
                    });
                    return result;
                } catch (parseError) {
                    // 第一层捕获：exifr.parse 直接抛出的错误
                    const errorMsg = parseError.message || String(parseError);
                    const isHEIC = /\.heic$/i.test(errorContext.filename);
                    
                    if (isHEIC) {
                        console.error(`========== HEIC文件EXIF读取失败 ==========`);
                        console.error(`文件路径: ${errorContext.fullPath}`);
                        console.error(`文件名: ${errorContext.filename}`);
                        console.error(`错误信息: ${errorMsg}`);
                        console.error(`提示: 将使用文件修改时间代替EXIF时间`);
                        console.error(`==========================================`);
                    } else {
                        console.error(`========== EXIF解析错误 ==========`);
                        console.error(`文件路径: ${errorContext.fullPath}`);
                        console.error(`文件名: ${errorContext.filename}`);
                        console.error(`错误信息: ${errorMsg}`);
                        console.error(`错误类型: ${parseError.name || 'Error'}`);
                        console.error(`时间戳: ${errorContext.timestamp}`);
                        console.error(`====================================`);
                    }
                    return null;
                }
            })().catch(asyncError => {
                // 第二层捕获：async 函数内部的错误
                const errorMsg = asyncError.message || String(asyncError);
                console.error(`========== EXIF异步错误 ==========`);
                console.error(`文件路径: ${errorContext.fullPath}`);
                console.error(`文件名: ${errorContext.filename}`);
                console.error(`错误信息: ${errorMsg}`);
                console.error(`====================================`);
                return null;
            });
            
            // 使用 Promise.race 处理超时
            const meta = await Promise.race([exifPromise, timeoutPromise]);
            
            // 清理超时定时器，避免资源泄漏
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            
            // 安全返回结果
            if (!meta || typeof meta !== 'object') {
                return { time: null, lat: null, lng: null };
            }
            
            return {
                time: meta.DateTimeOriginal || meta.CreateDate || null,
                lat: meta.latitude || null,
                lng: meta.longitude || null
            };
        } catch (err) {
            // 最外层兜底错误处理
            console.error(`========== EXIF致命错误 ==========`);
            console.error(`文件路径: ${errorContext.fullPath}`);
            console.error(`文件名: ${errorContext.filename}`);
            console.error(`错误类型: ${err.name || 'Error'}`);
            console.error(`错误信息: ${err.message || String(err)}`);
            if (err.stack) {
                console.error(`错误堆栈:\n${err.stack}`);
            }
            console.error(`====================================`);
            return { time: null, lat: null, lng: null };
        }
    }

    /**
     * 获取文件修改时间（作为备用时间）
     */
    getFileModifiedTime(fullPath) {
        try {
            const stats = fs.statSync(fullPath);
            return stats.mtime;
        } catch (err) {
            return null;
        }
    }

    /**
     * 查找时间最接近的照片（用于推断位置）
     * 返回 { photo, timeDiff } 其中 timeDiff 是毫秒数
     */
    findNearestPhotoByTime(targetTime, photoList) {
        if (!targetTime || photoList.length === 0) return null;
        
        const targetMs = targetTime instanceof Date ? targetTime.getTime() : new Date(targetTime).getTime();
        if (isNaN(targetMs)) return null;
        
        let nearestPhoto = null;
        let minTimeDiff = Infinity;
        
        for (const photo of photoList) {
            if (!photo.time || !photo.lat || !photo.lng) continue;
            
            const photoMs = photo.time instanceof Date ? photo.time.getTime() : new Date(photo.time).getTime();
            if (isNaN(photoMs)) continue;
            
            const timeDiff = Math.abs(targetMs - photoMs);
            if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                nearestPhoto = photo;
            }
        }
        
        return nearestPhoto ? { photo: nearestPhoto, timeDiff: minTimeDiff } : null;
    }

    /**
     * 扫描目录并处理所有照片和视频（包括子目录）
     * skipScanned: 是否跳过已扫描的目录
     */
    async scanAndProcessDirectory(dirPath, progressCallback = null, skipScanned = true) {
        console.log('========== 开始扫描目录 ==========');
        console.log('目录路径:', dirPath);
        console.log('跳过已扫描:', skipScanned);
        
        // 添加目录到数据库（根目录存储为空字符串）
        this.db.addDirectory('');
        
        console.log('正在遍历目录获取媒体文件列表...');
        // 递归获取所有媒体文件（跳过已扫描的子目录），传递进度回调和基础目录
        const mediaItems = this.getAllFilesRecursively(dirPath, [], skipScanned, new Set(), progressCallback, dirPath);
        console.log(`目录遍历完成，找到 ${mediaItems.length} 个媒体文件`);
        
        if (mediaItems.length === 0) {
            console.log('没有找到媒体文件，跳过处理');
            this.db.updateScanTime('');
            return {
                totalPhotos: 0,
                totalVideos: 0,
                newPhotos: 0,
                newVideos: 0,
                skippedFiles: 0,
                skippedDirectory: false
            };
        }
        
        // 统计信息
        let totalPhotos = 0;
        let totalVideos = 0;
        let newPhotos = 0;
        let newVideos = 0;
        let skippedFiles = 0;
        
        // 收集所有文件的元数据
        const photoMetaList = [];
        const videoMetaList = [];
        
        // 只处理媒体文件
        let processedCount = 0;
        console.log('开始提取EXIF元数据...');
        
        for (const item of mediaItems) {
            const { directory, filename, fullPath } = item;
            
            try {
                if (Photo.isPhotoExtension(filename)) {
                    totalPhotos++;
                    
                    // 检查是否已存在
                    if (this.db.isFileExists(directory, filename)) {
                        skippedFiles++;
                        processedCount++;
                        // 发送进度更新
                        if (progressCallback && processedCount % 10 === 0) {
                            progressCallback({ phase: 'metadata', current: processedCount, total: mediaItems.length });
                        }
                        continue;
                    }
                    
                    const meta = await this.extractMetadata(fullPath, filename);
                    
                    // 始终保存文件信息，即使 EXIF 提取失败
                    photoMetaList.push({
                        path: fullPath,
                        directory: directory,
                        filename: filename,
                        time: meta.time || this.getFileModifiedTime(fullPath),
                        lat: meta.lat,
                        lng: meta.lng,
                        type: 'photo'
                    });
                    
                    processedCount++;
                } else if (Photo.isVideoExtension(filename)) {
                    totalVideos++;
                    
                    // 检查是否已存在
                    if (this.db.isFileExists(directory, filename)) {
                        skippedFiles++;
                        processedCount++;
                        // 发送进度更新
                        if (progressCallback && processedCount % 10 === 0) {
                            progressCallback({ phase: 'metadata', current: processedCount, total: mediaItems.length });
                        }
                        continue;
                    }
                    
                    // 视频文件：exifr不支持大部分视频格式，直接使用文件修改时间
                    videoMetaList.push({
                        path: fullPath,
                        directory: directory,
                        filename: filename,
                        time: this.getFileModifiedTime(fullPath),
                        lat: null,
                        lng: null,
                        type: 'video'
                    });
                    
                    processedCount++;
                }
            } catch (error) {
                // 捕获处理单个文件时的所有异常，记录详细信息后继续处理下一个文件
                console.error(`========== 文件处理异常 ==========`);
                console.error(`文件路径: ${fullPath}`);
                console.error(`相对目录: ${directory}`);
                console.error(`文件名: ${filename}`);
                console.error(`错误类型: ${error.name || 'Error'}`);
                console.error(`错误信息: ${error.message}`);
                if (error.stack) {
                    console.error(`错误堆栈: ${error.stack}`);
                }
                console.error(`=====================================`);
                
                // 记录为跳过的文件
                skippedFiles++;
                processedCount++;
            }
            
            // 每处理10个文件发送一次进度更新（减少IPC开销）
            if (progressCallback && processedCount % 10 === 0) {
                progressCallback({
                    phase: 'metadata',
                    current: processedCount,
                    total: mediaItems.length
                });
            }
        }
        
        console.log(`EXIF提取完成：${photoMetaList.length}张照片，${videoMetaList.length}个视频`);
        
        // 收集所有有GPS信息的照片（用于后续推断位置）
        const photosWithGPS = photoMetaList.filter(p => p.lat && p.lng);
        console.log(`其中 ${photosWithGPS.length} 张照片有GPS信息`);
        
        // 如果没有GPS照片，跳过推断步骤
        if (photosWithGPS.length === 0) {
            console.log('没有照片有GPS信息，跳过位置推断');
        } else {
            console.log('开始推断其他照片位置...');
            // 为没有地理信息的照片查找最接近时间的照片
            const ONE_HOUR_MS = 3600000; // 1小时 = 3600000毫秒
            
            let inferredCount = 0;
            for (const photo of photoMetaList) {
                if (!photo.lat || !photo.lng) {
                    const nearest = this.findNearestPhotoByTime(photo.time, photosWithGPS);
                    if (nearest && nearest.timeDiff <= ONE_HOUR_MS) {
                        photo.lat = nearest.photo.lat;
                        photo.lng = nearest.photo.lng;
                        photo.geoSource = 'inferred';
                        inferredCount++;
                    }
                }
            }
            
            // 为没有地理信息的视频查找最接近时间的照片
            for (const video of videoMetaList) {
                if (!video.lat || !video.lng) {
                    const nearest = this.findNearestPhotoByTime(video.time, photosWithGPS);
                    if (nearest && nearest.timeDiff <= ONE_HOUR_MS) {
                        video.lat = nearest.photo.lat;
                        video.lng = nearest.photo.lng;
                        video.geoSource = 'inferred';
                        inferredCount++;
                    }
                }
            }
            
            console.log(`GPS推断完成，共推断 ${inferredCount} 个文件的位置`);
        }
        
        // 批量写入数据库（使用事务提高性能）
        const allFiles = [...photoMetaList, ...videoMetaList];
        console.log(`开始批量写入数据库，共 ${allFiles.length} 个文件...`);
        
        // 发送数据库写入进度
        if (progressCallback) {
            progressCallback({ phase: 'database' });
        }
        
        if (allFiles.length > 0) {
            this.db.batchInsertPhotos(allFiles);
        }
        
        // 统计新增数量
        newPhotos = photoMetaList.length;
        newVideos = videoMetaList.length;
        
        console.log(`数据库写入完成！`);
        // 更新目录扫描时间（根目录用空字符串）
        this.db.updateScanTime('');
        
        // 输出扫描结果摘要
        console.log('========== 扫描完成 ==========');
        console.log(`总计照片: ${totalPhotos}, 新增: ${newPhotos}`);
        console.log(`总计视频: ${totalVideos}, 新增: ${newVideos}`);
        console.log(`跳过文件: ${skippedFiles}`);
        console.log('==============================');
        
        return {
            totalPhotos,
            totalVideos,
            newPhotos,
            newVideos,
            skippedFiles,
            skippedDirectory: false
        };
    }

    /**
     * 获取指定目录下的所有媒体文件列表（不处理元数据）
     */
    listMediaFiles(dirPath) {
        const allItems = this.getAllFilesRecursively(dirPath);
        return allItems.filter(item => Photo.isMediaFile(item.filename));
    }

    /**
     * 验证文件是否存在
     */
    fileExists(filePath) {
        try {
            return fs.existsSync(filePath);
        } catch (err) {
            return false;
        }
    }

    /**
     * 获取文件信息
     */
    getFileInfo(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return {
                exists: true,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory()
            };
        } catch (err) {
            return { exists: false };
        }
    }
}

module.exports = PhotoFilesManager;
