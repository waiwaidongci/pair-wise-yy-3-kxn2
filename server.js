import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./src/store.js";
import { createApiHandler } from "./src/api.js";
import { page } from "./src/page.js";

// 入口：只负责装配各层并启动服务。
// 分层：store.js 样本存取 / workflow.js 流程判断 / api.js 接口处理 / page.js 页面。

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3025);
const dbPath = process.env.DB_PATH || join(__dirname, "data", "core-slices.json");

const store = createStore(dbPath);
const server = http.createServer(createApiHandler({ store, page }));

server.listen(port, () => console.log(`Core slice lab app listening on http://localhost:${port}`));
