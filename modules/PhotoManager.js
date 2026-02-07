/**
 * PhotoManager.js - 照片文件管理类
 * 负责扫描目录、读取EXIF信息、管理照片文件
 */

const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const Photo = require('./Photo');

class PhotoManager {
    constructor(databaseManager) {
        this.db = databaseManager;
    }

    /**
     * 递归获取目录下的所有文件（包括子目录）
     * skipScanned: 是否跳过已扫描的目录
     */
    getAllFilesRecursively(dirPath, fileList = [], skipScanned = false) {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    // 将子目录添加到数据库
                    this.db.addDirectory(fullPath);
                    
                    // 检查子目录是否已扫描
                    if (skipScanned && this.db.isDirectoryScanned(fullPath)) {
                        console.log('跳过已扫描目录:', fullPath);
                        continue;
                    }
                    // 递归处理子目录
                    this.getAllFilesRecursively(fullPath, fileList, skipScanned);
                } else if (stat.isFile()) {
                    fileList.push({
                        directory: dirPath,
                        filename: item,
                        fullPath: fullPath
                    });
                }
            } catch (err) {
                console.log('无法访问:', fullPath, err.message);
            }
        }
        
        return fileList;
    }

    /**
     * 从文件读取EXIF元数据
     */
    async extractMetadata(fullPath, filename) {
        let fileHandle;
        try {
            // 使用fs.promises读取文件，确保正确关闭文件句柄
            const fsPromises = require('fs').promises;
            fileHandle = await fsPromises.open(fullPath, 'r');
            const buffer = await fileHandle.readFile();
            await fileHandle.close();
            fileHandle = null;
            
            // 从Buffer解析EXIF，避免exifr打开文件句柄
            const meta = await exifr.parse(buffer);
            return {
                time: meta?.DateTimeOriginal || meta?.CreateDate || null,
                lat: meta?.latitude || null,
                lng: meta?.longitude || null
            };
        } catch (err) {
            return { time: null, lat: null, lng: null };
        } finally {
            // 确保文件句柄被关闭
            if (fileHandle) {
                try {
                    await fileHandle.close();
                } catch (closeErr) {
                    console.log('关闭文件句柄失败:', closeErr.message);
                }
            }
        }
    }

    /**
     * 获取文件修改时间作为备用时间
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
     * 查找时间最接近的照片（用于推断视频位置）
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
        
        return nearestPhoto;
    }

    /**
     * 扫描目录并处理所有照片和视频（包括子目录）
     * skipScanned: 是否跳过已扫描的目录
     */
    async scanAndProcessDirectory(dirPath, progressCallback = null, skipScanned = true) {
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
        
        // 递归获取所有文件（跳过已扫描的子目录）
        const allItems = this.getAllFilesRecursively(dirPath, [], skipScanned);
        
        // 统计信息
        let totalPhotos = 0;
        let totalVideos = 0;
        let newPhotos = 0;
        let newVideos = 0;
        let skippedFiles = 0;
        
        // 收集所有文件的元数据
        const photoMetaList = [];
        const videoMetaList = [];
        
        // 处理所有照片文件
        for (const item of allItems) {
            const { directory, filename, fullPath } = item;
            
            if (Photo.isPhotoExtension(filename)) {
                totalPhotos++;
                
                // 检查是否已存在
                if (this.db.isFileExists(directory, filename)) {
                    skippedFiles++;
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
            } else if (Photo.isVideoExtension(filename)) {
                totalVideos++;
                
                // 检查是否已存在
                if (this.db.isFileExists(directory, filename)) {
                    skippedFiles++;
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
            }
            
            // 进度回调
            if (progressCallback) {
                progressCallback({
                    current: totalPhotos + totalVideos,
                    total: allItems.length,
                    currentFile: filename
                });
            }
        }
        
        // 为没有地理信息的视频查找最接近时间的照片
        for (const video of videoMetaList) {
            if (!video.lat || !video.lng) {
                const nearestPhoto = this.findNearestPhotoByTime(video.time, photoMetaList);
                if (nearestPhoto && nearestPhoto.lat && nearestPhoto.lng) {
                    video.lat = nearestPhoto.lat;
                    video.lng = nearestPhoto.lng;
                    video.geoSource = 'inferred';
                }
            }
        }
        
        // 批量写入数据库
        const allFiles = [...photoMetaList, ...videoMetaList];
        
        for (const file of allFiles) {
            this.db.upsertPhoto(file);
            if (file.type === 'photo') {
                newPhotos++;
            } else {
                newVideos++;
            }
        }
        
        // 更新目录扫描时间
        this.db.updateScanTime(dirPath);
        
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

module.exports = PhotoManager;
