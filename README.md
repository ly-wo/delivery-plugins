# Delivery Plugins

独立插件实现仓库。工作台运行时和插件中心不在此仓库。

新增插件请阅读 [开发规范](DEVELOPMENT.md) 和目标插件 README。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

需要 Node >=22.13、pnpm 12.3.4。SDK 固定为 `vendor/delivery-plugin-sdk-2.1.0.tgz`，无需访问兄弟目录。构建输出 `dist/catalog.json` 和各版本 `.dwp`；插件自身的 `package/` 也可直接导入。所有第三方运行依赖已打包，安装不需要执行 pnpm/npm。

| 分类 | 插件 |
|---|---|
| 能力 | 可由后续独立插件提供；不重复发布固定集成 |
| 工具 | Shanlian（闪连） |
| 应用 | Alert Hub、待办事项、Sign Hub、Go 实训、项目备忘、发版检查、需求台账、缺陷复盘 |

目录元数据由发布声明生成，不单独维护名称、版本、分类或权限列表。升级时增加版本号；已经发布的版本不可替换内容。本地构建不等于发布，不自动上传或创建远端仓库。

将 `dist` 作为整体制品交给插件中心的 `pnpm run import:releases -- <制品目录>`，或在宿主插件中心从本机导入 `.dwp`。不需要修改宿主源码注册插件。

安装过程：检查包 → 必需/可选授权 → 单独确认本机代码信任 → 安装 → 保存配置 → 手动启用。待办记录插件复用公开个人待办接口；它的 Jira 关联/创建沿用宿主受控预览确认接口。Jira、Confluence 继续作为宿主固定外部集成，使用已有认证，不作为自定义包重复安装。

独立能力插件可通过 `provides` / `consumes` 声明跨插件能力。消费插件声明 `consumes` 和 `capabilities.call`，通过 `host.capabilities.call(name, method, input, provider?)` 调用；读写业务仍由提供插件校验，不能跳过写入预览确认。当前最多一层能力转发，存在多个同名提供者时必须选择 provider。

公开 SDK 的 `browser`、`server`、`theme`、`manifest`、`protocol` 为稳定入口。主题快照包含实例、版本、ID、明暗和语义颜色；subscribe 立即重放最新值，避免 get 与订阅间漏事件。未声明分类的旧包在中心显示“未分类”，不改写旧声明摘要。

测试使用模拟服务和临时目录；没有验证真实企业 Jira/Confluence 账户、签到、代理切换或告警写入。

插件来源（固定 / 自定义）与功能分类（能力 / 工具 / 应用）是独立维度。Jira、Confluence 是固定外部能力插件；本仓库维护自定义插件，不再重复实现这两个固定集成。
