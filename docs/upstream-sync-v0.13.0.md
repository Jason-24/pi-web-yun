# 上游同步：v0.13.0

同步日期：2026-10-29。

- 上游：`https://github.com/agegr/pi-web.git` 的 `main`。
- 上游提交：`d128bae47cd3abbdfe7135443ac793f547c14e47`（Release v0.13.0）。
- 共同基点：`b017cd48425d05aa4952051db2e4fc031c134094`；本次接入上游 99 个提交。
- 本地分支：`codex/sync-upstream-v0.13.0`；已配置 `upstream` remote。

## 兼容处理

- 保留 `pi-yun` 包名、0.2.3 版本、仓库地址和现有发布命令。上游 npm 发布工作流限定在 `agegr/pi-web` 仓库执行。
- 保留 PI-YUN 的导航、内嵌设置与历史、文件搜索和路径栏、文件区布局、宠物及项目草稿记忆。
- 将 Debug 面板接入现有工作区，保留 composer 中的使用量展示；Debug 随会话切换更新。
- 接入上游 SSE/lease、发送恢复、子代理完成状态、模型和 Markdown 更新。失败、停止或仍有子代理工作的父会话不会触发成功庆祝。
- 对齐本地安装的全部七个 `@earendil-works/*` 包到精确版本 1.4.0。
- 兼容本机 Git 2.30：自行解析相对 common-dir，避免不支持的 `--path-format=absolute` 破坏项目、分支和工作树识别。
- 标签栏结合上游的条带内滚动与原有 ResizeObserver，保证视口变化时当前标签仍可见。
- 更新旧测试中的 fork 标题栏、导航按钮、宠物控件、Windows 临时目录及换行假设；Git diff 测试遵循上游的真实路径边界。

## 验证

- TypeScript：`tsc --noEmit --incremental false` 通过。
- ESLint：`npm run lint` 通过。
- Debug、工作区记忆、侧栏断点、标签栏及 pi 依赖专项测试：39 项全部通过。
- 完整 Node 测试：3192 项，3127 通过、29 失败、36 跳过。
- 浏览器专项回归：1280px/390px 文件预览状态、扩展弹窗尺寸与键盘交互通过；文件搜索、源代码/HTML/CSV 切换、Safari 搜索降级、标签切换和手机布局通过。
- 工作区及归档专项回归通过，覆盖草稿/阅读位置保留、系统/工具/历史/设置/分支/代理视图、宠物、文件区拖动、会话切换、归档恢复/删除/失败重试及手机布局。

完整测试仍有本机平台相关失败，涉及 Windows 文件符号链接权限、POSIX 权限位、Bash/PATH、文件 URL 和 home 路径夹具、原生 PTY，以及 Git 2.30 不支持的所有权检查。完整 E2E 入口也未全部跑通：历史缩略图悬停断言有超时；上面列出的专项回归已单独完成，不能据此声称整套 E2E 全绿。

完整测试计数与日志保存在本地 `test-results/upstream-sync/`。未运行生产构建，未发布 npm 包或推送远端。
