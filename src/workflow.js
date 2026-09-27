// 流程判断层：步骤顺序、跳步校验、交付规则、样本状态推导。
// 后续新增或调整规则只改这里，接口层和存取层不用动。

export const STEPS = ["取样", "切割", "研磨", "染色", "观察"];
export const SAMPLE_STATUSES = ["待切割", "制片中", "待观察", "已交付"];
export const DELIVERY = { PENDING: "未交付", DELIVERED: "已交付" };

const FIRST_STEP = STEPS[0];
const FINAL_STEP = STEPS[STEPS.length - 1];

export class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
  }
}

// 切片当前允许记录的步骤（顺序推进，只能是下一步；已完成则为空）。
export function allowedSteps(slice) {
  const index = STEPS.indexOf(slice.status);
  if (index === -1) {
    throw new WorkflowError("unknown_step", `切片 ${slice.id} 的步骤「${slice.status}」不在流程内`, { step: slice.status });
  }
  return index < STEPS.length - 1 ? [STEPS[index + 1]] : [];
}

export function createSample(input, now = new Date()) {
  const required = ["project", "borehole", "coreBox", "depth", "owner", "sliceId", "method"];
  const missing = required.filter(key => !String(input[key] ?? "").trim());
  if (missing.length) {
    throw new WorkflowError("missing_fields", `缺少必填字段：${missing.join("、")}`, { fields: missing });
  }
  const sample = {
    id: `CORE-${now.getTime()}`,
    project: input.project.trim(),
    borehole: input.borehole.trim(),
    coreBox: input.coreBox.trim(),
    depth: input.depth.trim(),
    owner: input.owner.trim(),
    status: "待切割",
    delivery: DELIVERY.PENDING,
    deliveredAt: null,
    slices: [createSlice(input.sliceId, input.method, now, "创建初始切片任务")],
  };
  sample.status = deriveSampleStatus(sample);
  return sample;
}

export function addSlice(sample, input, now = new Date()) {
  assertNotDelivered(sample);
  const id = String(input.id ?? "").trim();
  if (!id) {
    throw new WorkflowError("missing_fields", "切片编号不能为空", { fields: ["id"] });
  }
  if (sample.slices.some(slice => slice.id === id)) {
    throw new WorkflowError("duplicate_slice", `切片 ${id} 已存在`, { sliceId: id });
  }
  const slice = createSlice(id, input.method, now, "新增切片任务");
  sample.slices.push(slice);
  sample.status = deriveSampleStatus(sample);
  return slice;
}

export function recordStep(sample, slice, step, note, now = new Date()) {
  assertNotDelivered(sample);
  const allowed = allowedSteps(slice);
  if (!allowed.includes(step)) {
    throw new WorkflowError(
      "step_not_allowed",
      allowed.length
        ? `切片 ${slice.id} 当前为「${slice.status}」，只能记录：${allowed.join("、")}`
        : `切片 ${slice.id} 已完成全部步骤，无需再记录`,
      { currentStep: slice.status, allowedSteps: allowed }
    );
  }
  const text = String(note ?? "").trim();
  if (step === FINAL_STEP && !text) {
    throw new WorkflowError("observation_required", "记录「观察」时必须填写观察结论", { allowedSteps: allowed });
  }
  slice.status = step;
  if (step === FINAL_STEP) slice.observation = text;
  slice.logs.push({ at: now.toISOString(), step, note: text || "步骤完成" });
  sample.status = deriveSampleStatus(sample);
  return slice;
}

export function canDeliver(sample) {
  return sample.delivery !== DELIVERY.DELIVERED
    && sample.slices.length > 0
    && sample.slices.every(slice => slice.status === FINAL_STEP);
}

export function deliverSample(sample, now = new Date()) {
  if (sample.delivery === DELIVERY.DELIVERED) {
    throw new WorkflowError("sample_delivered", "样本已交付，不能退回或重复交付");
  }
  const pending = sample.slices.filter(slice => slice.status !== FINAL_STEP);
  if (pending.length) {
    throw new WorkflowError(
      "observation_incomplete",
      `交付前需完成全部观察，尚未完成的切片：${pending.map(slice => slice.id).join("、")}`,
      { pendingSlices: pending.map(slice => slice.id) }
    );
  }
  sample.delivery = DELIVERY.DELIVERED;
  sample.deliveredAt = now.toISOString();
  sample.status = deriveSampleStatus(sample);
  return sample;
}

export function deriveSampleStatus(sample) {
  if (sample.delivery === DELIVERY.DELIVERED) return "已交付";
  if (!sample.slices.length) return "待切割";
  return sample.slices.every(slice => slice.status === FINAL_STEP) ? "待观察" : "制片中";
}

function createSlice(id, method, now, note) {
  return {
    id: String(id).trim(),
    method: String(method || "未指定").trim(),
    observation: "",
    status: FIRST_STEP,
    logs: [{ at: now.toISOString(), step: FIRST_STEP, note }],
  };
}

function assertNotDelivered(sample) {
  if (sample.delivery === DELIVERY.DELIVERED) {
    throw new WorkflowError("sample_delivered", "样本已交付，不能退回或继续操作");
  }
}
