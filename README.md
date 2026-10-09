# 哔哩哔哩直播自动原画与码率统计

[中文](#功能) | [English](#english)

自用 Tampermonkey（油猴）脚本，当前版本 **2.2.1**。

## 功能

- 进入直播间后，通过播放器接口选择原画，无需展开画质菜单。
- 确认切换成功后停止自动切换，允许随后手动调整画质。
- 确认需要画质编号匹配且页面明确显示原画标签；标签缺失、为空或仍显示自动时不会误报成功，最多尝试 5 次后报告未确认。
- 面板异常不会中断自动原画；切换请求超过 10 秒后允许重试，最多尝试 5 次，并忽略迟到的旧请求回调。
- 在播放器自带的“视频统计信息”面板中添加 `Video Bitrate`、`Audio Bitrate`。
- 在视频和音频信息中显示当前编码，例如 AV1、H.264、H.265、AAC-LC。
- 不创建额外悬浮窗，不上传统计数据。
- 码率按主播放器的 MediaSource 隔离，避免预览小窗等播放器覆盖数据。

## 安装

1. 安装并启用 Tampermonkey，按浏览器要求开启用户脚本权限。
2. [点击安装脚本](https://raw.githubusercontent.com/coldboot32/bilibili-live-auto-original/main/bilibili-auto-original-silent.user.js)。
3. 刷新哔哩哔哩直播间。已经安装旧版的，可以在油猴编辑器中全选替换、保存后刷新。
4. 在播放器右键菜单中打开“视频统计信息”，查看新增内容。

脚本匹配 `https://live.bilibili.com/*`，自动原画仅在数字房间路径中运行。

## 码率含义

新增的码率根据播放器接收的 fragmented MP4 分片计算：**编码样本字节数 × 8 ÷ 样本媒体时长**。它分别统计视频和音频，显示近期约 10 秒媒体分片的平均值，使用十进制 Kbps / Mbps。

它与面板原有的 `Download Bitrate`（下载速度）不同；音频信息中原有的码率则来自流元数据。计算不包含 MP4 容器开销，不能直接用于衡量网络带宽占用。

## 兼容与验证

- 脚本依赖哔哩哔哩播放器的接口和统计面板结构，网站更新可能影响功能。
- 码率统计需要页面主线程的 Media Source Extensions `SourceBuffer`，并读取初始化段和分片样本信息。原生播放、Worker 内播放或未支持的分片格式可能显示 `N/A`。
- 为捕获初始化段，脚本在 `document-start` 运行，安装或更新后需要刷新页面。
- 支持初始化段、盒子头、分片元数据及 `mdat` 载荷跨多次 `appendBuffer` 追加。只缓存最多 2 MiB 的元数据，媒体载荷不缓存；大小为 0 的顶层盒子、超限元数据或损坏边界会停止该 SourceBuffer 的统计，显示 `N/A`。`abort` / `changeType` 会重置解析状态，必要时需重新收到初始化段才能恢复统计。
- 来源关联依赖主线程 MediaSource 的 blob URL 或直接 `srcObject`，最多保留 256 个 URL 的弱引用；无法关联主播放器时显示 `N/A`，不会回退到其它播放器的数据。
- 已通过 JavaScript 语法检查及覆盖上述五项问题的本地回归测试；尚未完成最新版在真实直播中的端到端验证。

脚本保留少量控制台日志及不可见诊断属性，用于排查切换失败。

## 本地测试

无需第三方依赖，在仓库目录执行：

```sh
node tests/regression.cjs
```

## 许可证

[MIT License](LICENSE) · Copyright (c) 2026 coldboot32

---

## English

### Bilibili Live Auto Original Quality and Bitrate Statistics

A personal Tampermonkey userscript. Current version: **2.2.1**.

### Features

- Selects Bilibili's Original quality (原画) through the player API when you enter a live room, without opening the quality menu.
- Stops switching once the selection is confirmed, allowing you to change quality manually afterward.
- Confirmation requires both a matching quality code and an explicit Original label. Missing, empty, or automatic-mode labels never count as success; after up to five attempts, the script reports that switching could not be confirmed.
- Panel failures do not interrupt quality selection. Switching requests time out after 10 seconds, with up to five attempts; callbacks from stale requests are ignored.
- Adds `Video Bitrate` and `Audio Bitrate` to the player's built-in statistics panel (视频统计信息).
- Displays video and audio codec names, such as AV1, H.264, H.265, and AAC-LC.
- Does not create an additional floating panel or upload statistics.
- Isolates bitrate statistics by the main player's MediaSource so other players, such as previews, cannot overwrite them.

### Installation

1. Install and enable Tampermonkey, and enable userscript permissions as required by your browser.
2. [Install the userscript](https://raw.githubusercontent.com/coldboot32/bilibili-live-auto-original/main/bilibili-auto-original-silent.user.js).
3. Reload the Bilibili live room. If you already have an older version, replace its entire contents in the Tampermonkey editor, save, and reload.
4. Open 视频统计信息 (video statistics) from the player's right-click menu to see the added information.

The script matches `https://live.bilibili.com/*`. Automatic quality selection runs only on numeric room paths.

### What the Bitrates Mean

The added bitrates are calculated from fragmented MP4 segments received by the player: **encoded sample bytes × 8 ÷ sample media duration**. Video and audio are measured separately, using an average over approximately 10 seconds of recent media fragments. Units are decimal Kbps / Mbps.

These values differ from the existing `Download Bitrate`, which measures download speed. The bitrate already shown in the audio information comes from stream metadata. The calculation excludes MP4 container overhead and should not be used directly to measure network bandwidth consumption.

### Compatibility and Validation

- The script depends on Bilibili's player API and statistics panel structure. Site updates may affect functionality.
- Bitrate measurement requires a Media Source Extensions `SourceBuffer` on the page's main thread and readable initialization segments and fragment sample information. Native playback, playback inside a Worker, or unsupported fragment formats may show `N/A`.
- The script runs at `document-start` to capture initialization segments. Reload the page after installing or updating it.
- Handles initialization segments, box headers, fragment metadata, and `mdat` payloads split across multiple `appendBuffer` calls. Only metadata is buffered, with a 2 MiB limit; media payloads are skipped without buffering. Zero-sized top-level boxes, oversized metadata, and corrupt boundaries disable statistics for that SourceBuffer and show `N/A`. `abort` / `changeType` resets parsing state; a new initialization segment may be required to resume measurement.
- Source association requires a main-thread MediaSource blob URL or direct `srcObject`. Up to 256 URL weak references are retained. If the main player cannot be associated, the script shows `N/A` instead of using another player's data.
- JavaScript syntax checks and local regression tests covering the five issues above have passed. End-to-end verification of the latest version in a real live stream has not yet been completed.

The script retains a few console logs and invisible diagnostic attributes to help troubleshoot quality-switching failures.

### Local Tests

No third-party dependencies are required. Run from the repository directory:

```sh
node tests/regression.cjs
```

### License

[MIT License](LICENSE) · Copyright (c) 2026 coldboot32
