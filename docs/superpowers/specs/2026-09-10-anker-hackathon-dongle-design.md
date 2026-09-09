# Anker 黑客松 · 录音豆（soundcore Work 3200）集成设计

> 2026-09-10 · `anker` 分支 · 预赛材料截止 09-27 23:59，出线 09-30，决赛 10.16-17 深圳（24h 现场开发）

## 0. 赛事情报（2026-09-09 官网 + 选手中心侦察结论）

- **硬件**：soundcore Work 3200（"录音豆"），官方开放**移动端 SDK**，能力：录音、重点标记、状态信息。
- **SDK 发布节奏**：预赛前**任何队伍都拿不到 SDK 完整版**；出线后（09-30 后）主办方发布备赛工具包（SDK 完整版、硬件申请、开发环境指南）。
- **预赛评审五维度**：选题清晰度、方案清晰度、项目创新性、落地可行性、团队能力匹配。30 支队伍入围。
- **队伍**：2-4 人，提交预赛时系统校验全员已报名。
- **赛题导向**：声音采集不止于转写，要完成「理解、联动、反馈与流程推进」的闭环；鼓励具体场景（采访、陪护、维修、训练、桌游、调研）与形态改造。

**推论**：预赛材料的正确姿势 = 现有 AiJi 全链路（已生产可用）+ RecordingDonglePort 架构就绪 + mock 适配器演示「插上即用」；真 SDK 集成留到决赛 24h 现场完成，Port 就绪度直接决定那 24 小时的产出上限。

## 1. 目标与范围

**目标**：把「录音豆 + AiJi = 把一次听见变成一次理解」做成可演示、可提交、可决赛现场快速接真硬件的作品。

**范围（预赛前，09-27 截止）**：
1. `RecordingDonglePort` 端口 + `mockDongle` 适配器（模拟设备扫描/连接/音频流/重点标记）
2. 采集页音频源切换 UI（麦克风 ↔ 录音豆）
3. 贴题打磨：语音链路演示体验（重点标记 → 条目结构化的故事线）
4. 参赛材料：作品说明文档 + 演示视频

**不做**：真 SDK 集成（拿不到，决赛做）、设备形态硬件改造、server 端改动。

## 2. 技术设计

### 2.1 Port 定义（`src/ports/index.ts` 追加）

```ts
export type DongleState = 'idle' | 'scanning' | 'connected' | 'recording'
export interface DongleDevice { id: string; name: string }
export interface DongleInfo { name: string; batteryPct?: number; firmware?: string }

export interface RecordingDonglePort {
  /** 状态机：idle → scanning → connected → recording（回退沿同路径） */
  onStateChange(cb: (s: DongleState, device?: DongleDevice) => void): () => void
  scan(): Promise<DongleDevice[]>
  connect(deviceId: string): Promise<void>
  disconnect(): Promise<void>
  /** 已连接设备的音频流——形态对齐 getUserMedia 返回值，
      下游 MediaRecorder / Paraformer WS 管线零改动复用 */
  getAudioStream(): Promise<MediaStream>
  /** SDK 已知能力：重点标记。录音豆按键 → 当前条目打时间点标记 */
  markHighlight(label?: string): Promise<{ atSec: number }>
  getDeviceInfo(): Promise<DongleInfo>
}
```

**设计决策**：
- **不并入 CapturePort**：连接生命周期 + 硬件元数据 + 标记是独立概念；CapturePort 已经很胖（camera/gallery 9 个方法）。独立端口符合仓库既有演进（AppUpdatePort、FeedbackPort 均为后来单列）。
- **`getAudioStream()` 返回 MediaStream**：这是整个设计的关键铰链。现有 `webCapture.startAudio` 内部持有 getUserMedia 流；mock 与未来的真适配器只需产出 MediaStream，STT/录制/OPFS 落库管线全部复用。mock 用 `AudioContext` 合成音或捕获麦克风 + 加注「模拟设备」水印，接口层面与真设备无异。
- **markHighlight 显式进接口**：赛题原文点名「重点标记」能力，这是评分相关的差异化功能，必须一等公民。mock 适配器用 UI 按钮触发；真 SDK 到手后换成设备按键事件。

### 2.2 mock 适配器（`src/adapters/mockDongle.ts`）

- `scan()`：延迟 ~800ms 返回一个模拟设备「soundcore Work 3200 (Demo)」
- `connect()`：延迟 + 状态机推进 + 假电量（87%）
- `getAudioStream()`：`getUserMedia({audio})` 包一层——音频是真的（方便真机演示转写），设备是假的
- `markHighlight()`：记录 `(atSec, label?)`，按已连接时长计算
- **场景剧本模式**（演示视频用）：`?dongle=script` query 进入预设剧本——按时间轴吐出「采访场景」的模拟事件（连接 → 开始录音 → 3 个重点标记 → 断开），供无设备录 demo

### 2.3 UI：采集页音频源切换

- 录音控件旁加源切换 chip：`🎤 麦克风` / `🎧 录音豆`
- 录音豆态：显示连接状态徽标（idle/scanning/connected/recording）+ 电量 + 「标记重点」按钮
- 未连接时点录音豆 chip → 弹扫描 sheet（列表 + 连接按钮），mock 下必现一台设备
- **改动面**：`src/ui/screens/capture/`（widgets.tsx + index.tsx）+ `src/app/di.ts` 注册端口 + `src/app/store.ts`（dongle 状态切片）。不碰 Domain 层、不碰 StoragePort。

### 2.4 重点标记 → 条目结构化

- 录音中打的标记：存 `EntryPart` 音频部分的 `marks?: { atSec: number; label?: string }[]`（types.ts 加可选字段，向后兼容）
- 详情页音频回放器渲染标记点（可点击跳转）
- **AI 层**（贴题加分项）：classify prompt 注入标记上下文——「用户在这些时间点打了重点标记」→ 摘要侧重展开

### 2.5 参赛材料（复用鸿蒙赛已建的材料管线）

- 作品说明文档：参照 `docs/contest/c4-2026-intro.md` 的写法，重写为 Anker 赛道一版本——场景锚定「采访/会议记录」，技术方案强调 Port 架构 + 决赛集成路径
- 演示视频：mock 场景剧本模式录屏 + 现有真机链路（语音→转写→分类→问答→提醒）
- 海报/图标：复用 `docs/contest/` 已有物料

## 3. 时间线（今天 09-10，剩 17 天）

| 日期 | 里程碑 |
|---|---|
| 09-10~12 | Port + mock 适配器 + 采集页切换 UI（本设计 §2.1-2.3） |
| 09-13~15 | 重点标记全链路（§2.4）+ 场景剧本模式 + 贴题打磨 |
| 09-16~20 | 作品说明文档 + 演示视频脚本与录制（并行：补齐队友报名） |
| 09-21~24 | 全量 e2e 验收 + 视频剪辑 + 材料内审 |
| 09-25~27 | 终稿缓冲 + 提交（**目标 09-26 提交，不压 09-27 截止线**） |
| 09-30 后 | 出线 → 领 SDK → 真适配器替换 mock（决赛冲刺） |

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| 真用户 solo 报名无法提交（需 2-4 人） | **用户行动项**：立即报名 + 组队大厅找队友；这比任何代码都紧急 |
| 真 SDK 接口与 Port 预设差异大 | 差异被适配器吸收；Port 已按「音频流 + 标记 + 状态」赛题原文三能力建模，形态大变的概率低 |
| mock demo 被评委质疑真实性 | 材料中明确披露「官方 SDK 09-30 后发放，本 demo 演示架构就绪度」——所有队伍同一起跑线，诚实反而是加分项 |
| 评审更看方案而非 demo | 文档五维度对齐：选题（把听见变成理解）方案（Port 架构图）创新（重点标记×AI 记忆）落地（已上架 APK 生产可用）团队（待补齐） |

## 5. 验收标准

- `npx tsc -p tsconfig.app.json` 零错误；单测覆盖 mock 适配器状态机与标记时序
- e2e（390×844，prod build）：扫描→连接→录音豆源录音→保存→详情含标记点回放，全链路无 console error
- 演示视频 ≤ 规定时长（查提交要求），说明文档覆盖五评审维度
