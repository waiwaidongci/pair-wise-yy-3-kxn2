import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

// 样本存取层：负责台账 JSON 的读写，其他层不关心数据落在哪。

const seed = {
  samples: [
    {
      id: "CORE-001",
      project: "东岭铜矿薄片",
      borehole: "ZK-17",
      coreBox: "BX-09",
      depth: "128.4-128.8m",
      owner: "陆川",
      status: "制片中",
      delivery: "未交付",
      deliveredAt: null,
      slices: [
        {
          id: "SL-001-A",
          method: "茜素红染色",
          observation: "",
          status: "研磨",
          logs: [
            { at: "2026-06-12T10:00:00.000Z", step: "取样", note: "截取含矿化条带位置" },
            { at: "2026-06-13T11:20:00.000Z", step: "切割", note: "完成粗切" },
          ],
        },
      ],
    },
  ],
};

export function createStore(dbPath) {
  let queue = Promise.resolve();

  async function load() {
    if (!existsSync(dbPath)) {
      await mkdir(dirname(dbPath), { recursive: true });
      await save(structuredClone(seed));
    }
    return JSON.parse(await readFile(dbPath, "utf8"));
  }

  // 先写临时文件再改名，避免并发读取拿到写了一半的台账。
  async function save(db) {
    const tmp = `${dbPath}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, dbPath);
  }

  // 串行执行“读-改-写”，避免并发请求互相覆盖；修改失败则不落盘。
  function update(mutator) {
    const run = queue.then(async () => {
      const db = await load();
      const result = await mutator(db);
      await save(db);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { load, update };
}
