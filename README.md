# 岩芯样本切片实验室

运行：

```bash
npm start
```

访问 `http://localhost:3025`。

## 制片流程规则

- 每个切片严格按 **取样 → 切割 → 研磨 → 染色 → 观察** 五步推进，不能跳步、不能乱序、不能重复。
- 记录步骤时若跳步，接口拒绝并返回当前唯一可做的步骤（`allowedStep`），界面上也只提供当前步骤的按钮。
- 「观察」一步必须当场填写观察结论，空结论不能记录。
- 交付前逐片核对：所有切片都完成观察、且观察结论非空才能交付；拦截时返回未完成明细（`unfinished` / `missingObservation`）。
- 交付时保存交付时间（`deliveredAt`），交付后样本锁定：不能退回、不能补改步骤、不能新增切片。
- 步骤历史（`logs`）完整保留；样本台账状态与切片进度均由步骤历史推导，不会再出现"缺记录却已交付"。
- 原有样本（旧数据）仍可正常查看，进度按已有步骤历史自动接续。

## 代码结构（三层分离）

| 文件 | 职责 |
| --- | --- |
| `src/store.js` | 样本存取：读写 `data/core-slices.json`，加载时把旧数据归一成统一结构 |
| `src/workflow.js` | 流程判断：步骤顺序、观察结论、交付与锁定规则（纯逻辑，不碰文件和 HTTP） |
| `src/page.js` | 界面：HTML 与前端渲染 |
| `server.js` | 接口处理：HTTP 路由、请求解析、错误码转换 |

后续新增或调整业务规则时，只改 `src/workflow.js` 即可，入口与存取层无需翻改。

## 接口

- `GET  /api/samples` 样本台账（含每片 `completedSteps` / `currentStep` / `finished` / `observation`）
- `POST /api/samples` 创建样本（带初始切片，从「取样」开始）
- `POST /api/samples/:id/slices` 新增切片
- `POST /api/samples/:id/slices/:sliceId/logs` 记录步骤 `{ step, note }`
- `POST /api/samples/:id/deliver` 核对并交付
