# V1.1 实际代码诊断（升级前）

检查对象是本会话此前交付的 ai-pm-assistant 源码；无法读取你 Windows 上可能另行修改的副本。

| 检查项 | 升级前代码证据 | 结论 |
|---|---|---|
| 四类任务 Prompt | lib/legacy-generate.mjs:1–8（升级前 lib/generate.mjs） | 仅一份通用需求分析 System，没有四类专业 Prompt |
| User 消息 | lib/legacy-generate.mjs:147 起 | 将 project/task/sources/previousQuestions/clarification 序列化为 JSON，无老师对应 User 模板 |
| 模型调用 | lib/legacy-generate.mjs:70 起 | fetch POST base/chat/completions，Bearer 服务端密钥；不是模拟生成 |
| 后端分支 | 升级前 lib/api.mjs:196 | 所有提交统一 generateAnalysis；不按任务类型路由 |
| 前端任务入口 | 升级前 app/page.tsx:722、834 | 仅需求分析；其余三类未开放，五入口未实现 |
| 历史上下文 | 升级前 API generate 分支 | 仅传本轮追问，未引用历史任务/文档 |
| 资料与检索 | sources 为粘贴字符串 | 没有检索工具、索引或知识库召回，不能称知识库证据 |
| 示例与缓存 | lib/demo.mjs、lib/result-view.mjs | 独立示例有 demo 标识；未发现请求失败后用固定正文冒充成功；旧版曾有失败后选中示例的展示问题 |
| 输出校验 | legacy-generate validateResult；API warnings | 检查 JSON/字段/长度；搜索“验收”和 sources 是否为空；没有独立最终审校调用或事实外部验证 |

拟修改：prompts/original、prompts/runtime、manifest；lib/prompts.mjs、workflow.mjs、quality.mjs；改造 lib/generate.mjs 的传输适配、lib/api.mjs 路由与证据记录、store 备份元数据；app/page.tsx/globals.css 五任务入口与 AIHOT 绿风格；新增测试和本地真实对照脚本。

数据库：沿用 projects/documents/runs 的 JSON data 字段，不做表结构迁移、不覆盖数据库。代码回退包已先建立；工作区数据库已只读连接后通过 SQLite backup 创建一致副本（不包含在公开代码交付物中）。用户本机数据库未读取或修改。
