# 验收缺陷记录 · v0.1.0-rc1 真机反馈

> 来源：2026-07-17 用户真机安装 aiji.apk 后逐条反馈。Phase A（私有自测）通过，以下问题归入 Phase B 门禁前修复，或并入正式发版门禁。

## D1 · 屏幕安全区未适配（底部导航栏被系统遮挡）
- **严重度**：高（阻塞可用性）
- **触发**：真机安装，所有页面
- **现象**：
  - 时间线首页：记录多 → 底部功能栏只显示一半，需滑到最底才全显
  - 采集页：底部可能显示不全
  - 多页面存在此问题
- **根因**：UI 按 390×844 原型尺寸设计，未处理 Android 系统导航栏（ gesture nav / 三键 nav）占用的 `safe-area-inset-bottom`，真机底部被系统栏遮挡。
- **修复**：全局 bottom padding 用 `env(safe-area-inset-bottom)` 或 `padding-bottom` 动态适配；NavBottom 和 FAB 位置上移；各 screen 内容区底部留足安全区。Capacitor 环境下通过 `Capacitor.getStatusBarHeight()` 和 `SafeArea` 插件获取安全区 insets。
- **验收**：各页面底部内容不被系统导航栏遮挡；记录多时功能栏始终可见；采集页底部操作按钮完整显示。

## D2 · 模拟状态栏冗余（真机双层状态栏）
- **严重度**：中（体验）
- **触发**：真机打开任意页面
- **现象**：App 内部画了模拟时间（9:41）和信号图标，真机本身有系统状态栏，导致双层冗余。
- **根因**：`Statusbar` 组件是 PWA 原型阶段的模拟状态栏（390×844 设计稿内嵌），Capacitor 真机已有原生状态栏。
- **修复**：`Capacitor.isNativePlatform()` 时隐藏/不渲染 `Statusbar` 模拟层；PWA 环境保留（浏览器内无系统状态栏）。或通过 Capacitor StatusBar 插件设置透明/沉浸，让系统状态栏成为唯一层。
- **验收**：真机打开 App，顶部只有系统状态栏，无 App 内部模拟层；PWA 浏览器内仍有模拟状态栏。

## D3 · 麦克风已授权但显示未授权（采集页）
- **严重度**：高（阻塞核心功能）
- **触发**：采集页 → 点麦克风录音
- **现象**：用户已授权麦克风权限，但 App 仍显示「未授权」或无法录音。
- **根因**：权限检测逻辑可能只检查 Web API `navigator.permissions.query({name:'microphone'})`，在 Android WebView 中该 API 返回不准确；或 Capacitor 桥接未正确传递权限状态。
- **修复**：Capacitor 环境下用 `Capacitor.getPlatform()` + `Permissions` 插件（或自定义）获取原生权限状态；Web 环境保留现有 `navigator.permissions` 检测。录音前先尝试 `getUserMedia({audio:true})`，失败再抛权限不足，避免 false negative。
- **验收**：真机授权麦克风后，采集页麦克风按钮正常可用；录音开始/停止/保存链路完整。

## D4 · 提醒功能缺失（无铃声/弹窗/卡片丑/不能编辑）
- **严重度**：高（功能不完整）
- **触发**：设置提醒后到达时间
- **现象**：
  - 无铃声通知
  - 无弹窗通知
  - 待提醒卡片 UI 丑
  - 已设提醒无法编辑时间和内容
- **根因**：
  - 提醒依赖前台 `setTimeout`，应用进后台或被杀后无法触发（无原生 Local Notifications）
  - Manifest 无 Android 13+ 通知权限声明
  - 卡片样式未按设计稿走
  - 缺少编辑入口
- **修复**：
  1. 接入 `@capacitor/local-notifications` 或原生 AlarmManager，实现后台可靠提醒（铃声+弹窗）
  2. AndroidManifest 加 `POST_NOTIFICATIONS` 权限（Android 13+）
  3. 卡片 UI 按设计 tokens 走（圆角、字号、间距）
  4. 已设提醒卡片加「编辑」按钮，可改时间/内容
- **验收**：设置提醒 → 锁屏/后台 → 到达时间触发铃声+弹窗通知；卡片样式统一；点击已设提醒可编辑。

## D5 · 地点显示原始经纬度（无地理编码）
- **严重度**：中（体验）
- **触发**：采集页打开「记录地点」→ 保存条目 → 查看详情
- **现象**：
  - 采集页显示原始经纬度数字，对用户无意义
  - 保存后条目详情没有显示地点信息
- **根因**：直接存储 `GeolocationPosition.coords.latitude/longitude` 原始值，未做反向地理编码（reverse geocoding）转成人类可读地址。
- **修复**：
  1. 采集时调用反向地理编码 API（如 Google Maps Geocoding / 高德 / 百度，或免费开源方案如 Nominatim），将经纬度转为「北京市朝阳区xx街道」等地址文本
  2. 存储 `location: { lat, lng, address }` 结构，UI 显示 `address`（无 address 时 fallback 到 lat/lng）
  3. 条目详情页显示地点标签（带地图 pin icon）
- **验收**：采集页显示人类可读地址；保存后条目详情页显示地点信息；无网络时 fallback 显示经纬度。

## D6 · 摘要每次进入都重新生成（无缓存）
- **严重度**：中（性能+体验）
- **触发**：摘要页 → 点击日/周/月摘要
- **现象**：即使之前已生成，每次进入都显示「正在重新生成」，浪费 API 调用和等待时间。
- **根因**：摘要没有本地缓存机制，每次进入页面都重新调 LLM 生成。
- **修复**：
  1. 摘要结果存入本地存储（IndexedDB/Dexie），key 为 `summary-${type}-${dateKey}`
  2. 进入页面先读缓存，有则直接展示，无则生成
  3. 更新策略：
     - 日摘要：每次新记录后自动重新生成（或记录时触发增量更新）
     - 周摘要：每日自动更新（或进入页面时检查是否已跨天）
     - 月摘要：每周自动更新（或进入页面时检查是否已跨周）
  4. 提供「刷新/重新生成」按钮，让用户手动强制更新
- **验收**：已生成摘要再次进入秒开；新记录后日摘要自动刷新；周/月按策略更新；有手动刷新入口。

## D7 · 多模态 LLM 处理未标注媒体类型
- **严重度**：中（AI 回答质量）
- **触发**：AI 问答/摘要时，条目含图片/视频/语音
- **现象**：LLM 处理内容摘要时，不知道哪些信息来自图片、视频、语音，导致回答不够准确/鲁棒。
- **根因**：EntryPart 缺少媒体类型标注，LLM prompt 未区分文本 vs 媒体内容。
- **修复**：
  1. 在 EntryPart 中增加 `mediaType?: 'image' | 'video' | 'audio' | 'text'` 字段
  2. 采集时根据来源自动标记媒体类型（拍照→image，录视频→video，录音→audio，打字→text）
  3. LLM prompt 中按媒体类型分块描述：「以下图片内容：...」「以下语音转文字：...」「以下文本：...」
  4. 摘要和问答 prompt 都带上媒体类型上下文
- **验收**：含图片/视频/语音的条目，AI 摘要/问答能明确区分媒体类型并据此回答。

## D8 · 相机已授权但录视频显示未授权
- **严重度**：高（阻塞核心功能）
- **触发**：采集页 → 点视频录制
- **现象**：用户已授权相机权限，拍照可用，但录视频显示未授权。
- **根因**：视频录制可能额外需要 `RECORD_AUDIO` 权限（视频含音频轨），但权限检测只检查了 `CAMERA`；或视频录制用的 `getUserMedia` 约束与拍照不同，导致 WebView 权限弹窗行为不一致。
- **修复**：
  1. 视频录制时同时请求 `CAMERA` + `RECORD_AUDIO` 权限
  2. 权限检测逻辑区分「拍照仅需 CAMERA」vs「录像需 CAMERA+AUDIO」
  3. 若用户只授权了 CAMERA 没授权 AUDIO，提示「录像需要麦克风权限，请在设置中开启」
- **验收**：授权相机+麦克风后，视频录制正常开始；只授权相机时友好提示需额外授权麦克风。

## D9 · 安装包包含测试记录（seed 数据泄露）
- **严重度**：高（隐私/数据污染）
- **触发**：首次安装打开 App
- **现象**：用户首次安装就看到 12 条示例记录，包含测试数据，像数据泄露。
- **根因**：`src/adapters/dexieStorage.ts` 在空数据库时自动灌入 `seedEntries` 等原型数据；`src/app/store.ts` 启动时也使用 seed 数据。
- **修复**：
  1. 移除生产环境自动 seed 逻辑（dexieStorage.ts 的 `if count === 0 then seed()`）
  2. 改为「首次引导 → 询问是否导入示例数据」或设置页中「导入示例数据」按钮
  3. store.ts 启动时不再用 seed 数据 hydrate
  4. seed 数据仅保留在 dev 环境（`import.meta.env.DEV`）
- **验收**：全新安装后数据库为空，无示例数据；设置页有「导入示例数据」入口；dev 环境自动 seed 保留方便开发。

## D10 · 导出无反应（WebView 程序化下载失效 + 无确认/无反馈）
- **严重度**：高（阻塞核心功能）
- **触发**：设置页「导出全部」/ 详情页「更多→导出」/ 分类页「导出分类」
- **现象**：点击导出按钮后无任何反应，不知道是否导出成功、文件存哪。
- **根因**：
  1. `src/adapters/zipExport.ts` 三个导出函数（`exportZip`/`exportEntryZip`/`exportCategoryZip`）全用 `URL.createObjectURL(blob)` + 动态 `<a download>` + `a.click()` 程序化触发下载。在 Android WebView 中，`<a download>` 的程序化点击不可靠——WebView 默认不处理下载，需接 `DownloadListener` 或走原生文件保存；`androidScheme:https` 下 `blob:` URL 也可能被拦。
  2. 全流程 fire-and-forget：无 loading 态、无成功/失败 toast、无确认对话框。用户点完不知道发生了什么。
  3. 无路径说明：导出的 zip 存哪、叫什么名、怎么找到，用户无感知。
- **修复**：
  1. Capacitor 环境改用原生文件写入：`@capacitor/filesystem` 写到外部存储（`Directory.External` 或 `Documents`），或用 Web Share API（`navigator.share({ files: [...] })`）拉起系统分享/保存面板。PWA 浏览器环境保留 `a.click()` 下载。
  2. 加确认操作：点击导出 → 弹确认对话框（说明导出范围 + 文件名 + 预估大小 + 存储位置）→ 确认后执行。
  3. 加全程反馈：导出中 loading（zip 构建 + 媒体读取耗时），成功 toast（「已导出至 xxx，N 条记录，M 个媒体」+ 路径），失败 toast（错误原因）。
  4. 路径说明：成功提示里明确文件保存位置（如「已保存到 下载/AiJi/aiji-export.zip」或分享面板选的目标）。
- **涉及文件**：`src/adapters/zipExport.ts`（核心，三函数重写下载落盘逻辑 + 反馈）、调用方 `src/ui/screens/settings/index.tsx` / `src/ui/screens/detail/index.tsx` / `src/ui/screens/categories/CategoryDetail.tsx` / `src/ui/screens/categories/CategoryEditSheet.tsx`（加确认对话框 + 反馈 toast）。可能新建 `src/adapters/fileShare.ts` 封装平台分流（Web Share files / Filesystem 写入 / a.click fallback）。
- **验收**：点导出 → 确认对话框 → loading → 成功 toast 带路径 / 失败 toast 带原因；文件可在手机文件管理器找到或经分享面板保存。
