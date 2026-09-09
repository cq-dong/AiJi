# Anker 首届黑客松挑战赛 · 参赛记录

> AiJi（AI记）参赛用分支 `anker`，选择赛道一「智能录音」。
> 赛事时间 2026.09.07–10.17，线下决赛 10.16–10.17 深圳。

---

## 赛事信息

| 项目 | 内容 |
|------|------|
| 主办方 | 安克创新（Anker） |
| 首席技术合作伙伴 | 亚马逊云科技（AWS） |
| 赛事时间 | 2026.09.07 – 2026.10.17 |
| 预赛报名截止 | 2026.09.27 |
| 预赛材料提交截止 | 2026.09.27 |
| 出线名单公布 | 2026.09.30 |
| 线下决赛 | 2026.10.16 – 10.17（24小时集中开发 + 路演，深圳） |
| 技术开放日 | 2026.10.17 |
| 获奖选手返场 | 2026.10.26 |
| 总奖池 | 18 万+（各赛道 TOP3：3万/1万/5千，另设金点子奖 5千） |
| 决赛形式 | 2–4 人组队，现场 24 小时开发 + 路演 |
| 报名链接 | https://career.anker.com.cn/hackathon/ |

---

## 赛道选择

### 赛道一｜智能录音（推荐匹配）

**命题**：基于 Anker 录音豆（Recording Dongle）及官方开放 SDK，重新定义声音的采集、理解与反馈，把一次「听见」变成一次真正的理解。

**与 AiJi 的匹配度**：⭐⭐⭐⭐⭐

| 赛道要求 | AiJi 对应能力 |
|----------|--------------|
| 声音采集 | 语音采集（MediaRecorder/WebRTC），可对接录音豆硬件 |
| 声音理解 | STT（DashScope Paraformer WebSocket 实时转写）+ LLM 分析 |
| 智能反馈 | AI 自动分类、摘要生成、搜索检索、聚合回顾 |
| 多模态扩展 | 文本/图片/视频已有支持，语音是核心输入方式 |

**核心理念一致**：AiJi 的"记"本身就是从"听见/看到"到"理解/组织"的完整链路，与赛道一"把听见变成理解"的命题天然契合。

---

## 分支策略

| 分支 | 用途 | 基于 |
|------|------|------|
| `v2.5` | 主开发分支（日常迭代） | — |
| `anker` | **本分支**，Anker 参赛专用，录音豆 Port 先行集成（mock 适配，真 SDK 09-30 后替换） | `v2.5` |

**规则**：
- `anker` 分支从 `v2.5` 分出，仅用于参赛相关改动
- 录音豆 SDK 集成、参赛材料、演示 demo 均在此分支开发
- 不合并回 `v2.5`（除非参赛后决定将录音豆集成作为正式功能）
- 日常 `v2.5` 的 bug 修复若需同步到 `anker`，cherry-pick 处理

---

## 集成现状（2026-09-10，`anker` 分支已落地）

**关键赛事情报**（2026-09-09 官网核对）：SDK 完整版**仅向出线团队发放**（09-30 后，来源：官网 FAQ 评审与入围篇）——预赛（09-27 截止）前**无任何团队持有 SDK**，这是全局事实而非我方短板。预赛评审为五维材料评审：选题清晰度、方案清晰度、项目创新性、落地可行性、团队能力匹配。

因此策略是**架构先行**：录音豆 Port / 适配器接口 / UI / 标记链路已全部落地，音频走**真实 getUserMedia**（预赛演示视频可直接真流录屏，非假音频），设备侧用 mock 模拟——真 SDK 到手只需新增 `ankerDongle.ts` 适配器替换 mock，UI / Domain / 处理管线零改动。

### 已落地架构

```
Anker 录音豆 (soundcore Work 3200)
    ↓ 官方 SDK（09-30 出线后发放，暂缺）
RecordingDonglePort（src/ports/index.ts，独立于 CapturePort）
    onStateChange / scan / connect / disconnect /
    getAudioStream / markHighlight / getDeviceInfo
    ↓ mockDongle 适配器（设备模拟，音频 = 真实 getUserMedia）
采集页音频源切换（麦克风 ↔ 录音豆 chip + 扫描连接 sheet）
    ↓ 录音豆源走 startAudioFromStream 外流直采
    （WebSpeech 实时预览在 dongle 源关闭；Paraformer blob 管线不受影响）
STT → LLM → 落库 → 展示（既有处理管线不动）
录音中标记重点 → AudioPart.marks → 详情页回放器标记点点击跳转
```

### 落地明细

| 任务 | 内容 | commit |
|------|------|--------|
| Port + 类型 | RecordingDonglePort 端口 + AudioPart.marks 域类型 | `a32a42a` |
| mockDongle | 扫描/连接/音频流/重点标记全接口；设备模拟、音频真实（getAudioStream 重置计时锚） | `92885dc` |
| di + store | mockDongle 注册 + store `dongle` 状态切片与扫描/连接动作 | `91e70e3` |
| 采集页 | 音频源切换 chip + 扫描连接 sheet + `startAudioFromStream` 外流直采 | `a66d3c3` |
| 标记链路 | draftMarks → AudioPart.marks → detail 回放器标记点可点击跳转 | `afb1072` |

### 待确认事项（2026-09-09 更新）

- [x] 录音豆 SDK 的具体形态——**官方移动端 SDK，完整版仅出线后（09-30）发放**（来源：官网 FAQ 评审与入围篇）；预赛前无 SDK 是全局事实，非我方独有
- [ ] SDK 是否支持浏览器/PWA 环境，或需走 Capacitor 原生桥接——**待 09-30 拿到 SDK 验证**（架构已留双退路：Port 不绑 PWA API，换适配器即可）
- [ ] 音频流格式（PCM / AAC / 其他）——**待 SDK**；Port 已把流形态对齐 getUserMedia 返回值（MediaStream），下游 MediaRecorder / Paraformer 零改动复用
- [ ] SDK 提供的元数据范围（电量 / 固件等）——`getDeviceInfo` 接口已留位，待 SDK 填充
- [x] 9月9日赛题解析直播——已过；赛事情报以 2026-09-09 官网核对为准（本文更新即来源）

### 后续 / 待办

- 09-27 前完成预赛材料（见下「预赛材料进度」）
- 出线后（09-30）真 SDK 适配器 `ankerDongle.ts` 替换 mockDongle，并回填上面三条待确认
- 场景剧本模式（`?dongle=script`，设计稿 §2.2）**降级后置**——预赛视频用真流录屏即可，不阻塞主线

---

## 关键时间节点

| 日期 | 事项 | 备注 |
|------|------|------|
| 09.09 | 赛题解析直播 | 已过；SDK 完整版仅出线后发放（见「集成现状」） |
| 09.07–09.26 | 线上赋能直播 | 按需参与 |
| 09.27 | 预赛材料提交 | 作品说明文档 + 演示视频（23:59 截止，五维评审） |
| 09.30 | 出线名单公布 | 30 队出线；SDK 完整版向出线团队发放 |
| 10.16–10.17 | 线下决赛（深圳） | 24 小时开发 + 路演 |
| 10.17 | 技术开放日 | 同期活动 |
| 10.26 | 获奖选手返场 | — |

---

## 预赛材料进度

预赛评审五维：选题清晰度、方案清晰度、项目创新性、落地可行性、团队能力匹配；出线 30 队进入决赛。组队 2–4 人，**全员须在材料提交前完成报名注册**。材料两件，**均未开始**——当前最紧路径（09-27 23:59 截止）：

| 材料 | 内容 | 状态 | 截止 |
|------|------|------|------|
| 作品说明文档 | 作品介绍 + 技术方案 + 创新点（Anker 官方模板待获取；`docs/contest/鸿蒙赛道作品说明文档模板/` 的结构可参考） | 未开始 | 09-27 |
| 演示视频 | 真流录屏：录音豆（mock 设备 + 真实 getUserMedia 音频）源采集 → 转写 → 标记重点 → 详情回放跳转全链路 | 未开始 | 09-27 |
| 项目源码 | 本分支，架构就绪（Port + mockDongle + 标记链路，见上「集成现状」） | 就绪 | 随材料提交 |

---

## 相关链接

- 赛事官网：https://career.anker.com.cn/hackathon/
- 报名表：https://anker-in.feishu.cn/share/base/form/shrcnyFAWjMEOrM9o7h4d1oXrAe
- 线上赋能直播：https://anker-in.feishu.cn/app/JHPZbx0yKazWcbsA1plcsZYpn6d
- 技术开放日报名：https://anker-in.feishu.cn/share/base/form/shrcnTfa14uDUdXtjKo2FEp1sNc
- 微博介绍：https://weibo.com/ttarticle/p/show?id=2309405340846756331539