# GeoPhoto - 个人地理相册

基于地理位置和时间轴的个人照片/视频管理系统。在地图上浏览你的照片，按时间轴筛选，查看拍摄地点。

![Electron](https://img.shields.io/badge/Electron-33.0.0-47848F?logo=electron)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet)

## 功能特性

- 🗺️ **地图浏览** - 在卫星地图上查看所有照片/视频的拍摄位置
- 📅 **时间轴筛选** - 通过底部时间滚动条按时间范围筛选
- 🖼️ **缩略图预览** - 鼠标悬停显示缩略图、拍摄日期和城市
- 📍 **智能聚合** - 大量照片自动聚合显示，流畅浏览上万张照片
- 🎬 **视频支持** - 支持视频文件，显示第一帧缩略图
- 📂 **递归扫描** - 自动扫描目录及所有子目录
- 🎯 **GPS 推断** - 为没有 GPS 的视频从最近时间的照片推断位置

## 系统要求

- **Node.js** 18.x 或更高版本
- **Windows** / macOS / Linux
- 需要网络连接（加载地图瓦片和城市名称）

## 安装步骤

### 1. 克隆仓库

```bash
git clone https://github.com/xu-tiansong/GeoPhoto.git
cd GeoPhoto
```

### 2. 安装依赖

```bash
npm install
```

### 3. 重建原生模块

由于项目使用了 `better-sqlite3`（原生 Node.js 模块），需要为 Electron 重新编译：

```bash
npx electron-rebuild
```

> ⚠️ **Windows 用户注意**：需要先安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 和 Python

### 4. 运行应用

```bash
npm start
```

## 使用方法

1. **选择照片目录**
   - 点击菜单 `文件` → `指定照片目录`
   - 选择包含照片/视频的文件夹
   - 程序会自动扫描所有子目录

2. **浏览照片**
   - 照片会以图钉形式显示在地图上
   - 密集区域会自动聚合显示数量
   - 点击聚合圆圈可放大查看

3. **查看缩略图**
   - 鼠标悬停在图钉上显示缩略图
   - 显示拍摄日期、时间和城市名称

4. **时间筛选**
   - 使用底部时间轴拖动选择时间范围
   - 拖动两侧手柄调整范围
   - 点击切换 小时/天/月 模式

5. **区域选择**
   - 使用地图左侧的矩形工具框选区域
   - 查看该区域内的照片统计

## 支持的文件格式

**照片**：`.jpg`, `.jpeg`, `.png`, `.heic`, `.heif`, `.webp`, `.tiff`, `.bmp`, `.gif`

**视频**：`.mp4`, `.mov`, `.avi`, `.mkv`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.3gp`

## 技术栈

- **Electron** - 跨平台桌面应用框架
- **Leaflet** - 开源地图库
- **Leaflet.markercluster** - 标记聚合插件
- **better-sqlite3** - 高性能 SQLite 绑定
- **exifr** - EXIF 元数据解析
- **Esri World Imagery** - 卫星底图
- **CARTO** - 地名标签图层
- **Nominatim** - 逆地理编码服务

## 项目结构

```
GeoPhoto/
├── main.js          # Electron 主进程
├── renderer.js      # 渲染进程（地图、时间轴）
├── index.html       # 页面结构
├── style.css        # 样式
├── package.json     # 项目配置
└── photos.db        # SQLite 数据库（运行后生成）
```

## 常见问题

### Q: `npm install` 失败？

确保已安装 Node.js 18+，并且在 Windows 上安装了 C++ 构建工具：
```bash
npm install --global windows-build-tools
```

### Q: 照片没有显示在地图上？

- 确保照片包含 GPS EXIF 信息
- 检查时间轴范围是否包含照片拍摄时间
- 打开开发者工具（F12）查看错误日志

### Q: 城市名称显示"加载中..."？

- 检查网络连接
- Nominatim 服务有请求频率限制，稍后会自动加载

## 开源协议

ISC License
