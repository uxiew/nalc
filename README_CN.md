# nalc

> 基于内嵌 Verdaccio 的 registry-first 本地包联调工具。

`nalc` 是一个只保留单一路径的本地包联调方案：不走 `file:`、`link:`、复制目录或本地 store 注入，而是始终通过本地 registry 发布和真实安装来完成联调。

它的目标很明确：让本地联调尽量贴近真实的 `npm`、`pnpm`、`bun` 安装语义，减少链接方案带来的解析偏差、嵌套依赖异常和 lockfile 不一致问题。

## 解决的问题

传统本地包联调方案经常会在这些地方和真实安装不一致：

- 嵌套依赖解析路径不同
- peerDependencies 警告表现不稳定
- bundler 对 symlink 源码和发布包的处理不一致
- lockfile 无法真实反映最终依赖图

`nalc` 的做法是让 consumer 项目直接对本地 registry 执行一次正常安装，因此最终的 `node_modules`、lockfile 和包管理器行为都更接近生产安装。

## 架构总览

`nalc` 可以分成两侧来看。

### 1. 发布侧

执行 `nalc publish` 时，`nalc` 会把当前包打成一个本地预发布版本并推到内嵌 Verdaccio。

核心行为：

- 启动或复用 `~/.nalc/registry` 下的 Verdaccio runtime
- 将包版本改写成 `1.2.3-nalc.20260328.deadbeef` 这类本地预发布版本
- 在发布前解析 `workspace:` 与 `catalog:` 依赖
- 可选清理开发期字段
- 将发布结果写入 `~/.nalc/registry/state.json`

### 2. 消费侧

执行 `nalc add` 或 `nalc update` 时，`nalc` 会修改 consumer 的依赖声明，然后委托 consumer 自己的包管理器完成真实安装。

核心行为：

- 将联调状态写入 `.nalc/state.json`
- 记录 consumer 使用的包管理器，在 lockfile 暂时缺失时优先回退到上一次使用的工具
- 对保存型依赖，把 `package.json` 直接写成精确的 `<localVersion>`
- lockfile 仍然记录本次解析出来的精确版本
- 安装结束后把精确版本同步回 `consumerState.localSpec`
- 清理 `node_modules/.pnpm` 下已失去引用的旧本地实例

## 版本策略

本地发布版本格式为：

```txt
<baseVersion>-nalc.<yyyymmdd>.<buildId>
```

例如：

```txt
0.2.0-nalc.20260328.deadbeef
```

保存型 consumer 依赖会写成：

```json
{
  "dependencies": {
    "@scope/pkg": "0.2.0-nalc.20260328.deadbeef"
  }
}
```

这样设计的原因是：

- `package.json` 不会在安装时重新漂移回远程正式版
- lockfile 记录的就是 nalc 期望安装的精确本地版本
- `.nalc/state.json` 里的 `localSpec` 记录当前真实安装版本，供后续更新和清理旧实例使用

## 安装

```bash
npm i -g @xwai/nalc
# 或
pnpm add -g @xwai/nalc
# 或
bun add -g @xwai/nalc
```

## 常见工作流

### 单包联调

```bash
# 在库项目里
nalc publish

# 在 consumer 项目里
nalc add my-package

# 后续更新
nalc publish --push
# 或
nalc update my-package
```

### Monorepo 批量发布

```bash
nalc ws ../my-monorepo --workspace-resolve
```

### 监听并自动推送

```bash
nalc watch ../my-monorepo --workspace-resolve
```

### 联调完成后退出接管

```bash
nalc pass
```

## CLI 说明

### `nalc serve`

启动或复用本地 Verdaccio runtime。

```bash
nalc serve
nalc serve --port 4874
```

行为：

- 优先复用 `~/.nalc/registry/state.json` 中记录且健康的 runtime
- 对同一个 nalc home，只维护一份 Verdaccio runtime
- `--port` 只影响“当前没有健康 runtime 时”的下一次启动端口
- 如果目标端口被别的进程占用，就继续向后扫描可用端口，行为类似 Vite

### `nalc publish [path]`

将包发布到本地 registry。

```bash
nalc publish
nalc publish ../my-package
nalc publish --no-scripts
nalc publish --push
nalc publish --changed
```

关键参数：

- `--scripts`：是否执行生命周期脚本，默认 `true`
- `--dev-mod`：是否清理开发期字段，默认 `true`
- `--workspace-resolve`：发布前是否解析 `workspace:`，默认 `true`
- `--content`：打印实际打包文件列表
- `--private`：允许发布 `private: true` 的包
- `--changed`：内容哈希未变化时跳过发布
- `--push`：发布完成后推送到所有 tracked consumer
- `--ignore <pkg...>`：在 `ws` / `watch` 中排除部分包

发布前执行的脚本：

- `prepublish`
- `prepare`
- `prepublishOnly`
- `prepack`
- `prenalcpublish`

发布后执行的脚本：

- `postnalcpublish`
- `postpack`

不会执行的脚本：

- `publish`
- `postpublish`

### `nalc push [path]`

发布当前包，并立即把最新本地版本推送到所有 tracked consumer。

```bash
nalc push
nalc push --changed
```

和 `publish` 的差别：

- 默认 `--scripts=false`
- 固定走 `--push`

### `nalc add <package...>`

在当前 consumer 项目中安装一个或多个本地已发布包。

```bash
nalc add my-package
nalc add my-package -D
```

关键参数：

- `-D`、`--dev`、`--save-dev`：写入 `devDependencies`

行为：

- 把原始依赖范围记录到 `.nalc/state.json`
- 在 nalc 接管期间，把 `package.json` 直接写成精确的 `<localVersion>`
- 实际安装由 `npm`、`pnpm` 或 `bun` 完成

### `nalc update [package...]`

把 tracked 包更新到最新的本地发布版本。

```bash
nalc update
nalc update my-package
```

行为：

- 将 tracked 包刷新到最新 `localVersion`
- 保留原来的 `dependencyType`
- 用新的精确本地版本重新安装 consumer

### `nalc remove [package...]`

停止跟踪指定本地联调包，并恢复它们的原始依赖范围。

```bash
nalc remove my-package
nalc remove --all
```

行为：

- 如果这个依赖原本就存在，则恢复 `originalSpec`
- 如果这个依赖是 nalc 首次引入的，则直接删除
- 对剩余 tracked 包继续保持 nalc 接管状态
- 恢复 manifest 后重新执行一次安装

### `nalc pass`

将当前项目恢复为正常依赖状态，并清理 nalc 状态文件。

```bash
nalc pass
```

行为：

- 将所有 tracked 包恢复回原始依赖范围
- 使用记录下来的包管理器重新安装 consumer
- 删除 `.nalc/state.json`，并在目录为空时移除整个 `.nalc`
- 清理旧的 nalc 本地 `.pnpm` 实例

### `nalc ws [path]`

检测 workspace，并按依赖顺序发布所有包。

```bash
nalc ws
nalc ws ../workspace --ignore docs-site playground
```

### `nalc watch [path]`

监听当前包或 workspace，变化后自动重新发布。

```bash
nalc watch
nalc watch ../workspace --ignore app-shell
```

行为：

- 内部带防抖
- 始终启用 `changed: true`、`push: true`、`workspaceResolve: true`

### `nalc refresh [path]`

触碰 `tsconfig.json`、`jsconfig.json` 或 `package.json`，让编辑器在 `nalc add` 或 `nalc update` 后重建本地依赖图。

```bash
nalc refresh
nalc refresh ../consumer
```

行为：

- 优先触碰 `tsconfig.json`，其次是 `tsconfig.base.json`、`jsconfig.json`、`package.json`
- 输出实际触碰的文件、检测到的包管理器和 tracked 包数量
- consumer 安装成功后也会自动执行同样的 refresh 步骤

### `nalc dir`

打印当前 nalc home 目录。

## 状态文件

### 全局状态

路径：

```txt
~/.nalc/registry/state.json
```

记录内容：

- 当前 Verdaccio runtime 元信息
- 已发布包的元信息
- 每个包对应的 tracked consumer 路径列表

### Consumer 状态

路径：

```txt
<consumer>/.nalc/state.json
```

记录内容：

- `dependencyType`：当前安装到哪个依赖字段
- `originalSpec`：被 nalc 接管前的依赖范围
- `localSpec`：当前真实安装的精确 nalc 版本
- `manifestSpec`：nalc 接管期间写回 `package.json` 的精确本地版本
- `sourcePath`：源包路径
- `registryUrl`：consumer 使用的本地 registry 地址
- `installedAt`：最近一次安装时间

## 配置

可以在当前目录放置 `.nalcrc` 作为默认配置：

```ini
workspace-resolve=true
dev-mod=true
save=true
scripts=true
quiet=false

[ignore]
packages = docs-site, playground
files = .DS_Store, *.log
```

当前支持从 `.nalcrc` 读取的键：

- `port`
- `workspace-resolve`
- `dev-mod`
- `save`
- `scripts`
- `quiet`
- `mode`
- `ignore`

也可以通过 `--dir <path>` 覆盖默认 home 目录。

## 可编程 API

`nalc` 同时对外导出了一组可编程 API，可从 `lib/index.js` 直接导入：

```ts
import {
  publishPackage,
  smartPublish,
  watchPackages,
  ensureRegistryRuntime,
  addRegistryPackages,
  updateRegistryPackages,
  removeRegistryPackages,
  pushRegistryPackages,
  refreshConsumerProjectGraph,
  readGlobalRegistryState,
  writeGlobalRegistryState,
  readConsumerRegistryState,
  writeConsumerRegistryState,
} from 'nalc'
```

大致分成四组：

- 发布链路：`publishPackage`、`smartPublish`、`watchPackages`
- runtime 控制：`ensureRegistryRuntime`
- consumer 操作：`addRegistryPackages`、`updateRegistryPackages`、`removeRegistryPackages`、`pushRegistryPackages`、`refreshConsumerProjectGraph`
- 状态读写：`read*State`、`write*State` 以及 tracked consumer 辅助函数

更详细的设计说明和 API 用法见：

- `docs/design.md`
- `docs/programmatic-api.md`

## 详细文档索引

- 英文总览：`README.md`
- 设计说明：`docs/design.md`
- 可编程 API：`docs/programmatic-api.md`
- 未来路线：`ROADMAP.md`

## 当前阶段

Phase 1 已支持：

- `npm`
- `pnpm`
- `bun`
- Monorepo 检测与批量发布
- watch 后自动推送到 tracked consumer

Phase 1 暂不支持：

- Yarn PnP
- 旧式 `link`、`file:`、copy-store、vendorized 流程

## License

MIT
