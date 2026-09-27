// 流程判断层：切片步骤顺序、观察结论、交付规则全部集中在这里。
// 这一层不读写文件、不知道 HTTP 的存在；后续加规则只改本文件，入口无需翻改。

export const STEPS = ["取样", "切割", "研磨", "染色", "观察"];
export const FINAL_STEP = "观察";

// 样本台账状态（沿用原看板的四个统计口径）
export const STATUSES = ["待切割", "制片中", "待观察", "已交付"];

export class WorkflowError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.status = extra.status || 400;
    // 其余字段作为明细随接口返回（allowedStep / unfinished / missingObservation 等）
    this.details = Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "status"));
  }
}

// 取切片步骤历史里所有规范步骤（去重，保持先后），用于兼容老数据的脏日志
function completedStepsOf(slice) {
  const done = [];
  for (const log of slice.logs || []) {
    if (STEPS.includes(log.step) && !done.includes(log.step)) done.push(log.step);
  }
  return done;
}

// 当前可做的步骤 = 顺序里第一个尚未完成的步骤；全部完成返回 null
export function currentStep(slice) {
  const done = completedStepsOf(slice);
  return STEPS.find(step => !done.includes(step)) ?? null;
}

export function completedSteps(slice) {
  return completedStepsOf(slice);
}

// 观察结论：取观察步骤日志里最后一条非空备注（兼容老数据 observation 字段）
export function observationOf(slice) {
  let conclusion = (slice.observation || "").trim();
  for (const log of slice.logs || []) {
    if (log.step === FINAL_STEP && typeof log.note === "string" && log.note.trim()) {
      conclusion = log.note.trim();
    }
  }
  return conclusion;
}

// 把任意来源（旧台账 / 新写入）的样本归一成统一结构：
// 步骤进度一律从 logs 推导，不再信任可被乱序写入的 status 字段。
export function normalizeSample(raw) {
  const slices = (raw.slices || []).map(slice => ({
    id: String(slice.id ?? ""),
    method: slice.method || "未指定",
    observation: observationOf(slice),
    logs: Array.isArray(slice.logs)
      ? slice.logs.map(log => ({
          at: log.at,
          step: log.step,
          note: typeof log.note === "string" ? log.note : ""
        }))
      : []
  }));

  const delivered = raw.delivered ?? raw.delivery === "已交付";
  return {
    id: String(raw.id ?? ""),
    project: raw.project || "",
    borehole: raw.borehole || "",
    coreBox: raw.coreBox || "",
    depth: raw.depth || "",
    owner: raw.owner || "",
    delivery: delivered ? "已交付" : "未交付",
    delivered: Boolean(delivered),
    deliveredAt: raw.deliveredAt ?? null,
    slices
  };
}

function sliceView(slice) {
  const completed = completedSteps(slice);
  return {
    ...slice,
    completedSteps: completed,
    currentStep: currentStep(slice),
    finished: currentStep(slice) === null,
    observation: observationOf(slice)
  };
}

// 样本台账状态：由切片进度 + 交付标记推导，不持久化，避免状态与事实脱节
function sampleStatus(sample) {
  if (sample.delivered) return "已交付";
  const slices = sample.slices;
  if (!slices.length) return "待切割";
  if (slices.every(slice => currentStep(slice) === null)) return "待观察";
  if (slices.some(slice => completedSteps(slice).length > 0)) return "制片中";
  return "待切割";
}

// 对外只读视图：附带当前可做步骤、完成步骤、观察结论、台账状态
export function viewOf(rawSample) {
  const sample = rawSample.id !== undefined && rawSample.delivered !== undefined
    ? rawSample
    : normalizeSample(rawSample);
  return {
    ...sample,
    status: sampleStatus(sample),
    slices: sample.slices.map(sliceView)
  };
}

export const listViews = db => db.samples.map(viewOf);
export const findSample = (db, id) => db.samples.find(item => item.id === id) || null;

function requireWritable(sample) {
  if (sample.delivered) {
    throw new WorkflowError(
      "sample_delivered_locked",
      "样本已交付并锁定，记录不能退回或修改"
    );
  }
}

function requireText(input, field, label) {
  const value = String(input?.[field] ?? "").trim();
  if (!value) throw new WorkflowError("missing_field", `请填写${label}`, { field });
  return value;
}

// 新建样本：初始切片只有空步骤历史，第一步是「取样」
export function createSample(db, input, now = new Date().toISOString()) {
  const sample = normalizeSample({
    id: `CORE-${Date.parse(now) || Date.now()}`,
    project: requireText(input, "project", "项目"),
    borehole: requireText(input, "borehole", "钻孔编号"),
    coreBox: requireText(input, "coreBox", "岩芯箱号"),
    depth: requireText(input, "depth", "取样深度"),
    owner: requireText(input, "owner", "负责人"),
    delivered: false,
    deliveredAt: null,
    slices: [
      {
        id: requireText(input, "sliceId", "初始切片编号"),
        method: requireText(input, "method", "染色方法"),
        logs: []
      }
    ]
  });
  db.samples.unshift(sample);
  return sample;
}

// 新增切片：已交付样本拒绝；切片编号不能为空且样本内唯一
export function addSlice(db, sampleId, input) {
  const sample = findSample(db, sampleId);
  if (!sample) throw new WorkflowError("sample_not_found", "样本不存在", { status: 404 });
  requireWritable(sample);
  const id = requireText(input, "id", "切片编号");
  if (sample.slices.some(slice => slice.id === id)) {
    throw new WorkflowError("slice_id_duplicated", `切片编号 ${id} 已存在`);
  }
  sample.slices.push({
    id,
    method: String(input.method ?? "").trim() || "未指定",
    observation: "",
    logs: []
  });
  return sample;
}

// 记录切片步骤：必须按 取样→切割→研磨→染色→观察 推进，跳步拒绝
export function recordStep(db, sampleId, sliceId, input, now = new Date().toISOString()) {
  const sample = findSample(db, sampleId);
  if (!sample) throw new WorkflowError("sample_not_found", "样本不存在", { status: 404 });
  requireWritable(sample);
  const slice = sample.slices.find(item => item.id === sliceId);
  if (!slice) throw new WorkflowError("slice_not_found", "切片不存在", { status: 404 });

  const step = String(input?.step ?? "").trim();
  if (!STEPS.includes(step)) {
    throw new WorkflowError("invalid_step", `未知步骤「${step}」`, { allowedSteps: STEPS });
  }

  const allowed = currentStep(slice);
  if (allowed === null) {
    throw new WorkflowError("slice_steps_finished", "该切片五个步骤均已完成", { allowedSteps: [] });
  }
  if (step !== allowed) {
    throw new WorkflowError("step_out_of_order", `不能跳到「${step}」，当前只能做「${allowed}」`, {
      allowedStep: allowed,
      allowedSteps: [allowed]
    });
  }

  const note = typeof input?.note === "string" ? input.note.trim() : "";
  // 观察步骤必须当场写入观察结论
  if (step === FINAL_STEP && !note) {
    throw new WorkflowError("observation_required", "记录「观察」时必须填写观察结论");
  }

  slice.logs.push({ at: now, step, note });
  if (step === FINAL_STEP) slice.observation = note;
  return sample;
}

// 交付：所有切片都完成「观察」且观察结论非空；交付后锁定并保存交付时间
export function deliverSample(db, sampleId, now = new Date().toISOString()) {
  const sample = findSample(db, sampleId);
  if (!sample) throw new WorkflowError("sample_not_found", "样本不存在", { status: 404 });
  if (sample.delivered) {
    throw new WorkflowError("already_delivered", "样本已交付，不能重复或退回交付");
  }
  if (!sample.slices.length) {
    throw new WorkflowError("no_slice_to_deliver", "样本下没有切片，无法交付");
  }
  const unfinished = sample.slices
    .filter(slice => currentStep(slice) !== null)
    .map(slice => ({ id: slice.id, currentStep: currentStep(slice) }));
  if (unfinished.length) {
    throw new WorkflowError("steps_unfinished", "仍有切片未走完所有步骤，不能交付", {
      unfinished
    });
  }
  const missingObservation = sample.slices
    .filter(slice => !observationOf(slice))
    .map(slice => slice.id);
  if (missingObservation.length) {
    throw new WorkflowError("observation_missing", "存在缺少观察结论的切片，不能交付", {
      missingObservation
    });
  }

  sample.delivered = true;
  sample.delivery = "已交付";
  sample.deliveredAt = now;
  return sample;
}
