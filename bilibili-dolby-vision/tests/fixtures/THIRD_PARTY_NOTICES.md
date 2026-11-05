# 初始化段样本来源与许可

本目录的 `p5-init.bin`、`p84-init.bin` 来自 Gnattu 提供的 Jellyfin 公开测试视频。

- 作者：[Gnattu](https://github.com/Gnattu)。
- 来源：[Jellyfin Test Videos](https://sgp1.mirror.jellyfin.org/test-videos/)。该页面列出测试文件、校验和与许可。
- 许可：[Creative Commons Attribution-ShareAlike 4.0 International（CC BY-SA 4.0）](https://creativecommons.org/licenses/by-sa/4.0/)。本目录提取的初始化段样本继续按该许可提供；该说明仅针对这些第三方样本。
- 原文件：`Test Jellyfin 1080p DV P5.mp4`、`Test Jellyfin 1080p DV P8.4.mp4`。

## 修改说明

从原 MP4 中提取顶层 `ftyp` 和 `moov` box，按原顺序拼接为 `.bin` 文件。原 box 内容未作转码或编辑；删除了其他顶层 box，包括包含音视频样本的 `mdat`。这些二进制文件只用于初始化配置解析检查，不能作为完整视频播放。

测试代码会在内存中进一步生成缺少杜比配置、兼容性 ID 改变或缺少 RPU 标志的变体，用于验证不应自动修正的情况。这些变体没有作为额外二进制文件保存。

原视频 SHA-256：

| 原文件 | SHA-256 |
| --- | --- |
| `Test Jellyfin 1080p DV P5.mp4` | `c0dedeeef7d11c404955e126f9544318cdeb6eab62423528cfde9b567e8ca1a4` |
| `Test Jellyfin 1080p DV P8.4.mp4` | `eaf21cc55e31694758c9d5cf2ba9f7b448f8447655907380259d4e42a2ea7276` |

提取后文件的大小和 SHA-256 见 [manifest.json](./manifest.json)。
