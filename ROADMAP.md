# nalc 设计路线计划

## 目标

`nalc` 的长期目标不是做另一个 `link` 工具，而是成为“最接近真实包管理器安装语义”的本地包联调层。核心原则只有三条：

1. 本地包测试默认走 registry/proxy 模式
2. consumer 侧尽量复用原生 `npm`、`pnpm`、`bun` 安装流程
3. `nalc` 自身只负责编排、状态记录与开发体验增强

## 现状

当前已经完成的基础能力：

- 内嵌 Verdaccio 作为本地 registry runtime
- `publish`、`add`、`update`、`remove`、`detect`、`watch`、`push`
- 本地 prerelease 版本策略
- `.nalc/state.json` consumer 状态记录
- `npm`、`pnpm`、`bun` 的第一阶段支持

当前仍然存在的边界：

- 仍缺少正式的多 consumer 管理视图
- 缺少 registry runtime 生命周期管理命令
- 缺少更清晰的 workspace 拓扑构建策略
- Yarn PnP 尚未支持
- 配置、日志、诊断与恢复能力还偏薄

## 路线分期

### Phase 1.5：稳定化

目标：把现有 registry-first 核心收成稳定可用的日常工具。

建议任务：

- 增加 `doctor` 命令，检查 registry、consumer 状态、包管理器与 lockfile 状态
- 增加 `status` 命令，查看当前 tracked packages、consumer 列表和本地版本
- 增加 `stop` 与 `restart` 命令，显式管理本地 Verdaccio runtime
- 补强错误提示，尤其是端口占用、registry 不健康、未发布即 add、包管理器不支持等场景
- 统一日志等级与 `--quiet`、`--debug` 行为

### Phase 2：Workspace 与团队协作

目标：让 monorepo、多 consumer、多包联调更可控。

建议任务：

- workspace 拓扑排序发布，保证依赖链顺序稳定
- 支持一次性发布并安装一组 package graph
- 在全局状态中记录 consumer 与 package 的双向索引
- 提供 `push --scope`、`push --consumer`、`update --all-consumers` 等精细控制
- 设计更可靠的跨项目状态迁移与恢复流程

### Phase 3：发布仿真与代理增强

目标：让 `nalc` 更接近真实 registry 行为，而不只是本地 Verdaccio 启动器。

建议任务：

- 代理上游 registry 时支持更清晰的缓存策略
- 补充 dist-tag 与元数据查看命令
- 支持为本地测试包生成更可追踪的 build metadata 与 source snapshot
- 支持 publish provenance 和本地来源追踪
- 明确 `publishConfig`、private 包、scoped package 在本地 registry 下的行为边界

### Phase 4：开发体验层

目标：把日常联调体验补齐，但不回退到旧的 copy/link 主模型。

建议任务：

- watch 模式下更细粒度地只发布受影响 package
- 为 Vite、Webpack、Rspack、Next.js 提供开发态建议或插件辅助
- 提供 `nalc use <pkg-path>` 形式的高层命令，自动完成 publish + add
- 增加 shell completion、模板配置生成、交互式初始化

## 关键设计原则

未来演进时要坚持这些边界：

- 不回到 `file:`、`link:`、复制到 `.nalc` 目录作为主方案
- 不把 lockfile 魔改当成核心实现
- 不让 consumer 为库的内部依赖兜底
- 不为了“看起来快”牺牲真实安装语义

## 兼容策略

短期兼容：

- 保持 `npm`、`pnpm`、`bun` 的基础支持稳定
- 对 Yarn 先明确提示边界，而不是半支持

中期兼容：

- 评估 Yarn `node-modules` 模式支持
- 单独研究 Yarn PnP 的 resolver 与 registry 行为，不与 Phase 1 混做

## 发布策略建议

建议未来采用以下节奏：

- `0.0.1-beta.x`
  目标是验证 registry-first 核心
- `0.0.1-rc.x`
  目标是锁定 CLI、状态文件格式与 runtime 行为
- `0.0.1`
  目标是完成稳定化、基础诊断与 workspace 常用能力

## 近期优先级

如果只选最值得先做的 5 件事，建议顺序如下：

1. `doctor` 命令
2. `status` 命令
3. runtime 生命周期管理
4. workspace 拓扑发布
5. 更清晰的错误与诊断输出
