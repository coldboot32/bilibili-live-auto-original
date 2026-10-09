# 哔哩哔哩直播自动原画与码率统计

自用 Tampermonkey（油猴）脚本，当前版本 **2.1.1**。

## 功能

- 进入直播间后，通过播放器接口选择原画，无需展开画质菜单。
- 确认切换成功后停止自动切换，允许随后手动调整画质。
- 在播放器自带的“视频统计信息”面板中添加 `Video Bitrate`、`Audio Bitrate`。
- 在视频和音频信息中显示当前编码，例如 AV1、H.264、H.265、AAC-LC。
- 不创建额外悬浮窗，不上传统计数据。

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
- 已通过 JavaScript 语法检查及本地模拟分片测试；尚未完成最新版在真实直播中的端到端验证。

脚本保留少量控制台日志及不可见诊断属性，用于排查切换失败。

## 许可证

[MIT License](LICENSE) · Copyright (c) 2026 coldboot32
