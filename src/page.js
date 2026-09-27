// 界面模块：只负责 HTML/前端交互。流程规则以后端 workflow.js 为准，
// 前端仅做展示与初步拦截，跳步等以接口返回的错误信息提示。

import { STEPS, STATUSES } from "./workflow.js";

export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>岩芯样本切片实验室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#242822; --muted:#687062; --line:#d7ddd1; --accent:#526f43; --stone:#73706a; --danger:#a33a2e; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:16px; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:390px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:60px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 12px; font-weight:700; cursor:pointer; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 10px; font-size:12px; justify-self:start; }
    .p-已交付 { background:#eceae4; color:var(--stone); } .p-待观察 { background:#eef4e8; color:var(--accent); }
    .slice { border-top:1px solid var(--line); padding-top:10px; display:grid; gap:6px; }
    .track { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
    .t { font-size:12px; border-radius:999px; padding:2px 8px; border:1px solid var(--line); color:var(--muted); background:#f7f8f5; }
    .t.done { background:#dfe8d6; border-color:#bccbad; color:var(--accent); }
    .t.current { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:700; }
    .obs { font-size:13px; background:#f4f7f0; border-left:3px solid var(--accent); padding:6px 8px; border-radius:4px; }
    ul.logs { list-style:none; margin:4px 0 0; padding:0; display:grid; gap:3px; } ul.logs li { font-size:12px; color:var(--ink); }
    .ok { color:var(--accent); font-weight:700; } .locked { background:#faf9f6; }
    .addslice { display:grid; gap:6px; border-top:1px dashed var(--line); padding-top:10px; margin-top:2px; }
    .deliver { border-top:1px solid var(--line); padding-top:10px; margin-top:2px; }
    button.deliver-btn { width:100%; background:#3f5235; }
    .err { color:var(--danger); font-size:13px; background:#f8ecea; border:1px solid #e3c3bd; border-radius:6px; padding:8px 10px; display:none; white-space:pre-line; }
    .err.show { display:block; }
    .lock-note { font-size:12px; color:var(--stone); background:#eeede8; border-radius:6px; padding:6px 8px; }
    @media (max-width:950px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .stats{grid-template-columns:1fr 1fr;} }
  </style>
</head>
<body>
  <header><div><h1>岩芯样本切片实验室</h1><div class="meta">制片流程固定为 取样 → 切割 → 研磨 → 染色 → 观察；交付前须完成全部观察结论，交付后锁定不可退回</div></div><button id="reload">刷新</button></header>
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
      <div class="err" id="form-err" style="margin-top:10px"></div>
      <button style="margin-top:12px">保存样本</button>
    </form>
    <section>
      <div class="stats" id="stats"></div>
      <div class="grid" id="samples"></div>
    </section>
  </main>
  <script>
    const STEPS = ${JSON.stringify(STEPS)};
    const STATUSES = ${JSON.stringify(STATUSES)};
    const form = document.querySelector("#form");
    const stats = document.querySelector("#stats");
    const samplesEl = document.querySelector("#samples");
    let samples = [];

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error && data.message ? data.message : (data.error || "请求失败"));
      return data;
    }
    function esc(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
        return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
      });
    }
    function fmtTime(at) {
      if (!at) return "";
      const d = new Date(at);
      return isNaN(d) ? at : d.toLocaleString("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false });
    }
    function showErr(sampleId, message) {
      const el = sampleId ? document.querySelector('[data-err="'+sampleId+'"]') : document.querySelector("#form-err");
      if (!el) { alert(message); return; }
      el.textContent = message;
      el.classList.add("show");
    }
    function clearErr(sampleId) {
      const el = sampleId ? document.querySelector('[data-err="'+sampleId+'"]') : document.querySelector("#form-err");
      if (el) { el.textContent = ""; el.classList.remove("show"); }
    }

    function renderTrack(slice) {
      return '<div class="track">' + STEPS.map(function (step, i) {
        const cls = slice.completedSteps.indexOf(step) >= 0 ? "done" : (step === slice.currentStep ? "current" : "todo");
        return '<span class="t ' + cls + '">' + (i + 1) + "." + esc(step) + "</span>";
      }).join("") + "</div>";
    }
    function renderSlice(sample, slice) {
      let html = '<div class="slice"><b>' + esc(slice.id) + '</b><div class="meta">' + esc(slice.method) + "</div>" + renderTrack(slice);
      if (sample.delivered) {
        html += '<div class="meta">当前步骤：—（已锁定）</div>';
      } else if (slice.finished) {
        html += '<div class="meta ok">✓ 五步已完成，待整样交付</div>';
      } else {
        const needObservation = slice.currentStep === "观察";
        html += '<div class="meta">当前可做的步骤：<b>' + esc(slice.currentStep) + "</b>（只能按顺序记录这一步）</div>"
          + '<label>' + (needObservation ? "观察结论（必填）" : "本步骤备注（可空）") + '</label>'
          + '<textarea data-note="' + esc(sample.id) + "|" + esc(slice.id) + '" placeholder="' + (needObservation ? "请填写观察结论后再记录" : "步骤备注，可留空") + '"></textarea>'
          + '<button data-action="log" data-sample="' + esc(sample.id) + '" data-slice="' + esc(slice.id) + '" data-step="' + esc(slice.currentStep) + '">记录「' + esc(slice.currentStep) + '」完成</button>';
      }
      if (slice.observation) html += '<div class="obs">观察结论：' + esc(slice.observation) + "</div>";
      html += '<ul class="logs">' + slice.logs.map(function (log) {
        return "<li><span class='meta'>" + fmtTime(log.at) + "</span> " + esc(log.step) + "：" + esc(log.note || "") + "</li>";
      }).join("") + "</ul></div>";
      return html;
    }
    function renderCard(sample) {
      let html = '<article class="card' + (sample.delivered ? " locked" : "") + '">'
        + "<h3>" + esc(sample.project) + '</h3><span class="pill p-' + esc(sample.status) + '">' + esc(sample.status) + "</span>"
        + '<div class="meta">' + esc(sample.borehole) + " · " + esc(sample.coreBox) + " · " + esc(sample.depth) + " · " + esc(sample.owner) + "</div>";
      if (sample.delivered) {
        html += '<div class="meta">交付时间：' + fmtTime(sample.deliveredAt) + "</div>"
          + '<div class="lock-note">🔒 已交付：步骤记录与观察结论已锁定，不能退回或修改</div>';
      }
      html += sample.slices.map(function (slice) { return renderSlice(sample, slice); }).join("");
      if (!sample.delivered) {
        html += '<div class="addslice"><div class="meta">新增切片（从「取样」开始）</div>'
          + '<input data-add-id="' + esc(sample.id) + '" placeholder="切片编号">'
          + '<input data-add-method="' + esc(sample.id) + '" placeholder="染色方法（可空）">'
          + '<button data-action="add-slice" data-sample="' + esc(sample.id) + '">添加切片</button></div>'
          + '<div class="deliver"><button class="deliver-btn" data-action="deliver" data-sample="' + esc(sample.id) + '">核对全部观察结论并交付</button></div>';
      }
      html += '<div class="err" data-err="' + esc(sample.id) + '"></div></article>';
      return html;
    }
    function render() {
      stats.innerHTML = STATUSES.map(function (s) {
        return '<div class="stat"><span>' + s + "</span><strong>" + samples.filter(function (item) { return item.status === s; }).length + "</strong></div>";
      }).join("");
      samplesEl.innerHTML = samples.map(renderCard).join("");
    }
    async function load() { samples = await api("/api/samples"); render(); }

    samplesEl.addEventListener("click", async function (event) {
      const btn = event.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action, sid = btn.dataset.sample;
      clearErr(sid);
      try {
        if (action === "add-slice") {
          const box = btn.closest(".addslice");
          await api("/api/samples/" + encodeURIComponent(sid) + "/slices", {
            method: "POST",
            body: JSON.stringify({
              id: box.querySelector("[data-add-id]").value,
              method: box.querySelector("[data-add-method]").value
            })
          });
        } else if (action === "log") {
          const row = btn.closest(".slice");
          const note = row.querySelector("[data-note]").value;
          if (btn.dataset.step === "观察" && !note.trim()) {
            return showErr(sid, "记录「观察」前必须填写观察结论");
          }
          await api("/api/samples/" + encodeURIComponent(sid) + "/slices/" + encodeURIComponent(btn.dataset.slice) + "/logs", {
            method: "POST",
            body: JSON.stringify({ step: btn.dataset.step, note: note })
          });
        } else if (action === "deliver") {
          if (!confirm("交付前确认：该样本所有切片都已完成观察并填写观察结论？\n交付后记录锁定，不能退回。")) return;
          await api("/api/samples/" + encodeURIComponent(sid) + "/deliver", { method: "POST", body: "{}" });
        }
        await load();
      } catch (error) {
        showErr(sid, error.message);
      }
    });

    document.querySelector("#reload").onclick = function () { load(); };
    form.onsubmit = async function (event) {
      event.preventDefault();
      clearErr(null);
      try {
        await api("/api/samples", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        form.reset();
        await load();
      } catch (error) {
        showErr(null, error.message);
      }
    };
    load();
  </script>
</body>
</html>`;
