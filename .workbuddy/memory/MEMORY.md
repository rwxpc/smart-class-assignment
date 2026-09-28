# 智能分班系统 · 项目长期备忘

## 项目概况
- 工作区包含：`offline/`（离线版交付物，Node.js 后端 + 原样前端）、`site_mirror/`（原网站抓取镜像）、`.workbuddy/`
- 原网站：http://vzby4cnxcc.w31nm1.51jz.top/FB/ （PHP 8.2，用户无源码）
- 用户需求背景：网站要能在无网络环境完整运行，所有功能正常

## 技术约定
- 离线版运行：`offline/启动分班系统.bat` 或 `node server.js`，端口默认 8080（PORT 环境变量）
- 后端模块：lib/scheduler.js（分班算法）、lib/importer.js（Excel导入）、lib/exporter.js（导出）、lib/results.js（统计/模拟/同音名）、lib/store.js（JSON持久化）
- Node 使用托管版：C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-2\node.exe
- pinyin-pro 已安装于 offline/node_modules（同音名检测）
- 前端模板 public/app.html 由 prep-template.js 生成，不要手改生成物，改 site_mirror/main.html 后重新生成
- 调试分班算法：环境变量 DEBUG_2OPT=1 输出每轮代价与约束冲突数

## 经验教训（本机并行编辑同一文件的多个 Edit 会互相覆盖，必须逐个串行编辑）
