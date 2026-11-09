# AIPMATE · AI 产品经理助理

> 把模糊想法推进为可讨论、可执行产品文档的 AI 工作台。

[在线体验](https://aipmate-v1.vercel.app)

AIPMATE 是一个面向 AI 产品经理、产品学习者与独立开发者的在线工作台。用户可以围绕一个项目完成需求分析、AI 方案设计、PRD 草稿与竞品分析，并通过多轮对话持续迭代报告。

## 为什么做这个项目？

产品工作里，很多需求最开始都只是零散的一句话：

- “我想做一个 AI 客服，但不知道先做什么。”
- “这个功能到底是不是 AI 必需的？”
- “需求分析、方案和 PRD 如何衔接？”
- “AI 生成的内容如何避免空泛、虚构和范围失控？”

AIPMATE 不是简单的“生成一篇文档”，而是帮助用户梳理问题、明确边界、形成 MVP 判断，并把想法逐步推进为可评审的产品交付物。

## 核心能力

- 智能识别：根据描述判断更适合先做需求分析、AI 方案设计、PRD 草稿还是竞品分析
- 需求分析：输出用户场景、核心问题、MVP 范围、优先级、流程、异常与验收标准
- AI 方案设计：明确 AI、规则/API、人工分别应该负责什么
- PRD 草稿：生成结构化功能需求、用户流程、异常处理与 Given-When-Then 验收标准
- 竞品分析：在没有真实竞品资料时，提供比较框架与取证清单，避免虚构竞品结论
- 多轮讨论：可基于当前报告继续补充、质疑、收缩范围或深化某一部分
- 历史版本：每次生成保留为独立文档版本，可在后续任务中引用
- 本地保存：项目、文档与历史记录保存在访客自己的浏览器中；刷新、关闭页面后仍可继续使用
- 导入与导出：支持浏览器本地工作区备份与恢复
- DeepSeek API：通过服务端调用模型，API Key 不会暴露在浏览器前端

## 产品原则

1. 不把 AI 输出伪装成真实调研事实  
2. 不虚构用户数据、竞品能力、企业接口或业务结果  
3. AI 负责理解、归纳、草稿与风险提示；高风险决策交由规则、API 或人工  
4. 不为了追问而追问；只有缺少的信息会真正改变产品方向时才提问  
5. 未知事项集中在交付物末尾，不让“待确认”淹没整篇报告  
6. 先形成可讨论的 MVP 草案，再逐步完善  

## 技术栈

- Next.js
- React
- TypeScript
- DeepSeek API（OpenAI 兼容接口）
- Vercel Serverless Functions
- Browser LocalStorage

## 数据与隐私说明

AIPMATE 当前是面向公开体验和作品集展示的版本：

- 项目、文档、任务记录默认保存在用户自己的浏览器中
- 网站运营者不会读取或保存访客的项目内容
- 清除浏览器站点数据后，本地记录会被删除
- 建议用户定期使用“备份”功能导出自己的工作区
- DeepSeek API Key 只保存在部署平台的环境变量中，不会发送到浏览器

## 本地运行

### 1. 克隆项目

```bash
git clone https://github.com/Haluwjm-Lexie/aipmate-v1.git
cd aipmate-v1
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

在项目根目录创建 `.env.local`：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

> `DEEPSEEK_BASE_URL` 可不填，默认使用 DeepSeek 官方地址。

### 4. 启动开发环境

```bash
npm run dev
```

打开：

```text
http://localhost:3000
```

## 部署到 Vercel

1. 将代码推送到 GitHub 仓库  
2. 在 Vercel 导入该 GitHub 仓库  
3. 在 Vercel 项目设置中配置环境变量：

```env
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
DEEPSEEK_BASE_URL
```

4. `DEEPSEEK_API_KEY` 请选择 Secret 类型  
5. 环境选择 Production 与 Preview  
6. 部署完成后即可通过 Vercel 链接访问  

> 本项目需要服务端安全调用 DeepSeek，因此不适合直接部署为纯 GitHub Pages 静态网站。

## 项目结构

```text
app/
  api/[...path]/route.ts   # 服务端 API 路由与模型调用入口
  globals.css              # 全局视觉样式
  layout.tsx               # 网站标题与页面元信息
  page.tsx                 # 工作台界面、浏览器本地保存与交互逻辑

lib/
  api.mjs                  # 任务路由、DeepSeek 调用与报告生成
  generate.mjs             # 模型请求与响应处理
  guidance.mjs             # 四类产品任务的输入与流程引导
  task-view.mjs            # 任务与历史版本视图逻辑
```

## 后续规划

- 局部改写：选中报告某一段后进行扩写、压缩、表格化或重写
- 文档版本对比：查看每次迭代具体修改了什么
- Word / PDF 导出
- 高质量项目模板库
- 文件上传与资料解析
- 报告质量检查：识别空泛表达、范围失控、验收标准缺失等问题
- 联网调研与真实来源引用
- 登录、云端同步与多人协作

## 作者

**Lexie 王杰美**

AI 产品 / AI 应用 / AI 工作流探索者。

如果这个项目对你有帮助，欢迎 Star、Fork 或提出 Issue。
