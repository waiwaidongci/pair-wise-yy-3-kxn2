// 样本存取层：只负责台账文件的读写，不包含任何流程规则。
// 流程规则见 ./workflow.js，HTTP 处理见 ./server.js。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSample } from "./workflow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "core-slices.json");

// 新装环境的初始台账（统一结构：交付标记 + 交付时间 + 步骤历史）
const seed = {
  samples: [
    {
      id: "CORE-001",
      project: "东岭铜矿薄片",
      borehole: "ZK-17",
      coreBox: "BX-09",
      depth: "128.4-128.8m",
      owner: "陆川",
      delivered: false,
      deliveredAt: null,
      slices: [
        {
          id: "SL-001-A",
          method: "茜素红染色",
          observation: "",
          logs: [
            { at: "2026-06-12T10:00:00.000Z", step: "取样", note: "截取含矿化条带位置" },
            { at: "2026-06-13T11:20:00.000Z", step: "切割", note: "完成粗切" }
          ]
        }
      ]
    }
  ]
};

// 读取台账；旧文件中的 status / delivery 等冗余字段在这里被归一化丢弃，
// 样本进度始终以 steps 历史（logs）为准，原有样本仍可正常查看。
export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    const canonical = { samples: seed.samples.map(normalizeSample) };
    await writeFile(dbPath, JSON.stringify(canonical, null, 2));
    return canonical;
  }
  const raw = JSON.parse(await readFile(dbPath, "utf8"));
  return { samples: (raw.samples || []).map(normalizeSample) };
}

export async function saveDb(db) {
  const canonical = {
    samples: db.samples.map(sample => ({
      id: sample.id,
      project: sample.project,
      borehole: sample.borehole,
      coreBox: sample.coreBox,
      depth: sample.depth,
      owner: sample.owner,
      delivered: Boolean(sample.delivered),
      delivery: sample.delivered ? "已交付" : "未交付",
      deliveredAt: sample.deliveredAt ?? null,
      slices: sample.slices.map(slice => ({
        id: slice.id,
        method: slice.method,
        observation: slice.observation || "",
        logs: slice.logs
      }))
    }))
  };
  await writeFile(dbPath, JSON.stringify(canonical, null, 2));
}
