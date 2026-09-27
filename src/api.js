import {
  WorkflowError,
  addSlice,
  allowedSteps,
  canDeliver,
  createSample,
  deliverSample,
  recordStep,
} from "./workflow.js";

// 接口处理层：只做路由、请求解析和错误响应，流程规则全部交给 workflow.js。

const workflowErrorStatus = {
  invalid_json: 400,
  missing_fields: 400,
  observation_required: 400,
};

class NotFoundError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkflowError("invalid_json", "请求体不是有效的 JSON");
  }
}

function findSample(db, id) {
  const sample = db.samples.find(item => item.id === id);
  if (!sample) throw new NotFoundError("sample_not_found", "样本不存在");
  return sample;
}

function findSlice(sample, id) {
  const slice = sample.slices.find(item => item.id === id);
  if (!slice) throw new NotFoundError("slice_not_found", "切片不存在");
  return slice;
}

// 台账里可能有历史遗留的异常步骤，列表接口不因此整体报错。
function safeAllowedSteps(slice) {
  try {
    return allowedSteps(slice);
  } catch {
    return [];
  }
}

// 给前端的视图：附上每个切片当前可做的步骤和样本是否可交付。
function toSampleView(sample) {
  const delivered = sample.delivery === "已交付";
  return {
    ...sample,
    canDeliver: canDeliver(sample),
    slices: sample.slices.map(slice => ({
      ...slice,
      allowedSteps: delivered ? [] : safeAllowedSteps(slice),
    })),
  };
}

export function createApiHandler({ store, page }) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(page);
      }

      if (req.method === "GET" && url.pathname === "/api/samples") {
        const db = await store.load();
        return sendJson(res, 200, db.samples.map(toSampleView));
      }

      if (req.method === "POST" && url.pathname === "/api/samples") {
        const input = await readBody(req);
        const sample = await store.update(db => {
          const created = createSample(input);
          db.samples.unshift(created);
          return created;
        });
        return sendJson(res, 201, toSampleView(sample));
      }

      const addSliceMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices$/);
      if (addSliceMatch && req.method === "POST") {
        const input = await readBody(req);
        const sample = await store.update(db => {
          const target = findSample(db, decodeURIComponent(addSliceMatch[1]));
          addSlice(target, input);
          return target;
        });
        return sendJson(res, 201, toSampleView(sample));
      }

      const logMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices\/([^/]+)\/logs$/);
      if (logMatch && req.method === "POST") {
        const input = await readBody(req);
        const sample = await store.update(db => {
          const target = findSample(db, decodeURIComponent(logMatch[1]));
          recordStep(target, findSlice(target, decodeURIComponent(logMatch[2])), input.step, input.note);
          return target;
        });
        return sendJson(res, 200, toSampleView(sample));
      }

      const deliverMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/deliver$/);
      if (deliverMatch && req.method === "POST") {
        const sample = await store.update(db => {
          const target = findSample(db, decodeURIComponent(deliverMatch[1]));
          deliverSample(target);
          return target;
        });
        return sendJson(res, 200, toSampleView(sample));
      }

      sendJson(res, 404, { error: "not_found", message: "接口不存在" });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return sendJson(res, 404, { error: error.code, message: error.message });
      }
      if (error instanceof WorkflowError) {
        return sendJson(res, workflowErrorStatus[error.code] ?? 409, {
          error: error.code,
          message: error.message,
          ...error.details,
        });
      }
      console.error(error);
      sendJson(res, 500, { error: "internal_error", message: error.message });
    }
  };
}
