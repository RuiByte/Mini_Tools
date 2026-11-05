# B 站杜比视界 P8.4 修正脚本

为兼容杜比视界的 Windows / Microsoft Edge 环境修正 B 站部分 Profile 8.4 视频的媒体类型声明。当前稳定版本为 **6.0.0**。

部分视频在 B 站有「杜比视界」画质，但播放器仍以普通 HEVC 类型创建视频缓冲区，可能只使用兼容基础层。脚本核实视频初始化段中的实际杜比元数据后，在创建缓冲区时使用对应的杜比声明。视频数据本身保持原样。

## 支持范围

| 内容或操作 | 当前行为 |
| --- | --- |
| Profile 8.4 | 核实实际元数据后自动修正声明 |
| 从搜索页、外部链接首次打开视频 | 在播放器首次连接前预检 |
| 右侧推荐列表切换视频 | 拦截播放器切换入口，按新 BV、CID 和分 P 重新预检 |
| 同一视频切换分 P | 各分 P 单独识别、缓存 |
| 预检晚于播放器启动 | 尝试自动重建播放器，并恢复进度与暂停状态 |
| Profile 5 | 保留 Edge / B 站的原有播放方式，不做 P8.4 修正 |
| Profile 8.1 | **尚未支持自动修正**，保留原有播放方式 |
| 普通 HDR / SDR、无法确认的流 | 保留原声明，不强制改成杜比视界 |

脚本只处理实际存在的流，不生成杜比元数据，不新增平台没有提供的画质，不替代会员权限、解码器、显卡驱动或显示设备能力。

## 使用条件

- Windows、显卡驱动与显示设备已具备可用的杜比视界播放链路。
- Microsoft Edge 可解码 HEVC 和杜比视界；按本机需要安装 HEVC 扩展、Dolby Vision 扩展等组件。安装 Dolby Access 本身不等于浏览器已经可播放所有杜比格式。
- B 站账号有对应画质的观看权限，且目标视频实际提供杜比视界流。
- 在日常使用的 Edge 用户配置中安装 Tampermonkey 等用户脚本管理器，并允许用户脚本运行。
- 对本次验证环境，Edge 需要使用下面的实验功能参数启动。不同版本或设备仍需实测。

```text
--enable-features=MediaFoundationClearPlayback,PlatformEncryptedDolbyVision,AllowClearDolbyVisionInMseWhenPlatformEncryptedDvEnabled
```

## 安装

1. 打开 [脚本安装地址](https://raw.githubusercontent.com/RuiByte/Mini_Tools/master/bilibili-dolby-vision/bilibili-dolby-vision.user.js)，按脚本管理器提示安装。若浏览器只显示文本，可在脚本管理器中新建脚本，粘贴 [bilibili-dolby-vision.user.js](./bilibili-dolby-vision.user.js) 的完整内容并保存。
2. 如果已经安装之前版本，直接替换原脚本，保持同一个脚本条目。
3. 完全退出 Edge 后，使用 [launch-edge-dv.cmd](./launch-edge-dv.cmd) 启动。它查找标准安装目录并打开常规用户配置，不创建隔离测试配置，不修改任务栏或系统设置。如果 Edge 仍在后台运行，新启动参数可能无法生效；可在 Edge 设置中关闭启动增强和后台运行，再正常退出。
4. 切到安装了脚本的 Edge 用户配置，确认脚本版本为 `6.0.0`。
5. 刷新已打开的 B 站视频页一次以载入新版。之后打开新视频或通过推荐列表切换，不应再需要手动刷新来学习元数据。

已有带上述参数的 Edge 快捷方式时，可继续使用该快捷方式。

脚本的 `@updateURL` 和 `@downloadURL` 目前为 `none`，**不自动从 GitHub 更新**。升级时手动替换并保存，然后刷新已打开的视频页。

## 日常使用

在播放器中选择视频实际提供的「杜比视界」画质。首次遇到未识别的视频时，脚本会先读取少量初始化数据，因此可能增加启动等待。若预检未赶上启动，会尝试在网页内重建播放器，期间可能短暂加载。

识别缓存写入 B 站域下的 `localStorage`，键为 `__bili_dv_p84_verified_v4__`。键名保留了历史版本后缀，v6 继续兼容使用：

- 没有固定的 24 小时过期时间。
- 按视频、分 P、编码和实际流身份区分，媒体地址临时签名变化不会单独导致失效。
- 最多保留 512 条记录，超过后按记录时间移除较旧记录。
- 清除网站数据、使用不同浏览器配置或进入新的 InPrivate 会话后，可能需要自动重新识别。
- 实际流身份变化或初始化段与缓存矛盾时，会重新核实或清除对应记录。

## 检查是否生效

1. 选择此前没有用脚本播放过的 P8.4 视频，观察首次播放。
2. 再从右侧推荐列表进入另一条此前未播放过的 P8.4 视频，观察首次播放。
3. 若有多分 P，检查切换分 P 后的行为。
4. 观察播放器杜比视界标志和正常画面；进一步确认解码路径时，可结合 `edge://media-internals`。单独一个标志不能说明整个显示链路如何处理动态元数据。

目前的 v6 已在本次 Windows / Edge 排障环境通过使用者实际验证；不据此保证所有设备、Edge 版本和 B 站视频都兼容。

出现问题时见 [故障排查](./docs/TROUBLESHOOTING.md)。

## 工作方式

脚本在 `document-start` 运行，观察 B 站播放信息，读取初始化段的 `moov → trak → mdia → minf → stbl → stsd` 配置，核实 Profile 8、兼容性 ID 4、RPU 与基础层标志。仅在元数据、视频流归属和浏览器原生能力均满足条件时，将普通 HEVC 声明改为相应的 `dvh1` / `dvhe` 声明。

v6 同时处理播放器 `connect`、推荐和分 P 使用的 `reload`，以及站内路由变化，避免继续使用最初页面的 BV / CID。不会通过强制调用 `SourceBuffer.changeType` 把已经开始播放的 HEVC 缓冲区切成杜比；预检未及时完成时，改为尝试重建播放器。

脚本通过当前网页的请求环境读取 B 站播放信息和允许的媒体 CDN 初始化段。缓存包含流身份与杜比配置，不保存账号 Cookie，也不会向外部日志服务上传诊断。

## 开发检查

需要 Node.js 18 或更高版本，无第三方依赖，无需执行 `npm install`。

在本目录运行：

```sh
npm run check
npm test
```

也可在仓库根目录运行：

```sh
node --check bilibili-dolby-vision/bilibili-dolby-vision.user.js
node bilibili-dolby-vision/tests/test.cjs
```

当前包含 32 项离线逻辑检查，覆盖首次识别、推荐切换、分 P、连续快速切换、缓存超过 48 小时、隐藏响应头、普通 HDR 排除、原生能力失败及恢复等场景。这些检查使用模拟网页接口和真实初始化段，**不等同于真实浏览器输出验证**。

初始化段样本的来源和许可见 [第三方说明](./tests/fixtures/THIRD_PARTY_NOTICES.md)。完整测试视频可从 [Jellyfin Test Videos](https://sgp1.mirror.jellyfin.org/test-videos/) 获取。

## 文件

```text
bilibili-dolby-vision/
├── bilibili-dolby-vision.user.js
├── launch-edge-dv.cmd
├── README.md
├── CHANGELOG.md
├── package.json
├── docs/
│   └── TROUBLESHOOTING.md
└── tests/
    ├── test.cjs
    └── fixtures/
        ├── p5-init.bin
        ├── p84-init.bin
        ├── manifest.json
        └── THIRD_PARTY_NOTICES.md
```
