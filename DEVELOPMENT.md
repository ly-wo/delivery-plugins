# 自定义插件开发规范

本仓库只写插件。新增通用宿主能力在宿主仓库完成并更新 SDK，市场管理交互在插件中心仓库完成。三者通过版本化制品和公开接口协作。

## 新建与构建

1. 在 `plugins/<目录名>/` 新建插件。简单记录工具可参照 `example-notes/plugin.json`；独立应用可参照 `sign-hub` 的 `plugin.json`、前端入口、`application.ts`、`build.mjs` 和 README。
2. 使用全局唯一的声明 `id`，指定语义版本。目录可以改名，已安装 ID 不应改名。不要复用示例 ID。
3. 应用的 `main.ts` 挂载独立界面，`application.ts` 导出宿主调用的方法。构建工具将 Vue、第三方库和 SDK 一并打进发布包；不能留下宿主私有源码导入或开发机路径。
4. 运行 `pnpm build` 和 `pnpm test`。构建器自动发现含 `plugin.json` 的目录，无需修改宿主注册表。输出 `dist/<id>-<version>.dwp` 和从声明生成的 `dist/catalog.json`。
5. 在隔离宿主导入 `.dwp`，检查授权后安装，再配置和启用。已有公开版本不能覆盖；本地构建成功不代表已经发布。

## 声明与权限

- 一个主分类：`capability`、`tool` 或 `application`；搜索词使用 `tags`。分类不授予权限。
- 新插件声明 `compatibility: { protocol: 1, sdk: "2.1.0" }`。依赖固定版本 `@delivery/plugin-sdk`，本仓库的锁文件与 vendor tarball 是构建输入。
- `permissions` 与 `capabilities` 中的 ID 必须一致。每项 capability 说明 `required`、`purpose` 和 `scope`。可选权限未授予时隐藏或禁用对应操作，并展示原因；不要反复申请全部权限。
- `configuration.fields` 用于服务地址、账号等配置。密钥字段用 `password`，认证目标变化使用 `resetOnChange` 解除旧凭据绑定。前端只能读密钥是否已设置；真正凭据在插件后端的受控配置接口中使用。
- `dependencies` 如实列出外部服务、MCP 或本机工具。安装不会替用户登录、开启定时任务或执行外部写入。
- `application.local` 需要独立信任确认。本机插件具有当前用户的权限，不能宣传为操作系统沙箱。

## 浏览器公开接口

```ts
import { host } from '@delivery/plugin-sdk/browser';

const initial = await host.theme.get();
const unsubscribe = host.theme.subscribe(theme => {
  // 回调立即收到最新快照。也可仅处理 mode，或声明 independent。
  document.documentElement.style.setProperty('--my-accent', theme.tokens.accent);
});
// 在组件卸载时调用 unsubscribe()；SDK 在页面销毁时也清理消息监听。
```

主题声明为 `full`、`mode` 或 `independent`。完整模式兼容 `--ui-*` 变量，仅明暗模式只设置 color-scheme，独立模式不修改样式。SDK 校验宿主来源、实例令牌及递增版本；不要另写不校验来源的 message 监听器。

其他入口：`host.configuration.get()`、`host.menu.get()`、`host.storage.list/save/remove()`、`host.request(method, input)`、`host.compose(prompt)`、`host.openWorkspace(app, path)`、`host.download(name, text)`、`host.copy(text)`。存储更新必须携带读到的记录版本，不能用重试覆盖别人的修改。会话接口只填草稿，不自动发送。

## 跨插件协作

提供方声明 `provides: [{ name, version: 1, methods }]`；调用方声明对应 `consumes` 与 `capabilities.call` 授权，再调用 `host.capabilities.call(name, method, input, provider?)`。名称和方法必须匹配，多个提供方时指定 provider；目前只支持一层调用，避免循环等待。

固定 Jira、Confluence 不通过自定义市场再装一份；已有 Jira 关联/创建继续走公开的受控接口。其他自定义能力插件可自行定义读、预览、执行方法。外部写入先预览，再由用户确认并提交一次性令牌。安装授权不能替代这一步；超时后标记结果待核对，不自动重放。

## 更新与验收

新增必需权限或扩大范围必须重新授权，拒绝则保留旧版本。配置、数据、图标、排序、可见性和本机分组不放进升级覆盖逻辑。记录结构的不兼容变化不能直接更新，需明确迁移版本、备份及失败恢复；当前中心只接受兼容更新，旧记录迁移仍走宿主显式预览流程。

至少检查：源码目录不可访问时包仍能安装；拒绝授权无入口和执行副作用；可选权限拒绝后基础功能可用；配置重载与停用、撤权、重新启用；主题初始状态、连续变化和退订；更新失败保留旧数据；桌面和窄屏；业务读写使用模拟服务，真实服务的验证结果单独报告。

固定外部集成的配置由宿主管理。新增自定义插件可以消费这些公开能力，不能访问私有凭据或复刻固定集成来规避接口边界。

## SDK 2.2：会话工作区与后台任务

新能力插件可声明 `compatibility.sdk: "2.2.0"`；旧 2.1.0 包继续兼容。
服务端 `host.workspaces.access()` 返回当前读取、清理及后台权限；`list()` 返回会话关联 worktree 的路径、分支、占用、会话名称、最近使用及安全状态；`preview(path)` 返回目录版本；`remove({path,revision,confirmName,idleBefore?})` 复核后回收副本。
`workspaces.read`、`workspaces.cleanup` 独立授权；不得暴露“强制丢弃”选项。周期操作必须提供 `idleBefore`，宿主限制至少闲置一天且目录位于宿主管理区。使用者仍需确认清理或周期策略，安装授权不替代业务确认。

需要后台执行时声明 `background: {method: "tick", intervalSeconds: 60}` 和可选 `background.run`。宿主按间隔、串行队列和当前授权调用该方法；方法需幂等检查持久化状态。后台可以在页面未打开时执行，插件应默认关闭有副作用的策略。停用/撤权后排队调用失效；外部已发生操作无法撤销，超时必须记为待核对。
