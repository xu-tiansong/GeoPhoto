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
     * 递归获取目录下的所有文件（包括子目录）
     * skipScanned: 是否跳过已扫描的目录
     * progressCallback: 进度回调函数
     */
    getAllFilesRecursively(dirPath, fileList = [], skipScanned = false, visitedDirs = new Set(), progressCallback = null) {
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
                    
                    // 将子目录添加到数据库
                    this.db.addDirectory(fullPath);
                    
                    // 检查子目录是否已扫描
                    if (skipScanned && this.db.isDirectoryScanned(fullPath)) {
                        continue;
                    }
                    // 递归处理子目录，传递visitedDirs和progressCallback
                    this.getAllFilesRecursively(fullPath, fileList, skipScanned, visitedDirs, progressCallback);
                } else if (stat.isFile()) {
                    // 只收集媒体文件，跳过不需要的文件
                    if (Photo.isMediaFile(item)) {
                        fileList.push({
                            directory: dirPath,
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
     */
    async extractMetadata(fullPath, filename) {
        try {
            // 添加超时保护，5秒超时
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('EXIF读取超时')), 5000);
            });
            
            const exifPromise = exifr.parse(fullPath, {
                // 只提取我们需要的字段，提高性能
                pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
                // 跳过缩略图等大数据
                skip: ['thumbnail'],
                // 快速模式
                tiff: true,
                exif: true,
                gps: true,
                // 其他格式禁用以提高速度
                iptc: false,
                icc: false,
                jfif: false
            });
            
            const meta = await Promise.race([exifPromise, timeoutPromise]);
            
            return {
                time: meta?.DateTimeOriginal || meta?.CreateDate || null,
                lat: meta?.latitude || null,
                lng: meta?.longitude || null
            };
        } catch (err) {
            // 静默失败，返回空元数据
            if (err.message === 'EXIF读取超时') {
                console.log(`EXIF读取超时: ${filename}`);
            }
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
        
        // 检查目录是否已扫描
        if (skipScanned && this.db.isDirectoryScanned(dirPath)) {
            console.log('目录已扫描，跳过:', dirPath);
            return {
                totalPhotos: 0,
                totalVideos: 0,
                newPhotos: 0,
                newVideos: 0,
                skippedFiles: 0,
                skippedDirectory: true
            };
        }
        
        // 添加目录到数据库
        this.db.addDirectory(dirPath);
        
        console.log('正在遍历目录获取媒体文件列表...');
        // 递归获取所有媒体文件（跳过已扫描的子目录），传递进度回调
        const mediaItems = this.getAllFilesRecursively(dirPath, [], skipScanned, new Set(), progressCallback);
        console.log(`目录遍历完成，找到 ${mediaItems.length} 个媒体文件`);
        
        if (mediaItems.length === 0) {
            console.log('没有找到媒体文件，跳过处理');
            this.db.updateScanTime(dirPath);
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
                if (meta.time || meta.lat) {  // 至少有时间或位置信息
                    photoMetaList.push({
                        path: fullPath,
                        directory: directory,
                        filename: filename,
                        time: meta.time,
                        lat: meta.lat,
                        lng: meta.lng,
                        type: 'photo'
                    });
                } else {
                    // 没有EXIF信息，使用文件修改时间
                    photoMetaList.push({
                        path: fullPath,
                        directory: directory,
                        filename: filename,
                        time: this.getFileModifiedTime(fullPath),
                        lat: null,
                        lng: null,
                        type: 'photo'
                    });
                }
                
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
                
                const meta = await this.extractMetadata(fullPath, filename);
                videoMetaList.push({
                    path: fullPath,
                    directory: directory,
                    filename: filename,
                    time: meta.time || this.getFileModifiedTime(fullPath),
                    lat: meta.lat,
                    lng: meta.lng,
                    type: 'video'
                });
                
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
        // 更新目录扫描时间
        this.db.updateScanTime(dirPath);
        
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
