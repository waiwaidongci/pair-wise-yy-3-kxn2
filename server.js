// 接口处理层：只负责 HTTP 路由、请求解析与错误转状态码。
// 样本存取见 ./src/store.js，流程判断见 ./src/workflow.js，页面见 ./src/page.js。

import http from "node:http";
import { loadDb, saveDb } from "./src/store.js";
import { WorkflowError, listViews, createSample, addSlice, recordStep, deliverSample } from "./src/workflow.js";
import { page } from "./src/page.js";

const port = Number(process.env.PORT || 3025);

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkflowError("invalid_json", "请求体不是合法的 JSON", { status: 400 });
  }
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    const now = new Date().toISOString();

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }

    // 列表 / 创建样本
    if (req.method === "GET" && url.pathname === "/api/samples") {
      return sendJson(res, 200, listViews(db));
    }
    if (req.method === "POST" && url.pathname === "/api/samples") {
      const input = await readJson(req);
      const sample = createSample(db, input, now);
      await saveDb(db);
      return sendJson(res, 201, listViews({ samples: [sample] })[0]);
    }

    // 新增切片
    const addSliceMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices$/);
    if (addSliceMatch && req.method === "POST") {
      const input = await readJson(req);
      const sample = addSlice(db, decodeURIComponent(addSliceMatch[1]), input);
      await saveDb(db);
      return sendJson(res, 201, listViews({ samples: [sample] })[0]);
    }

    // 记录步骤（顺序由 workflow 强校验）
    const logMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices\/([^/]+)\/logs$/);
    if (logMatch && req.method === "POST") {
      const input = await readJson(req);
      const sample = recordStep(
        db,
        decodeURIComponent(logMatch[1]),
        decodeURIComponent(logMatch[2]),
        input,
        now
      );
      await saveDb(db);
      return sendJson(res, 200, listViews({ samples: [sample] })[0]);
    }

    // 交付（全部观察完成且结论非空才允许）
    const deliverMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/deliver$/);
    if (deliverMatch && req.method === "POST") {
      await readJson(req);
      const sample = deliverSample(db, decodeURIComponent(deliverMatch[1]), now);
      await saveDb(db);
      return sendJson(res, 200, listViews({ samples: [sample] })[0]);
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof WorkflowError) {
      return sendJson(res, error.status || 400, { error: error.code, message: error.message, ...error.details });
    }
    sendJson(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, () => console.log(`Core slice lab app listening on http://localhost:${port}`));
