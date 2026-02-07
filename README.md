# GeoPhoto - 个人地理相册 | Personal Geographic Photo Album

基于地理位置和时间轴的个人照片/视频管理系统。在地图上浏览你的照片，按时间轴筛选，查看拍摄地点。

A personal photo/video management system based on geographic location and timeline. Browse your photos on a map, filter by timeline, and view shooting locations.

![Electron](https://img.shields.io/badge/Electron-33.0.0-47848F?logo=electron)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet)

## ✨ 功能特性 | Features

- 🗺️ **地图浏览 | Map Browsing** - 在卫星地图上查看所有照片/视频的拍摄位置 | View shooting locations of all photos/videos on satellite map
- 📅 **时间轴筛选 | Timeline Filtering** - 通过底部时间滚动条按时间范围筛选 | Filter by time range using bottom timeline scrollbar
- 🖼️ **照片查看器 | Photo Viewer** - 点击照片图钉打开模态窗口，支持缩放、拖动和详细信息查看 | Click photo markers to open modal window with zoom, pan, and detailed info
- 📍 **智能聚合 | Smart Clustering** - 大量照片自动聚合显示，流畅浏览上万张照片 | Auto-cluster large number of photos for smooth browsing
- 🎬 **视频支持 | Video Support** - 支持视频文件，显示第一帧缩略图 | Support video files with first frame thumbnail
- 📂 **递归扫描 | Recursive Scanning** - 自动扫描目录及所有子目录，跳过已扫描的目录 | Auto-scan directories and subdirectories, skip already scanned ones
- 🎯 **GPS 推断 | GPS Inference** - 为没有 GPS 的视频从最近时间的照片推断位置 | Infer location for videos without GPS from nearest photo
- 🏙️ **逆地理编码 | Reverse Geocoding** - 自动显示拍摄城市名称 | Automatically display shooting city names
- 🗺️ **位置地图 | Location Map** - Info tab 中显示小地图标记照片拍摄位置 | Show mini map in Info tab marking photo location

## 💻 系统要求 | System Requirements

- **Node.js** 18.x 或更高版本 | or higher
- **Windows** / macOS / Linux
- 需要网络连接（加载地图瓦片和城市名称） | Internet connection required (for map tiles and city names)

## 📦 安装步骤 | Installation

### 1. 克隆仓库 | Clone Repository

```bash
git clone https://github.com/your-username/GeoPhoto.git
cd GeoPhoto
```

### 2. 安装依赖 | Install Dependencies

```bash
npm install
```

### 3. 重建原生模块 | Rebuild Native Modules

由于项目使用了 `better-sqlite3`（原生 Node.js 模块），需要为 Electron 重新编译：

Since the project uses `better-sqlite3` (native Node.js module), it needs to be recompiled for Electron:

```bash
npx electron-rebuild
```

> ⚠️ **Windows 用户注意 | Windows Users**: 需要先安装 | Need to install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 和 Python | and Python first

### 4. 运行应用 | Run Application

```bash
npm start
```

## 📖 使用方法 | Usage

### 选择照片目录 | Select Photo Directory
- 点击菜单 `Photos` → `Set Photo Directory` 
- Select Photos → Set Photo Directory from menu
- 选择包含照片/视频的文件夹 | Select folder containing photos/videos
- 程序会自动扫描所有子目录 | Program will auto-scan all subdirectories

### 浏览照片 | Browse Photos
- 照片以图钉形式显示在地图上 | Photos displayed as markers on map
- 密集区域自动聚合显示数量 | Dense areas auto-clustered with count
- 鼠标悬停显示缩略图、时间和城市 | Hover to show thumbnail, time and city
- 点击照片图钉打开详细查看窗口 | Click photo marker to open detailed viewer

### 照片查看器 | Photo Viewer
- 支持照片缩放（25%-500%）和拖动 | Support photo zoom (25%-500%) and pan
- 滚轮缩放，按钮控制 | Scroll wheel zoom, button controls
- Info tab 显示文件信息和位置地图 | Info tab shows file info and location map
- 小地图支持滚轮缩放，始终居中显示 | Mini map supports scroll zoom, always centered
- ESC 键或右上角 X 按钮关闭 | ESC key or top-right X button to close

### 时间筛选 | Timeline Filtering
- 使用底部时间轴拖动选择时间范围 | Drag timeline to select time range
- 拖动两侧手柄调整范围 | Drag handles to adjust range
- 左右箭头按钮快速滚动 | Left/right arrow buttons for quick scroll
- 点击切换小时/天/月模式 | Click to switch hour/day/month mode

### 区域选择 | Area Selection
- 使用地图左侧的矩形工具框选区域 | Use rectangle tool on map left to select area
- 查看该区域内的照片统计 | View photo statistics in that area

## 📁 支持的文件格式 | Supported File Formats

**照片 | Photos**：`.jpg`, `.jpeg`, `.png`, `.heic`, `.webp`, `.bmp`, `.gif`

**视频 | Videos**：`.mp4`, `.mov`, `.avi`, `.mkv`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.3gp`

## 🛠️ 技术栈 | Tech Stack

- **Electron** - 跨平台桌面应用框架 | Cross-platform desktop framework
- **Leaflet** - 开源地图库 | Open-source mapping library
- **Leaflet.markercluster** - 标记聚合插件 | Marker clustering plugin
- **Leaflet.draw** - 绘图工具插件 | Drawing tools plugin
- **better-sqlite3** - 高性能 SQLite 绑定 | High-performance SQLite binding
- **exifr** - EXIF 元数据解析 | EXIF metadata parser
- **Esri World Imagery** - 卫星底图 | Satellite base map
- **CARTO** - 地名标签图层 | Place name label layer
- **Nominatim** - 逆地理编码服务 | Reverse geocoding service

## 📂 项目结构 | Project Structure

```
GeoPhoto/
├── main.js                    # Electron 主进程 | Main process
├── renderer.js                # 渲染进程入口 | Renderer entry
├── index.html                 # 主页面 | Main page
├── photo-window.html          # 照片查看器页面 | Photo viewer page
├── style.css                  # 主样式 | Main styles
├── package.json               # 项目配置 | Project config
├── photos.db                  # SQLite 数据库 | SQLite database (auto-generated)
└── modules/                   # 模块目录 | Modules directory
    ├── Database.js            # 数据库管理 | Database manager
    ├── Photo.js               # 照片类 | Photo class
    ├── PhotoManager.js        # 照片管理器 | Photo manager
    ├── Timeline.js            # 时间轴管理 | Timeline manager
    ├── MapManager.js          # 地图管理 | Map manager
    ├── MenuManager.js         # 菜单管理 | Menu manager
    └── PhotoWindow.js         # 照片窗口管理 | Photo window manager
```

## ❓ 常见问题 | FAQ

### Q: `npm install` 失败？| `npm install` failed?

**中文**：确保已安装 Node.js 18+，并且在 Windows 上安装了 C++ 构建工具：
```bash
npm install --global windows-build-tools
```

**English**: Make sure Node.js 18+ is installed, and on Windows, install C++ build tools:
```bash
npm install --global windows-build-tools
```

### Q: 照片没有显示在地图上？| Photos not showing on map?

**中文**：
- 确保照片包含 GPS EXIF 信息
- 检查时间轴范围是否包含照片拍摄时间
- 打开开发者工具（F12）查看错误日志

**English**:
- Ensure photos contain GPS EXIF information
- Check if timeline range includes photo capture time
- Open Developer Tools (F12) to view error logs

### Q: 城市名称显示"Loading..."？| City name shows "Loading..."?

**中文**：
- 检查网络连接
- Nominatim 服务有请求频率限制，稍后会自动加载

**English**:
- Check network connection
- Nominatim service has rate limits, will auto-load later

### Q: 文件句柄警告？| File handle warnings?

**中文**：已修复。使用 `fs.promises` 显式管理文件句柄，避免垃圾回收警告。

**English**: Fixed. Using `fs.promises` to explicitly manage file handles, avoiding garbage collection warnings.

## 📝 开源协议 | License

ISC License

---

**🌟 如果这个项目对你有帮助，请给个 Star！**

**🌟 If this project helps you, please give it a Star!**
