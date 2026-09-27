import { SAMPLE_STATUSES } from "./workflow.js";

// 页面层：只负责展示和调用接口，步骤选项直接用接口返回的 allowedSteps。

export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>岩芯样本切片实验室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#242822; --muted:#687062; --line:#d7ddd1; --accent:#526f43; --stone:#73706a; --warn:#a2452f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:16px; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:390px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    #message { display:none; margin:14px 28px 0; padding:12px 16px; border:1px solid var(--warn); border-radius:8px; background:#fbf0ec; color:var(--warn); }
    #message.show { display:block; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.delivered { background:var(--accent); color:#fff; border-color:var(--accent); }
    .slice { border-top:1px solid var(--line); padding-top:10px; display:grid; gap:6px; }
    .logs { max-height:90px; overflow:auto; }
    @media (max-width:950px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .stats{grid-template-columns:1fr 1fr;} #message{margin:12px 16px 0;} }
  </style>
</head>
<body>
  <header><div><h1>岩芯样本切片实验室</h1><div class="meta">样本、切片任务、制片步骤和交付</div></div><button id="reload">刷新</button></header>
  <div id="message"></div>
  <main>
    <form id="form">
      <h2>创建岩芯样本</h2>
      <label>项目</label><input name="project" required>
      <label>钻孔编号</label><input name="borehole" required>
      <label>岩芯箱号</label><input name="coreBox" required>
      <label>取样深度</label><input name="depth" required>
      <label>负责人</label><input name="owner" required>
      <label>初始切片编号</label><input name="sliceId" required>
      <label>染色方法</label><input name="method" required>
      <button>保存样本</button>
    </form>
    <section>
      <div class="stats" id="stats"></div>
      <div class="grid" id="samples"></div>
    </section>
  </main>
  <script>
    const statuses = ${JSON.stringify(SAMPLE_STATUSES)};
    const form = document.querySelector("#form");
    const stats = document.querySelector("#stats");
    const samplesEl = document.querySelector("#samples");
    const messageEl = document.querySelector("#message");
    let samples = [];

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }
    function esc(text) {
      return String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function formatTime(iso) {
      if (!iso) return "";
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
    }
    function showMessage(text) {
      messageEl.textContent = text || "";
      messageEl.className = text ? "show" : "";
    }
    async function run(task) {
      try { showMessage(""); await task(); }
      catch (error) { showMessage(error.message); }
    }

    function render() {
      stats.innerHTML = statuses.map(s => '<div class="stat"><span>' + s + '</span><strong>' + samples.filter(item => item.status === s).length + '</strong></div>').join("");
      samplesEl.innerHTML = samples.map(renderSample).join("");
      bind();
    }

    function renderSample(sample) {
      const delivered = sample.delivery === "已交付";
      const pending = sample.slices.filter(slice => slice.status !== "观察").length;
      return '<article class="card">'
        + '<h3>' + esc(sample.project) + '</h3>'
        + '<div><span class="pill">' + esc(sample.status) + '</span>'
        + (delivered ? ' <span class="pill delivered">已交付 · ' + esc(formatTime(sample.deliveredAt)) + '</span>' : '')
        + '</div>'
        + '<div class="meta">' + esc(sample.borehole) + ' · ' + esc(sample.coreBox) + ' · ' + esc(sample.depth) + ' · ' + esc(sample.owner) + '</div>'
        + (delivered ? '' : renderAddSlice(sample))
        + sample.slices.map(slice => renderSlice(sample, slice, delivered)).join("")
        + (delivered
            ? '<div class="meta">样本已交付，步骤历史与观察结论已归档，不能退回。</div>'
            : '<div><button data-deliver="' + esc(sample.id) + '"' + (sample.canDeliver ? '' : ' disabled') + '>标记交付</button>'
              + (sample.canDeliver ? '' : '<div class="meta">还有 ' + pending + ' 个切片未完成观察，暂不能交付</div>')
              + '</div>')
        + '</article>';
    }

    function renderAddSlice(sample) {
      return '<div><label>新增切片</label>'
        + '<input data-new-slice="' + esc(sample.id) + '" placeholder="切片编号">'
        + '<input data-method="' + esc(sample.id) + '" placeholder="染色方法">'
        + '<button data-add="' + esc(sample.id) + '">添加切片</button></div>';
    }

    function renderSlice(sample, slice, delivered) {
      const key = esc(sample.id) + '|' + esc(slice.id);
      const canRecord = !delivered && slice.allowedSteps.length > 0;
      return '<div class="slice">'
        + '<b>' + esc(slice.id) + '</b>'
        + '<div class="meta">' + esc(slice.method) + ' · 当前步骤 ' + esc(slice.status) + '</div>'
        + (slice.observation ? '<div class="meta">观察结论：' + esc(slice.observation) + '</div>' : '')
        + (canRecord
            ? '<select data-step="' + key + '">' + slice.allowedSteps.map(step => '<option>' + esc(step) + '</option>').join("") + '</select>'
              + '<textarea data-note="' + key + '" placeholder="步骤备注（观察步骤必填观察结论）"></textarea>'
              + '<button data-log="' + key + '">记录' + esc(slice.allowedSteps[0]) + '</button>'
            : '<div class="meta">' + (slice.status === "观察" ? '全部步骤已完成' : '等待前置步骤') + '</div>')
        + '<div class="meta logs">' + slice.logs.map(log => esc(log.step) + '：' + esc(log.note) + '（' + esc(formatTime(log.at)) + '）').join(' / ') + '</div>'
        + '</div>';
    }

    function bind() {
      document.querySelectorAll("[data-add]").forEach(btn => btn.onclick = () => run(async () => {
        const id = btn.dataset.add;
        await api('/api/samples/' + encodeURIComponent(id) + '/slices', {
          method: 'POST',
          body: JSON.stringify({
            id: document.querySelector('[data-new-slice="' + CSS.escape(id) + '"]').value,
            method: document.querySelector('[data-method="' + CSS.escape(id) + '"]').value || "未指定",
          }),
        });
        await load();
      }));
      document.querySelectorAll("[data-log]").forEach(btn => btn.onclick = () => run(async () => {
        const key = btn.dataset.log;
        const [sampleId, sliceId] = key.split("|");
        await api('/api/samples/' + encodeURIComponent(sampleId) + '/slices/' + encodeURIComponent(sliceId) + '/logs', {
          method: 'POST',
          body: JSON.stringify({
            step: document.querySelector('[data-step="' + CSS.escape(key) + '"]').value,
            note: document.querySelector('[data-note="' + CSS.escape(key) + '"]').value,
          }),
        });
        await load();
      }));
      document.querySelectorAll("[data-deliver]").forEach(btn => btn.onclick = () => run(async () => {
        await api('/api/samples/' + encodeURIComponent(btn.dataset.deliver) + '/deliver', { method: 'POST', body: JSON.stringify({}) });
        await load();
      }));
    }

    async function load() { samples = await api("/api/samples"); render(); }
    document.querySelector("#reload").onclick = () => run(load);
    form.onsubmit = event => {
      event.preventDefault();
      run(async () => {
        await api("/api/samples", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        form.reset();
        await load();
      });
    };
    run(load);
  </script>
</body>
</html>`;
