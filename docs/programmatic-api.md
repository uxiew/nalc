# nalc 可编程 API

本文档梳理 `nalc` 当前从 `dist/index.js` 暴露出来的可编程 API，包括用途、参数字段和典型调用方式。

当前 `src/index.ts` 暴露的模块有：

```ts
export * from './publish'
export * from './watch'
export * from './registry/runtime'
export * from './registry/consumer'
export * from './registry/project-graph'
export * from './registry/state'
```

因此，真正推荐直接使用的 API 主要分成六组：

- 发布 API
- watch / monorepo API
- registry runtime API
- consumer API
- project graph refresh API
- state API

## 1. 发布 API

### `publishPackage(options)`

签名：

```ts
interface PublishPackageOptions {
  workingDir: string
  mode?: 'registry'
  changed?: boolean
  push?: boolean
  update?: boolean
  content?: boolean
  private?: boolean
  scripts?: boolean
  devMod?: boolean
  workspaceResolve?: boolean
  ignore?: {
    files?: string[]
    packages?: string[]
  }
}

declare function publishPackage(
  options: PublishPackageOptions,
): Promise<PublishedRegistryPackageState | null>
```

作用：

- 以编程方式触发一次本地 registry 发布
- 内部会自动进入 registry 模式
- 可直接替代 CLI 的 `nalc publish`

常用字段说明：

- `workingDir`：源包根目录，必填
- `changed`：只在内容发生变化时发布
- `push`：发布后把最新版本推送到 tracked consumer
- `content`：打印打包内容清单
- `private`：允许发布 `private: true` 的包
- `scripts`：是否执行允许的生命周期脚本
- `devMod`：是否清理 dev-only manifest 字段
- `workspaceResolve`：是否解析 `workspace:` 依赖
- `ignore.packages`：供 monorepo ws/watch 过滤包名使用

示例：

```ts
import { publishPackage } from 'nalc'

await publishPackage({
  workingDir: '/path/to/lib',
  changed: true,
  push: true,
  workspaceResolve: true,
  scripts: false,
})
```

## 2. Watch / Monorepo API

### `smartPublish(options)`

签名：

```ts
declare function smartPublish(options: PublishPackageOptions): Promise<void>
```

作用：

- 检测 `workingDir` 是否为 workspace 根目录
- 如果是，则按依赖顺序发布所有 workspace 包
- 如果不是，则把它当成单包目录发布

适用场景：

- monorepo 工具封装
- 自定义批量本地发布脚本

示例：

```ts
import { smartPublish } from 'nalc'

await smartPublish({
  workingDir: '/path/to/workspace',
  workspaceResolve: true,
  changed: true,
})
```

### `watchPackages(options)`

签名：

```ts
declare function watchPackages(options: PublishPackageOptions): Promise<void>
```

作用：

- 监听单包或 workspace 包目录
- 文件变化后自动执行重新发布
- 内部始终走 `changed: true`、`push: true`、`workspaceResolve: true`

注意：

- 这是一个长期运行的进程
- 适合本地开发环境，不适合在请求型服务里直接调用

示例：

```ts
import { watchPackages } from 'nalc'

await watchPackages({
  workingDir: '/path/to/workspace',
  scripts: false,
  ignore: {
    packages: ['docs-site'],
  },
})
```

## 3. Registry Runtime API

### `ensureRegistryRuntime(options?)`

签名：

```ts
interface EnsureRegistryRuntimeOptions {
  port?: number
}

interface RegistryRuntimeState {
  pid: number
  port: number
  url: string
  configPath: string
  storagePath: string
  startedAt: string
}

declare function ensureRegistryRuntime(
  options?: EnsureRegistryRuntimeOptions,
): Promise<RegistryRuntimeState>
```

作用：

- 启动或复用 nalc 管理的 Verdaccio runtime
- 比 `serve` CLI 更适合集成进脚本或上层工具

行为特征：

- 优先复用 state 中已知且健康的 runtime
- 同一个 nalc home 只维护一份 Verdaccio runtime，不主动接管外部 registry
- `port` 只影响当前没有健康 runtime 时的启动端口；若被占用，会自动向后扫描

示例：

```ts
import { ensureRegistryRuntime } from 'nalc'

const runtime = await ensureRegistryRuntime({ port: 4874 })
console.log(runtime.url)
```

## 4. Consumer API

### `addRegistryPackages(packageNames, options)`

签名：

```ts
interface RegistryConsumerOptions {
  workingDir: string
  dev?: boolean
  all?: boolean
}

declare function addRegistryPackages(
  packageNames: string[],
  options: RegistryConsumerOptions,
): Promise<void>
```

作用：

- 在 consumer 项目中接管并安装一个或多个本地已发布包
- 对应 CLI 的 `nalc add`

字段说明：

- `workingDir`：consumer 根目录
- `dev`：是否安装到 `devDependencies`

示例：

```ts
import { addRegistryPackages } from 'nalc'

await addRegistryPackages(['@scope/pkg-a', '@scope/pkg-b'], {
  workingDir: '/path/to/app',
  dev: true,
})
```

### `refreshConsumerProjectGraph(workingDir, fallbackPm?)`

签名：

```ts
interface ConsumerProjectRefreshResult {
  workingDir: string
  touchedFile: string
  packageManager: PackageManagerName
  trackedPackages: string[]
  touchedAt: string
}

declare function refreshConsumerProjectGraph(
  workingDir: string,
  fallbackPm?: PackageManagerName,
): ConsumerProjectRefreshResult
```

作用：

- 主动触发 consumer 的工程图刷新
- 优先触碰 `tsconfig.json` / `tsconfig.base.json` / `jsconfig.json` / `package.json`
- 适合在自定义脚本、编辑器集成或额外安装流程后显式调用

示例：

```ts
import { refreshConsumerProjectGraph } from 'nalc'

const result = refreshConsumerProjectGraph('/path/to/app')
console.log(result.touchedFile)
```

### `updateRegistryPackages(packageNames, options)`

签名：

```ts
declare function updateRegistryPackages(
  packageNames: string[],
  options: RegistryConsumerOptions,
): Promise<void>
```

作用：

- 把 tracked 包更新到最新本地版本
- 对应 CLI 的 `nalc update`

说明：

- `packageNames` 传空数组时，会更新当前 consumer 里所有 tracked 包

示例：

```ts
import { updateRegistryPackages } from 'nalc'

await updateRegistryPackages([], {
  workingDir: '/path/to/app',
})
```

### `removeRegistryPackages(packageNames, options)`

签名：

```ts
declare function removeRegistryPackages(
  packageNames: string[],
  options: RegistryConsumerOptions,
): Promise<void>
```

作用：

- 移除本地联调包并恢复原始依赖范围
- 对应 CLI 的 `nalc remove`

字段补充：

- `all`：当 `packageNames` 为空时，是否移除全部 tracked 包

示例：

```ts
import { removeRegistryPackages } from 'nalc'

await removeRegistryPackages([], {
  workingDir: '/path/to/app',
  all: true,
})
```

### `passRegistryConsumer(workingDir)`

签名：

```ts
declare function passRegistryConsumer(workingDir: string): Promise<void>
```

作用：

- 将当前 consumer 恢复到正常依赖状态
- 恢复所有 tracked 包的 `originalSpec`
- 重新安装并清理 `.nalc` 状态文件

示例：

```ts
import { passRegistryConsumer } from 'nalc'

await passRegistryConsumer('/path/to/app')
```

### `pushRegistryPackages(packageNames)`

签名：

```ts
declare function pushRegistryPackages(packageNames: string[]): Promise<void>
```

作用：

- 遍历全局 state 中该包的 tracked consumers
- 对每个 consumer 执行一次 update
- 对应 CLI 的 `nalc push` 在 consumer 侧的更新部分

说明：

- `packageNames` 传空数组时，会按全局 tracked consumer 表中的所有包执行

示例：

```ts
import { pushRegistryPackages } from 'nalc'

await pushRegistryPackages(['@scope/pkg'])
```

## 5. State API

### `readGlobalRegistryState()`

签名：

```ts
declare function readGlobalRegistryState(): GlobalRegistryState
```

作用：

- 读取 `~/.nalc/registry/state.json`
- 适合调试当前 registry runtime、已发布包、tracked consumer 列表

### `writeGlobalRegistryState(state)`

签名：

```ts
declare function writeGlobalRegistryState(
  state: GlobalRegistryState,
): void
```

作用：

- 手动写回全局 state
- 更适合测试或工具内部扩展，不建议在普通业务代码中频繁手改

### `addTrackedConsumers(workingDir, packageNames)`

签名：

```ts
declare function addTrackedConsumers(
  workingDir: string,
  packageNames: string[],
): void
```

作用：

- 将某个 consumer 路径登记到全局 tracked consumers 映射里

### `removeTrackedConsumers(workingDir, packageNames)`

签名：

```ts
declare function removeTrackedConsumers(
  workingDir: string,
  packageNames: string[],
): void
```

作用：

- 从全局 tracked consumers 映射中移除 consumer 记录

### `readConsumerRegistryState(workingDir)`

签名：

```ts
declare function readConsumerRegistryState(
  workingDir: string,
): ConsumerRegistryState
```

作用：

- 读取 `<consumer>/.nalc/state.json`
- 适合排查当前 consumer 到底被 nalc 接管了哪些包

### `writeConsumerRegistryState(workingDir, state)`

签名：

```ts
declare function writeConsumerRegistryState(
  workingDir: string,
  state: ConsumerRegistryState,
): void
```

作用：

- 手动写回 consumer 状态
- 与全局 state 一样，更适合测试、迁移或上层工具，不建议随意绕过 nalc 现有 consumer 流程直接改

## 6. 推荐使用层级

如果你只是想写一层自动化脚本，推荐按下面顺序选 API：

### 最常用

- `publishPackage`
- `smartPublish`
- `watchPackages`
- `ensureRegistryRuntime`
- `addRegistryPackages`
- `updateRegistryPackages`
- `removeRegistryPackages`
- `pushRegistryPackages`

### 调试 / 状态观察

- `readGlobalRegistryState`
- `readConsumerRegistryState`

### 高风险低层 API

- `writeGlobalRegistryState`
- `writeConsumerRegistryState`
- `addTrackedConsumers`
- `removeTrackedConsumers`

这些 API 更偏状态维护，不建议作为普通业务集成的主路径。

## 7. 一个最小编程集成示例

下面示例展示如何在脚本里完成“启动 runtime -> 发布 -> 安装到 consumer”这条最短链路。

```ts
import {
  ensureRegistryRuntime,
  publishPackage,
  addRegistryPackages,
} from 'nalc'

await ensureRegistryRuntime({ port: 4873 })

await publishPackage({
  workingDir: '/Users/me/projects/my-lib',
  changed: true,
  workspaceResolve: true,
  scripts: false,
})

await addRegistryPackages(['my-lib'], {
  workingDir: '/Users/me/projects/my-app',
})
```

## 8. 使用 API 时的注意事项

### 8.1 所有核心流程都假定目录已经存在 `package.json`

无论是 publish 还是 consumer 操作，都会先读取对应目录下的 `package.json`。如果目录不是一个合法 package 根目录，流程会提前结束或抛错。

### 8.2 API 会直接触发真实包管理器安装

`addRegistryPackages` / `updateRegistryPackages` / `removeRegistryPackages` 不是纯内存操作，会真的执行：

- `npm install --registry=...`
- `pnpm install --registry=...`
- `bun install`

这意味着它们应被当作“有副作用的系统操作”使用。

### 8.3 状态文件和 lockfile 是事实来源的一部分

consumer 流程依赖以下信息共同工作：

- `package.json`
- lockfile
- `.nalc/state.json`
- `~/.nalc/registry/state.json`

如果你的上层工具同时修改这些文件，需要特别小心一致性。

### 8.4 当前 API 仍偏 CLI-first

虽然 `nalc` 提供了编程 API，但它本质上仍然是一个 CLI-first 工具。也就是说：

- 公开 API 是可用的
- 但并没有专门为 SDK 场景做完整分层和稳定性承诺
- 如果未来要强化 API 稳定性，最好再补一层更明确的 public facade
