# nalc 设计说明

本文档聚焦 `nalc` 的内部工作流与关键设计取舍，面向需要理解实现边界、排查联调问题、或者准备扩展 `nalc` 的开发者。

## 1. 设计目标

`nalc` 的核心目标不是“最快把本地代码接进 consumer”，而是“让联调结果尽量贴近真实安装”。

因此它明确放弃了这些经典本地联调路线：

- symlink
- `file:` 依赖
- 复制目录到本地 store
- vendorized 目录注入

这些方案的问题通常不在“能不能跑”，而在“最终行为和真实安装不一致”。`nalc` 的选择是始终把本地包当作一个真正会被安装的 package 来处理。

## 2. 为什么采用 registry-first

`nalc` 以本地 registry 为唯一主路径，原因有三点。

### 2.1 依赖图更真实

consumer 仍然通过自己的包管理器执行安装，因此：

- lockfile 会真实更新
- peerDependencies 校验更接近生产环境
- nested dependency 解析路径由包管理器决定，而不是由 symlink 结构偶然决定

### 2.2 更接近发布包

`nalc publish` 实际上会走一条接近真实 publish 的流程：

- 计算 publishable file list
- 构造临时 manifest
- 解析 `workspace:` / `catalog:`
- 发布到本地 Verdaccio

所以 consumer 联调拿到的是“本地发布包”，不是“源码目录的镜像”。

### 2.3 更适合多 consumer、多包联动

一旦本地 registry 和状态管理建立起来，就可以自然支持：

- 一个库同时推送到多个 consumer
- monorepo 批量发布
- watch 变化后自动推送
- consumer 状态恢复

## 3. 运行时结构

`nalc` 运行时主要有两类状态。consumer state 还会额外记住该项目最近一次使用的包管理器，避免 lockfile 临时缺失时错误回退到 npm。

### 3.1 全局状态

路径：`~/.nalc/registry/state.json`

作用：

- 保存 Verdaccio runtime 信息
- 保存每个本地包最近一次发布结果
- 保存每个包当前有哪些 consumer 正在跟踪它

其中单个已发布包记录的大致字段有：

- `sourcePath`: 源包路径
- `baseVersion`: 源包原始版本
- `localVersion`: 本地预发布版本
- `distTag`: 默认是 `nalc`
- `publishedAt`: 发布时间
- `buildId`: 基于内容哈希生成的短 id
- `contentHash`: 发布内容签名

### 3.2 consumer 状态

路径：`<consumer>/.nalc/state.json`

作用：

- 保存 nalc 接管过哪些依赖
- 保存原始依赖范围，便于 remove 后恢复
- 保存当前真实安装的精确版本
- 保存 consumer 退出 nalc 时所需的恢复信息

关键字段：

- `packageManager`
- `dependencyType`
- `originalSpec`
- `localSpec`
- `manifestSpec`
- `sourcePath`
- `registryUrl`
- `installedAt`

## 4. 版本策略

### 4.1 本地预发布版本

`nalc` 生成的本地版本格式为：

```txt
<baseVersion>-nalc.<yyyymmdd>.<buildId>
```

例如：

```txt
0.2.0-nalc.20260328.deadbeef
```

这里：

- `baseVersion` 继承源包版本
- `yyyymmdd` 体现发布日期
- `buildId` 来自发布内容哈希

### 4.2 package.json、lockfile、state 三者分工

保存型依赖并不会在所有地方都写同一个值，而是各自承担不同职责。

#### package.json

写 exact local version：

```txt
0.2.0-nalc.20260328.deadbeef
```

目的：

- 安装时不会被 semver 重新解析回远程正式版
- package.json、lockfile 与 consumer state 更容易保持一致

#### lockfile

写 exact resolved version。

目的：

- 记录当前这次真实安装到底装了哪个版本
- 成为后续同步和排查的事实来源

#### consumerState.localSpec

写 exact installed version。

目的：

- 作为 cleanup 和 update 的精确依据
- 不依赖 package.json 中的 range 来推断实际安装结果

## 5. 发布流程

发布链路由 `publishPackageToRegistry()` 驱动，核心步骤如下。

1. 读取源包 `package.json`
2. 如有需要，跳过 `private: true` 包
3. 启动或复用本地 Verdaccio
4. 执行允许的生命周期脚本
5. 通过 `@publint/pack` 计算实际发布文件列表
6. 准备临时 manifest
7. 计算内容哈希并生成 `buildId`
8. 组装本地 prerelease 版本号
9. 把临时目录发布到本地 registry
10. 写回全局 state
11. 如启用 `push`，同步更新 tracked consumers

### 5.1 Manifest 预处理

发布前会做几类整理：

- `stripDevelopmentFields()`：去除开发期字段
- `stripPublishLifecycleScripts()`：去除不应进入发布包的脚本
- `resolveLocalProtocols()`：解析 `workspace:` 与 `catalog:`
- `applyPublishConfig()`：应用 `publishConfig.directory` 等产物路径重映射

### 5.2 changed 模式

如果启用 `--changed`，`nalc` 会比较 `contentHash`。

只有以下任一内容变化时，才会认为需要重新发布：

- 进入 pack 列表的文件内容变化
- 解析后的 manifest 变化
- 本地 workspace 依赖被重新绑定到更高的本地 prerelease

## 6. consumer 安装流程

consumer 侧的核心函数是 `installTrackedRegistryState()`，安装完成后还会额外触发一次工程图 refresh。

它的职责很直接：把 tracked 包写回 manifest，执行真实安装，同步 exact 结果，并清理旧本地实例。

### 6.1 保存型安装

步骤：

1. 从当前 manifest 恢复 tracked 包的原始依赖值
2. 对保存型 entry 写入 `manifestSpec`
3. 把 manifest 持久化到 `package.json`
4. 调用 consumer 自己的包管理器安装
5. 从 lockfile 或顶层 `node_modules` 同步 exact 版本回 `localSpec`
6. 清理旧 `.pnpm` 本地实例
7. 触碰 `tsconfig.json` / `package.json` 等工程输入，促使编辑器重建依赖图

关键点：

- `package.json` 写的是 exact local version
- `localSpec` 最终写回的是 exact
- cleanup 以 exact 安装结果为准，而不是以“预期版本”猜测

### 6.2 退出接管

当本地联调完成后，`nalc pass` 会：

1. 恢复所有 tracked 包的 `originalSpec`
2. 使用记录下来的包管理器重新安装 consumer
3. 清理 nalc 产生的 `.nalc/state.json`
4. 删除不再被引用的 nalc 本地 `.pnpm` 实例

这样 consumer 可以回到一个普通项目状态，不再依赖 nalc 的存在。

## 7. 为什么要清理旧 `.pnpm` 实例

对于 `pnpm`，同一个包的多个本地版本会以不同目录存在于：

```txt
node_modules/.pnpm/
```

如果长期联调，不断发布新本地版本但不清理旧实例，会带来两个问题：

- 排查时很难判断当前 consumer 到底实际链接到了哪个目录
- 某些工具链会被陈旧实例干扰，增加误判成本

`nalc` 的策略是：

- 安装完成后，先同步当前 exact resolved version
- 再只保留当前 tracked exact 版本对应的 `.pnpm` 目录
- 删除同包名下其他已失去引用的本地实例

注意：这个清理逻辑只针对 nalc 跟踪的本地包，不针对所有普通依赖。

## 8. 编辑器工程图刷新

`pnpm` 的软链更新和 `.pnpm` 目录切换，并不总能让编辑器立即丢弃旧的 TypeScript project graph。

因此 nalc 在以下场景里会主动执行 `refreshConsumerProjectGraph()`：

- `nalc add` 安装完成后
- `nalc update` 安装完成后
- `nalc remove` 导致 consumer 重新安装后
- `nalc pass` 恢复普通依赖后
- 用户显式执行 `nalc refresh`

刷新策略非常简单：

1. 优先触碰 `tsconfig.json`
2. 如果不存在，则退到 `tsconfig.base.json`
3. 再退到 `jsconfig.json`
4. 最后退到 `package.json`

这样可以尽量复用大多数编辑器已经监听的工程输入文件，而不是要求用户手动重启编辑器。

## 9. 端口与 Verdaccio 复用

`ensureRegistryRuntime()` 的职责不是无脑启动 Verdaccio，而是优先复用。

行为顺序：

1. 读取全局 state 中记录的 runtime
2. 优先检查该 runtime 是否仍然健康
3. 如果指定端口已有健康 registry，也直接复用
4. 如果目标端口被别的服务占用，就继续往后扫描空闲端口
5. 找到可用端口后再启动新的 Verdaccio 进程

这保证了：

- 不会重复起多个本地 registry
- 端口冲突时行为类似 Vite
- 多次执行 `nalc serve`、`nalc publish`、`nalc add` 可以共享同一个 runtime

## 9. 包管理器支持边界

当前 phase 1 支持：

- `npm`
- `pnpm`
- `bun`

当前 phase 1 不支持：

- Yarn registry mode
- Yarn PnP

`runRegistryInstall()` 会按 consumer 项目中已有 lockfile 自动识别包管理器：

- `pnpm-lock.yaml` -> `pnpm`
- `package-lock.json` -> `npm`
- `bun.lockb` / `bun.lock` -> `bun`
- `yarn.lock` -> `yarn`，但 registry mode 直接报错

## 10. 适合扩展的方向

如果未来继续演进，比较自然的方向包括：

- 更强的 registry metadata 管理与清理机制
- 更精确的 watch 增量发布
- consumer 侧更细粒度的 install / verify 流程
- 更清晰的 JS API 分层，区分 public API 与 internal helpers

## 11. 何时不适合用 nalc

以下场景不一定适合优先上 `nalc`：

- 你只想快速调试一个纯源码层面的小改动，没有 lockfile 或依赖图一致性的要求
- 团队全部工作流都建立在 Yarn PnP 上
- 你希望联调时完全绕开 publish / registry 过程

在这些场景下，symlink 或 workspace 直连可能更轻。
