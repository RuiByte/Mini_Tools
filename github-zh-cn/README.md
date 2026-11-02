# GitHub 简体中文汉化脚本

通过浏览器用户脚本管理器，将 GitHub 和 Gist 的界面文字翻译为简体中文。

## 安装与使用

1. 在浏览器中安装用户脚本管理器，例如 Tampermonkey。
2. 打开 [脚本安装地址](https://raw.githubusercontent.com/RuiByte/Mini_Tools/master/github-zh-cn/github-zh-cn.user.js)，按脚本管理器提示安装；也可以新建脚本并粘贴 [github-zh-cn.user.js](./github-zh-cn.user.js) 的完整内容。
3. 打开或刷新 GitHub、Gist 页面，即可使用汉化功能。

可在脚本管理器的脚本菜单中切换开启或关闭汉化，切换后页面会刷新。

## 功能与范围

- 支持 `github.com` 和 `gist.github.com`。
- 包含界面词典、动态文本匹配，以及动态页面更新处理。
- 设计上只翻译界面文字，保留代码、Markdown、评论、仓库名等用户内容。
- 独立脚本，无需构建。GitHub 界面更新后，部分文字可能需要补充适配。

## 开发检查

在仓库根目录运行：

```sh
node --check github-zh-cn/github-zh-cn.user.js
```

该命令只检查 JavaScript 语法。修改翻译或页面处理逻辑后，还需在浏览器中验证首次加载、动态更新、页面切换及开关功能。
