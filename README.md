# GeoPhoto — 地理照片管理器 / Geographic Photo Manager

> 基于地图与时间轴的桌面端个人照片管理软件，支持 GPS 可视化、分层标签、缩略图自动缓存与中英双语界面。
>
> A desktop photo manager built around map visualization and a temporal timeline — GPS markers, hierarchical tags, auto-cached thumbnails, and full Chinese/English support.

![Electron](https://img.shields.io/badge/Electron-33.x-47848F?logo=electron)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9.x-199900?logo=leaflet)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## 目录 / Table of Contents

1. [功能概览 / Features Overview](#1-功能概览--features-overview)
2. [特色亮点 / Highlights](#2-特色亮点--highlights)
3. [安装与运行 / Installation](#3-安装与运行--installation)
4. [使用指南 / Usage Guide](#4-使用指南--usage-guide)
5. [键盘快捷键 / Keyboard Shortcuts](#5-键盘快捷键--keyboard-shortcuts)
6. [技术栈 / Tech Stack](#6-技术栈--tech-stack)
7. [项目结构 / Project Structure](#7-项目结构--project-structure)
8. [常见问题 / FAQ](#8-常见问题--faq)

---

## 1. 功能概览 / Features Overview

### 🗺️ 地图可视化 / Map Visualization

- 卫星影像底图（Esri ArcGIS）叠加文字地名图层（CARTO），呈现完整地理信息
- 照片按 GPS 坐标自动聚合为标记簇，点击可展开（Spiderfy）查看单张
- 悬停标记自动显示城市名称（OpenStreetMap Nominatim 反地理编码，含限速队列保护）
- **矩形框选工具**：在地图上拖选任意区域，立即筛选该范围内所有照片
- **地标图层**：以旗帜标记和半径圆圈在地图上可视化用户定义的地理兴趣点

Satellite imagery (Esri) with place-name labels (CARTO). Photos cluster by GPS. Hover a marker for the city name. Draw a rectangle to select all photos in any area. User-defined landmarks appear as flag markers with coverage circles.

---

### ⏱️ 时间轴 / Timeline

- 底部横向时间轴，三种精度模式：**小时 / 天 / 月**，可随时切换
- 双排日期标签（上排月份/周，下排天/小时刻度）
- 拖拽左右手柄实时过滤地图标记；拖拽中间区域平移视图
- 事件标签高亮：关联了事件的日期自动在时间轴上显示色块标记
- 完整状态持久化：重启后自动恢复上次的精度模式与时间范围

A horizontal timeline at the bottom. Drag the left/right handles to filter which photos appear on the map. Supports hourly, daily, and monthly precision. Event-tagged dates are highlighted. State persists across sessions.

---

### 📁 照片扫描与元数据 / Photo Scanning & Metadata

- 递归扫描选定根目录，自动提取 EXIF 元数据（拍摄时间、GPS 坐标）
- **支持图片**：JPG / JPEG / HEIC / PNG / GIF / BMP / WebP
- **支持视频**：MP4 / MOV / AVI / MKV / WMV / FLV / WebM / M4V / 3GP
- 三阶段扫描进度：目录遍历 → EXIF 提取 → 数据库写入
- 文件级去重（目录 + 文件名唯一约束），反复扫描不产生冗余记录
- 无 EXIF 时间时自动回退使用文件修改时间

Recursively scans a folder. EXIF is extracted automatically. Duplicate files are skipped on subsequent scans. Falls back to file modification time when EXIF timestamp is absent.

---

### 🖼️ 照片查看器 / Photo Viewer

- 无边框浮窗，支持图片与视频，可按 F11 进入全屏（退出后自动还原）
- 缩放（放大 / 缩小 / 适应窗口）与拖拽平移
- 同批照片内顺序翻页导航，显示「当前序号 / 总数」
- **右侧信息面板**：文件名、目录路径、拍摄时间、城市名、GPS 坐标、备注（自动保存）、喜欢标记（♥）
- **标签面板**：查看、添加、删除照片标签；「匹配标签」一键自动识别人物 / 事件 / 地标
- 为无坐标照片添加地标标签时，**自动将地标坐标赋予该照片**，地图标记同步移动

A frameless viewer with zoom/pan. The right panel shows all metadata. Notes are auto-saved. Tags can be added/removed inline. Adding a landmark tag to a photo without GPS automatically assigns that landmark's coordinates to the photo, and the map marker moves accordingly.

---

### 📋 照片管理窗口 / Photo Management Window

管理窗口左侧四个标签页，右侧始终显示照片网格（分页加载，每页约 50 张完整行）：

Four left-panel tabs; the right panel always shows the photo grid (~50 photos per page with load-more pagination).

| 标签 / Tab | 功能 / Function |
|:---|:---|
| **目录 / Directory** | 树状浏览照片文件夹，点击目录即可过滤照片 |
| **框选 / Selected** | 展示地图矩形框选区域内的照片 |
| **标签 / Tag** | 勾选标签树节点，右侧即时展示匹配照片（支持多选与层级联动）|
| **日历 / Calendar** | 月历视图，有照片的日期高亮，点击日期查看当天照片 |

- 缩略图懒加载 + 本地 `.gpt` 缓存文件，首次生成后极速显示
- 单击选中照片（高亮蓝色边框），双击打开查看器
- 底部向下箭头按钮加载下一批照片

---

### 🏷️ 标签系统 / Tag System

四种标签类型，均支持任意深度的层级树状结构：

Four tag categories, each supporting unlimited hierarchy depth:

#### 人物标签 / Face Tags
- 为每个人或宠物创建标签，支持多级父子关系（如：家人 > 张三）
- 可上传多张人脸照片进行识别训练，内部存储 128 维人脸特征向量
- 支持宠物标记（`is_pet` 标志）
- 查看器中点击「匹配标签」一键自动识别人物

#### 事件标签 / Event Tags
- 绑定时间区间（单天或跨多天）与地标位置
- 位于时间区间内且在关联地标覆盖半径内的照片可自动关联此事件
- 关联日期在时间轴上显示高亮色块

Bind a date range + landmark to an event. Photos within the time range and landmark radius are auto-tagged.

#### 地标标签 / Location Tags
- 设定经纬度坐标、覆盖半径（米）、地址描述
- 地图上以红色旗帜和半径圆圈可视化
- 为无 GPS 坐标的照片添加地标标签时，自动赋予照片该地标的坐标
- 使用 **Haversine 公式**精确计算地球表面距离

Set coordinates, radius, and address. Adding a landmark tag to an unlocated photo automatically assigns the landmark's GPS coordinates to that photo.

#### 通用标签 / Common Tags
- 无特殊属性的自由分类（风景、美食、建筑等），层级无限嵌套

General-purpose labels with unlimited nesting (e.g., Travel > Europe > Paris).

---

### 🗂️ 标签管理窗口 / Tag Management Window

- **左侧标签树**：新建根标签 / 子标签、编辑、变更父节点、删除（含子树确认）
- **右侧详情面板**（随所选分类切换内容）：
  - 人物：预览图、是否宠物、已存特征向量数量、清除 / 重新识别
  - 事件：日期区间选择器、关联地标下拉
  - 地标：经纬度输入、覆盖半径滑块、地址文本框
  - 通用：名称、备注、颜色选择器
- 所有操作实时同步数据库，无需手动保存

---

### ✨ 其他功能 / Other Features

| 功能 | 说明 |
|:---|:---|
| 城市自动标注 | 悬停地图标记时，通过 Nominatim API 获取最近城市名（含限速队列） |
| 喜欢 / Like | 照片可标记为喜欢（♥），状态持久化，地图标记上同步显示 |
| 地图状态持久化 | 重启后自动恢复上次地图中心、缩放级别、时间区间 |
| 双语界面 | 菜单、所有界面文字完整支持中文 / 英文，切换即时生效 |
| 窗口跟随 | 照片管理窗口、查看器等随主窗口移动 / 缩放同步位置 |
| 全屏查看 | 照片查看器支持 F11 全屏，退出后精确还原窗口大小 |

---

## 2. 特色亮点 / Highlights

### 以地图为中心的照片组织

所有照片以**地理位置**为第一索引维度。有 GPS 数据的照片直接显示在地球上它被拍摄的位置。矩形框选工具让「把某次旅行中同一城市内的照片全选出来」变成一个鼠标操作，无需在文件夹中挨个翻找。

**Map-first design.** Every photo is indexed by where it was taken. Draw a rectangle to instantly select all photos in any area — no folder browsing, no text search.

---

### 时间轴与地图实时联动

拖动时间轴手柄，地图标记立即更新。三种精度随意切换：小时级别回溯某天的行程，月级别鸟瞰多年历史。有事件标签的日期在时间轴上以色块高亮，一眼定位重要时刻。

**Real-time timeline ↔ map sync.** Drag the handles, the map updates instantly. Switch between hour/day/month precision. Event-tagged dates appear as highlights on the timeline.

---

### 四维标签体系，覆盖核心整理场景

从人脸识别到地理地标，从时间事件到自由分类，四种标签类型覆盖照片整理的核心场景，且均支持无限层级。地标标签更能自动为无 GPS 照片赋予地理坐标，让每张照片都能上图。

**Four-dimensional tagging.** Faces, events, landmarks, and general labels — each hierarchical. A landmark tag can auto-fill GPS for unlocated photos, making every photo map-able.

---

### 本地优先，数据完全自有

缩略图以 `.gpt` 文件缓存在照片目录旁，生成一次永久有效，大量照片也能流畅浏览。SQLite 数据库是一个本地文件，无需账号，无需云端，数据完全由用户掌控。

**Local-first.** Thumbnails are cached as `.gpt` files alongside your photos — generated once, loaded instantly forever. Single-file SQLite database. No cloud, no accounts, no subscriptions.

---

### 模块化 Electron 架构

主进程与渲染进程通过 IPC 完全解耦，13 个独立模块各司其职（Database、MapManager、Timeline、ThumbnailGenerator 等），代码清晰，易于理解和扩展。

**Clean modular architecture.** 13 independent modules with IPC-based communication. Easy to extend without breaking existing functionality.

---

## 3. 安装与运行 / Installation

### 环境要求 / Requirements

| 项目 | 版本 |
|:---|:---|
| **Node.js** | ≥ 18.x |
| **npm** | ≥ 9.x |
| **操作系统** | Windows 10 / 11（主要测试平台） |

> macOS / Linux 理论可运行，但以 Windows 为主要开发与测试平台，部分路径细节可能需要调整。
>
> macOS/Linux may work, but the app is primarily developed and tested on Windows.

**Windows 用户额外需要 / Windows users also need:**

- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（含 C++ 工作负载，用于编译 `better-sqlite3` 原生模块）
- Python 3.x

---

### 步骤一：克隆仓库 / Clone the Repository

```bash
git clone https://github.com/your-username/GeoPhoto.git
cd GeoPhoto
```

---

### 步骤二：安装依赖 / Install Dependencies

```bash
npm install
```

`npm install` 会自动触发 `postinstall` 钩子，将 `better-sqlite3` 原生 SQLite 绑定重编译为当前 Electron 版本所需格式。

`npm install` automatically triggers the `postinstall` hook, which recompiles the `better-sqlite3` native binding for the installed Electron version.

若自动重编译失败，手动执行：

If auto-rebuild fails, run manually:

```bash
npm run postinstall
# 等效于 / equivalent to:
# npx electron-rebuild -f -w better-sqlite3
```

---

### 步骤三：启动 / Start

```bash
npm start
```

应用启动后显示主界面（卫星地图 + 底部时间轴）。

The app opens to the main window: a satellite map with the timeline bar at the bottom.

---

### 首次使用 / First-Time Setup

**中文：**

1. 点击菜单 **照片 → 设定并扫描照片目录**，或按 `Ctrl+I`
2. 在系统对话框中选择存放照片的根目录
3. 界面中央显示扫描进度（目录遍历 → EXIF 提取 → 写入数据库）
4. 扫描完成后弹出统计摘要（新增文件数、总文件数）
5. 有 GPS 信息的照片自动以标记形式出现在地图上

**English:**

1. Go to **Photos → Set & Scan Photo Directory** in the menu bar, or press `Ctrl+I`
2. Select your photo root folder in the system dialog
3. A progress overlay shows scan status: directory walk → EXIF extraction → DB write
4. A summary alert reports how many files were added
5. Photos with GPS coordinates immediately appear as markers on the map

---

### 网络说明 / Network Requirements

应用本体完全离线运行，仅以下两项需要网络：

The app runs fully offline except for:

| 功能 / Feature | 服务 / Service |
|:---|:---|
| 卫星地图底图 / Satellite map tiles | Esri ArcGIS (CDN) |
| 城市名称反解析 / City name lookup | OpenStreetMap Nominatim API |

断网时地图显示为空白、城市名称不可用，所有其他功能（扫描、标签、查看器、管理窗口等）正常运行。

If offline, map tiles won't render and city names won't resolve. All other features work normally.

---

## 4. 使用指南 / Usage Guide

### 扫描照片 / Scanning Photos

菜单 → **照片 → 设定并扫描照片目录** → 选择根目录。可多次重复扫描，已入库文件自动跳过。

### 地图交互 / Map Interaction

- 滚轮缩放；拖拽移动视图
- 点击聚合标记展开查看单张照片
- 悬停标记查看城市名称
- 点击单张照片标记打开查看器
- 拖动时间轴手柄过滤时间范围

### 框选照片 / Rectangle Selection

点击地图右侧的矩形绘制控件，拖选目标区域。完成后自动打开照片管理窗口的「框选」标签页，展示该区域内所有照片。

### 按标签筛选 / Filtering by Tags

打开管理窗口 → 切换「标签」标签页 → 展开标签树，勾选一个或多个标签 → 右侧立即展示匹配照片。勾选父节点时自动勾选所有子节点；取消勾选子节点时自动取消所有祖先节点。

### 添加照片标签 / Tagging a Photo

在查看器右侧标签面板点击 **添加标签** → 在弹出窗口选择分类并点击目标标签 → 标签自动关联到该照片。也可点击 **匹配标签** 一键自动识别。

### 创建地标 / Creating a Landmark

菜单 → **地图 → 地标管理** → 切换到「地标」分类 → 新建标签 → 在右侧面板填写坐标、半径、地址 → 保存后自动显示在地图上。

### 切换语言 / Switching Language

菜单 → **系统 → 语言设置 → English / 简体中文**，界面即时更新，下次启动自动记忆。

---

## 5. 键盘快捷键 / Keyboard Shortcuts

| 快捷键 / Shortcut | 功能 / Action |
|:---|:---|
| `Ctrl+I` | 扫描照片目录 / Scan photo directory |
| `F11` | 全屏切换 / Toggle fullscreen |
| `F12` | 开发者工具 / Developer tools |
| `Ctrl+Q` | 退出应用 / Quit |
| `Enter` | 确认 / Confirm |
| `Esc` | 取消 / 关闭弹窗 / Cancel or close |

---

## 6. 技术栈 / Tech Stack

| 组件 / Component | 版本 / Version | 用途 / Purpose |
|:---|:---|:---|
| **Electron** | 33.x | 跨平台桌面框架 / Desktop framework |
| **better-sqlite3** | 12.x | 同步高性能 SQLite / Synchronous SQLite |
| **exifr** | 7.x | EXIF / GPS 元数据提取 / Metadata extraction |
| **Leaflet** | 1.9.x | 交互式地图渲染 / Interactive map |
| **Leaflet.markercluster** | CDN | 标记聚合 / Marker clustering |
| **Leaflet.draw** | CDN | 矩形框选工具 / Rectangle selection |
| **Esri ArcGIS** | CDN | 卫星影像底图 / Satellite tiles |
| **CARTO** | CDN | 地名标签叠加层 / Place-name labels |
| **Nominatim** | OpenStreetMap API | 反地理编码 / Reverse geocoding |

---

## 7. 项目结构 / Project Structure

```
GeoPhoto/
├── main.js                      # 主进程入口，所有 IPC 注册，菜单创建
├── renderer.js                  # 主窗口渲染进程（地图 + 时间轴联动）
├── renderer-tagselect.js        # 标签选择弹窗 preload 脚本
│
├── index.html                   # 主界面（卫星地图 + 时间轴）
├── photo-window.html            # 照片 / 视频查看器窗口
├── photos-manage-window.html    # 照片管理窗口（目录/框选/标签/日历四标签页）
├── tag-manage-window.html       # 标签管理窗口（四分类）
├── tag-select-window.html       # 标签选择弹窗（为照片添加单个标签）
├── timeline-setting-window.html # 时间轴设置窗口（精度 / 时间范围）
│
├── package.json
│
└── modules/
    ├── Database.js              # SQLite 数据库完整封装（所有 CRUD 操作）
    ├── MapManager.js            # Leaflet 地图管理（标记/聚合/框选/地标层）
    ├── Timeline.js              # 时间轴组件（渲染/拖拽交互/状态持久化）
    ├── PhotoFilesManager.js     # 目录扫描、EXIF 提取、批量数据库写入
    ├── ThumbnailGenerator.js    # 缩略图生成与 .gpt 本地缓存
    ├── Photo.js                 # 照片数据模型（含格式判断静态方法）
    ├── Tag.js                   # 标签数据模型（FaceTag/EventTag/LandmarkTag/CommonTag）
    ├── PhotoWindow.js           # 照片查看器窗口管理类
    ├── PhotosManageWindow.js    # 照片管理窗口管理类
    ├── TagManageWindow.js       # 标签管理窗口管理类
    ├── TagSelectWindow.js       # 标签选择弹窗管理类
    ├── MenuManager.js           # 应用菜单构建（含语言切换重建）
    ├── TimeLineSettingWindow.js # 时间轴设置窗口管理类
    └── i18n.js                  # 国际化模块（中文 zh / 英文 en）
```

**数据文件（运行时自动创建）/ Runtime-generated files:**

```
GeoPhoto/
└── photos.db                    # SQLite 数据库（照片、标签、设置等所有数据）
```

缩略图缓存文件（`.gpt`）与原始照片同目录存放。

Thumbnail cache files (`.gpt`) are stored alongside the original photo files.

---

## 8. 常见问题 / FAQ

### Q: `npm install` 失败 / `npm install` failed?

**中文**：确保已安装 Node.js 18+ 和 Visual Studio C++ 构建工具（Windows），然后重试：
```bash
npm install
```
若仍失败，单独重编译原生模块：
```bash
npx electron-rebuild -f -w better-sqlite3
```

**English**: Make sure Node.js 18+ and Visual Studio C++ Build Tools (Windows) are installed, then retry `npm install`. If it still fails, rebuild the native module manually:
```bash
npx electron-rebuild -f -w better-sqlite3
```

---

### Q: 照片没有显示在地图上 / Photos not showing on map?

**中文**：
- 确认照片包含 GPS EXIF 信息（很多截图、传输后的照片已剥离 GPS 数据）
- 检查时间轴范围是否覆盖照片拍摄时间
- 按 F12 打开开发者工具查看控制台错误

**English**:
- Confirm photos contain GPS EXIF data (screenshots and some social-media photos have GPS stripped)
- Check if the timeline range covers the photos' capture time
- Press F12 to open DevTools and check for console errors

---

### Q: 城市名称显示「Loading...」或不显示 / City name shows "Loading..." or nothing?

**中文**：检查网络连接；Nominatim API 有请求频率限制，城市名称会按队列逐个加载。

**English**: Check your internet connection. Nominatim has rate limits — city names load one at a time in a queue. Hover over more markers after a moment.

---

### Q: 视频缩略图无法显示 / Video thumbnails not loading?

**中文**：视频缩略图在首次打开时从第 0.1 秒提取并缓存，需要稍等片刻。确认视频格式在支持列表内（MP4、MOV、AVI 等）。

**English**: Video thumbnails are extracted from the 0.1-second mark on first open and then cached. Wait a moment for initial generation. Confirm the video format is in the supported list.

---

## 许可证 / License

ISC License © 2024

---

*GeoPhoto — 让每一张照片回到它被拍摄的地方。*

*GeoPhoto — Put every photo back where it was taken.*
