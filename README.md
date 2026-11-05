# Mini_Tools

实用小工具集合。每个工具的代码、使用说明及相关资源都放在独立目录中，方便单独使用和维护。

## 工具列表

| 工具 | 目录 | 说明 |
| --- | --- | --- |
| GitHub 简体中文汉化脚本 | [github-zh-cn](./github-zh-cn/) | 将 GitHub 和 Gist 的界面文字翻译为简体中文 |
| B 站杜比视界 P8.4 修正脚本 | [bilibili-dolby-vision](./bilibili-dolby-vision/) | 核实实际 P8.4 元数据并修正 Edge 视频声明，支持首次播放、推荐列表和分 P 切换 |

## 目录结构

```text
Mini_Tools/
├── bilibili-dolby-vision/
│   ├── bilibili-dolby-vision.user.js # v6.0.0 用户脚本
│   ├── launch-edge-dv.cmd            # Windows Edge 启动器
│   ├── README.md                     # 支持范围、安装和使用说明
│   ├── CHANGELOG.md                  # 版本说明
│   ├── docs/                         # 故障排查
│   └── tests/                        # 离线检查与初始化段样本
├── github-zh-cn/
│   ├── README.md               # 安装和使用说明
│   └── github-zh-cn.user.js     # 汉化脚本
├── AGENTS.md                   # 开发约定
└── README.md
```

## 添加工具

1. 为新工具创建独立目录，目录名使用简洁的英文名称。
2. 将该工具的代码、依赖配置和资源放在自己的目录中。
3. 在工具目录中提供 README，说明用途、安装方式和使用方法。
4. 更新上方工具列表。
