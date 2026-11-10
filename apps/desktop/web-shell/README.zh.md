# 织流桌面网页壳

[English](README.md) | 中文

该入口在 Electron 中直接加载 `https://dev.echoai.best/enterprise`，复用网页企业版的登录、工作台、会话、企业资源、配额和模型能力。

- 通过 `skin.css` 和 `skin.js` 在工作台注入独立的“企业 AI 工作台”视觉，不替换底层 React 功能。
- 窗口使用自绘 40px 标题栏：承载品牌与拖拽区，为 Windows 原生窗口按钮留出位置；工作台之外只保留窗口条，登录页和管理后台继续使用页面自身的顶栏。
- 顶部品牌栏、左侧工作台导航、项目会话卡片和中央创作台采用独立的布局与配色。
- 顶栏分隔线跟随展开侧栏的实际边界，拖动侧栏或调整窗口时同步；工作空间文字与会话标题左对齐。侧栏收起或作为抽屉显示时，隐藏顶部分隔线，保留完整品牌文字。
- 工作台侧栏隐藏“更多”入口及“资源”分组标题、折叠箭头，文件、知识库、技能三个入口保持显示；收起侧栏时同样隐藏“更多”图标。
- 配额仅保留页面原有入口，品牌顶栏不再复制余额。会话工具栏明确区分“本月剩余”和“已用”，个人用量及月度总量保留在原有悬停说明及套餐额度页中；窄容器优先保留剩余额度，警告和不足状态保持语义颜色。自动化任务等未提供配额的页面不显示占位或残留数值。
- 顶栏通过单个太阳／月亮图标按钮切换外观，图标、悬停提示和无障碍名称表示下一次切换的目标。默认日间，选择保存在当前桌面会话的 `localStorage`（`zhiliu.desktop.theme`）；刷新和重启后恢复。存储不可用时仍允许切换本次页面的外观。
- 账号信息统一保留在左下角入口，顶栏不再重复显示。新会话按钮隐藏快捷键文字，保留键盘快捷键功能。
- 工作台使用两套语义颜色，覆盖文字、输入框、菜单、代码、空状态和按钮悬停；底层主题属性随桌面选择同步，离开工作台后恢复网页主题。企业控制台继续使用自身的外观设置。
- `preload.cjs` 将页面主题同步给 Electron 原生标题栏；主进程仅接收当前企业云主窗口顶层页面的合法主题值。
- 管理后台启动时显示“正在加载企业控制台…”，不再显示旧标志或工作台跳转提示；启动和数据加载指示器沿用后台的日夜主题颜色，减少动态效果时停止旋转。工作台之外窗口栏跟随页面自身的主题，因此后台切换主题也会重绘原生标题栏。动画的显示与移除仍由页面真实请求状态控制。
- 企业控制台、工作台侧栏和会话空状态的品牌标志统一为织流图标；桌面内嵌后台的侧栏仍只保留名称，并将默认的“织流企业 AI 工作台”显示为“企业 AI 工作台”；收起侧栏时名称截断显示。
- 页面只允许在企业云域名内导航，外部链接交由系统浏览器打开。
- 登录状态保存在独立的持久化 Electron 会话中。
- 原始本地 Harness 入口保留为 `Launch-Harness.ps1`。
- 桌面窗口图标使用 `assets/zhiliu-icon.png`（1024px 透明圆角），顶部品牌栏通过 `assets/zhiliu-icon-128.png` 注入的 `--zl-brand-icon` 显示同一图标；`assets/zhiliu-icon.ico` 包含 16–256px 的九种尺寸，可用于 Windows 快捷方式。企业控制台复用 `apps/enterprise/public/brand-mark.png` 和 `favicon.png`。图案为蓝底白色交织流带，通过用户指定的生图接口生成；源图和提示词保存在 `output/imagegen/`。运行时不依赖生图接口或 API 密钥。

日间使用浅灰蓝背景与蓝色主按钮，夜间使用深蓝灰背景及柔和文字。右侧面板的外层及 DockKit surface 必须保持透明，背景由实际打开的面板绘制，避免关闭后遮挡会话。输入框只设置基础文字颜色，角色、指令和文件引用标签保留各自的语义颜色。修改皮肤后重启桌面壳，在两种模式下检查自动化任务及其新建面板、已有会话、新会话、引用标签的悬停与选中、窄窗口以及侧栏展开和收起状态。

在仓库根目录运行 `node --test apps/desktop/web-shell/tests/appearance.spec.cjs`，检查主题切换、偏好恢复、存储不可用、退出工作台和原生标题栏同步。颜色、悬停和窗口布局仍需在实际 Electron 页面中验证。

## Windows 客户端更新

安装版启动 15 秒后自动检查更新，之后每 4 小时检查一次。更新源为 `https://dev.echoai.best/desktop-updates/windows/x64/`，读取 `latest.yml`。发现更高的稳定版本后自动下载并校验 SHA512，下载完成在顶栏显示“重启更新”。点击后原生对话框提醒保存工作，默认选择“稍后”，确认后才退出并运行安装程序。普通退出不会自动安装，失败不会中断工作台，可从顶栏重试；按 Alt 打开“帮助 → 检查客户端更新”，在登录页和管理后台也可检查。主进程仅接受当前企业页面主窗口顶层 frame 的固定更新操作，页面不能指定下载地址或执行文件。

源码启动不支持替换自身，首次需要安装 NSIS 安装包。安装版使用 `%APPDATA%/织流` 保存登录状态；旧源码启动器显式指定的 `web-ui-user-data` 不会自动迁移，首次安装后需要重新登录。后续版本保留安装路径、应用 ID 和用户数据目录。

### 构建与验证

在仓库根目录执行 `pnpm install --frozen-lockfile`，然后执行 `pnpm --dir apps/desktop/web-shell run package:win`。安装包、`.exe.blockmap` 和 `latest.yml` 输出到 `apps/desktop/.desktop-build/zhiliu-web-shell/`。每次发布先递增本目录 `package.json` 的版本号，禁止覆盖已有版本安装包。`ZHILIU_UPDATE_URL` 仅在构建时改变 HTTPS 更新目录，不接受用户名、密码、查询参数或片段；运行时页面无法覆盖它。

构建使用仓库锁定的 Electron、electron-builder 和 electron-updater。为适配禁止执行临时程序的构建机，本入口设置 `ELECTRON_BUILDER_NSIS_EXTRACT_UNINSTALLER=1`，通过已有 app-builder-lib 补丁调用工具自带的 `UninstallerReader` 解析卸载程序，不执行中间安装器；其他入口未启用该变量时保持原流程。构建不会修改系统应用控制策略。

发布签名包时按 electron-builder 的 Windows 签名配置提供证书，并设置 `ZHILIU_PUBLISHER_NAME` 为证书发布者。未提供证书时生成未签名包，不能据此宣称已完成 Windows 安装兼容性或发布者签名验证；受应用控制策略限制的机器可能阻止安装。客户端保留库的签名验证，不设置跳过验证选项。

执行 `node --test apps/desktop/web-shell/tests/*.spec.cjs` 验证主题、更新状态、重试、IPC 与界面行为。使用 Electron 运行 `tests/update-feed-smoke.cjs`（独立 `--user-data-dir`）验证真实 HTTP 更新清单、下载、SHA512 和损坏包拒绝；测试仅下载本地数据夹具，不运行安装程序。执行 `node apps/desktop/web-shell/verify-release.cjs` 验证产物名称、大小和校验值。真实安装、退出和跨版本升级需在允许安装该发行包的 Windows 环境中单独验证。

### 企业下载服务

将 `deployment/nginx-downloads.conf` 放到服务器 `/etc/nginx/snippets/zhiliu-desktop-updates.conf`，在 `dev.echoai.best` 的 HTTPS `server` 块中 include 此文件。先备份站点配置，执行 `nginx -t` 成功后再 reload；验证失败时恢复备份。文件存放在 `/var/www/zhiliu-desktop-updates/windows/x64/`，目录不列出内容，下载仅支持 GET/HEAD，版本清单不缓存，版本化二进制允许长期缓存和 Range 请求。该路径必须绕过 SPA 的 `index.html` 回退。

先将安装器及 blockmap 上传到同一文件系统的暂存目录，核对服务器 SHA512 与本地 `verify-release.cjs` 输出一致后，再移动到下载目录。安装器使用唯一版本文件名，最后原子重命名 `latest.yml` 发布新版本，避免客户端先读到尚未上传完成的安装包。保留旧版本文件以支持差分下载。验证公网清单返回 YAML、安装器大小正确、Range 返回 206、缺失文件返回 404。回退时恢复之前清单，只能停止后续升级，已升级客户端不会降级；需要修复发布时使用更高版本号。
