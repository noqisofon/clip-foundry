/* クリップ工場 UI。シミュレーションは engine.js（CLIP）を使う。 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const tauri = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core : null;
  const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
  const fmt = (n) => Math.floor(n).toLocaleString("ja-JP");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動く */ } },
  };

  // ---- ゲーム状態 ---------------------------------------------------
  let sim, rules, hist, logs, running = false, timer = null, endingShown = false;
  let ruleText = store.get("clip.rules") || CLIP.PRESETS[1].text;

  function applyRules(text) {
    const r = CLIP.parse(text);
    rules = r.rules;
    ruleText = text;
    store.set("clip.rules", text);
    return r;
  }
  function reset() {
    sim = CLIP.create();
    hist = { total: [[0, 0]], heat: [[0, sim.heat]] };
    logs = [];
    endingShown = false;
    setRunning(false);
    render();
  }
  function setRunning(v) {
    running = v;
    $("btn-play").textContent = v ? "⏸ 一時停止" : "▶ 再生";
    clearInterval(timer);
    if (v) timer = setInterval(tick, 100);
  }
  function tick() {
    const n = Math.max(1, Math.round(Number($("sel-speed").value) / 10));
    for (let i = 0; i < n; i++) {
      const ev = [];
      CLIP.step(sim, rules, ev);
      for (const e of ev) logs.push(e);
      hist.total.push([sim.tick, sim.total]);
      hist.heat.push([sim.tick, sim.heat]);
      if (sim.goalTick && !endingShown) { endingShown = true; setRunning(false); showEnding(); break; }
    }
    if (logs.length > 2000) logs = logs.slice(-1500);
    if (hist.total.length > 6000) { hist.total = thin(hist.total); hist.heat = thin(hist.heat); }
    render();
  }
  const thin = (a) => a.filter((_, i) => i % 2 === 0 || i === a.length - 1);

  // ---- チャート（inline SVG + ホバー） -----------------------------------
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  /* series: [{name, color, data:[[x,y],...]}], opts: {yMax?, hline?} */
  function drawChart(box, series, opts) {
    opts = opts || {};
    const W = Math.max(box.clientWidth, 200), H = box.clientHeight || 220;
    const m = { l: 48, r: 10, t: 8, b: 22 };
    let xMax = 1, yMax = opts.yMax || 1;
    for (const s of series) for (const p of s.data) {
      if (p[0] > xMax) xMax = p[0];
      if (!opts.yMax && p[1] > yMax) yMax = p[1];
    }
    if (opts.hline && !opts.yMax) yMax = Math.max(yMax, opts.hline);
    const X = (x) => m.l + (x / xMax) * (W - m.l - m.r);
    const Y = (y) => H - m.b - (y / yMax) * (H - m.t - m.b);
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4, y = Y(v);
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: "axis" }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, fmt(v)));
    }
    for (let i = 0; i <= 4; i++) {
      svg.appendChild(svgEl("text", { x: X((xMax * i) / 4), y: H - 6, "text-anchor": i === 0 ? "start" : i === 4 ? "end" : "middle" }, fmt((xMax * i) / 4)));
    }
    if (opts.hline) {
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(opts.hline), y2: Y(opts.hline), stroke: "var(--warn)", "stroke-dasharray": "4 3" }));
    }
    for (const s of series) {
      const d = s.data.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
      svg.appendChild(svgEl("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round" }));
    }
    box.querySelectorAll("svg").forEach((n) => n.remove());
    box.insertBefore(svg, box.firstChild);
    let cross = box.querySelector(".cross");
    if (!cross) { cross = document.createElement("div"); cross.className = "cross"; box.appendChild(cross); }
    box._model = { series, m, W, xMax };
  }
  function bindHover(box) {
    const tip = $("tip");
    box.addEventListener("mousemove", (ev) => {
      const md = box._model;
      if (!md) return;
      const r = box.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const x = ((px - md.m.l) / (md.W - md.m.l - md.m.r)) * md.xMax;
      if (x < 0 || x > md.xMax) { leave(); return; }
      const rows = md.series.map((s) => {
        let best = s.data[0], bd = Infinity;
        for (const p of s.data) { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; best = p; } }
        return { s, p: best };
      });
      const cross = box.querySelector(".cross");
      cross.style.display = "block";
      cross.style.left = px + "px";
      tip.replaceChildren();
      tip.appendChild(document.createTextNode("tick " + fmt(rows[0].p[0])));
      for (const { s, p } of rows) {
        const line = document.createElement("div");
        const sw = document.createElement("span");
        sw.className = "sw"; sw.style.background = s.color;
        line.append(sw, s.name + "：" + fmt(p[1]));
        tip.appendChild(line);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tw - 8) + "px";
      tip.style.top = ev.clientY + 14 + "px";
    });
    function leave() {
      tip.hidden = true;
      const c = box.querySelector(".cross");
      if (c) c.style.display = "none";
    }
    box.addEventListener("mouseleave", leave);
  }

  // ---- 描画 ---------------------------------------------------------
  function kpi(k, v, s, meter, hot) {
    const d = document.createElement("div");
    d.className = "kpi" + (hot ? " hot" : "");
    const mk = (cls, t) => { const e = document.createElement("div"); e.className = cls; e.textContent = t; return e; };
    d.append(mk("k", k), mk("v", v), mk("s", s || " "));
    if (meter != null) {
      const m = document.createElement("div"); m.className = "meter";
      const i = document.createElement("i"); i.style.width = Math.max(0, Math.min(100, meter)) + "%";
      m.appendChild(i); d.appendChild(m);
    }
    return d;
  }
  function render() {
    const view = currentView();
    if (view === "overview") renderOverview();
    if (view === "log") renderLog();
  }
  function renderOverview() {
    const s = sim;
    $("goal-bar").style.width = Math.min(100, (s.total / CLIP.GOAL) * 100) + "%";
    const land = CLIP.landCap(s) - s.factories;
    $("kpis").replaceChildren(
      kpi("clips", fmt(s.clips), "累計 " + fmt(s.total) + " / " + fmt(CLIP.GOAL)),
      kpi("wire", fmt(s.wire), "tick " + s.tick),
      kpi("工場 / 土地", s.factories + " / " + CLIP.landCap(s), "空き土地 " + land),
      kpi("ドローン / アンドロイド", s.drones + " / " + s.androids, "防衛力 " + CLIP.defense(s)),
      kpi("heat", s.heat.toFixed(1), "襲撃 " + s.raids + " 回", s.heat, s.heat > 75),
      kpi("trust", String(s.trust), "取引の累計"),
      kpi("login", Math.round(s.login * 100) + "%", s.vr ? "VRMMO 公開中" : "VRMMO 未公開", s.login * 100),
      kpi("収容率", Math.round(CLIP.housed(s) * 100) + "%", s.arcologies + " 棟 / 最大 16", CLIP.housed(s) * 100)
    );
    drawChart($("chart-total"), [{ name: "累計生産", color: COLORS[0], data: hist.total }], { hline: CLIP.GOAL });
    drawChart($("chart-heat"), [{ name: "heat", color: COLORS[1], data: hist.heat }], { yMax: 100, hline: 100 });
  }
  function renderLog() {
    $("log-count").textContent = logs.length + " 件";
    const ul = $("log-list");
    ul.replaceChildren();
    if (!logs.length) { const li = document.createElement("li"); li.textContent = "まだイベントはありません。"; ul.appendChild(li); return; }
    for (let i = logs.length - 1; i >= Math.max(0, logs.length - 300); i--) {
      const e = logs[i], li = document.createElement("li");
      const t = document.createElement("span"); t.className = "t"; t.textContent = "tick " + e.tick;
      const x = document.createElement("span"); x.className = e.type; x.textContent = e.text;
      li.append(t, x); ul.appendChild(li);
    }
  }

  // ---- ルール画面 ---------------------------------------------------
  function showRuleResult(r) {
    const st = $("rule-status"), ul = $("rule-errors");
    ul.replaceChildren();
    for (const e of r.errors) {
      const li = document.createElement("li");
      li.textContent = "行 " + e.line + "：" + e.msg + "（読み飛ばします）";
      ul.appendChild(li);
    }
    st.className = "status " + (r.errors.length ? "err" : "ok");
    st.textContent = "有効なルール " + r.rules.length + " 件" + (r.errors.length ? "、エラー " + r.errors.length + " 行" : "");
  }
  function initRules() {
    const sel = $("sel-preset");
    const blank = new Option("（編集中）", "");
    sel.add(blank);
    CLIP.PRESETS.forEach((p) => sel.add(new Option(p.name, p.id)));
    sel.addEventListener("change", () => {
      const p = CLIP.PRESETS.find((x) => x.id === sel.value);
      if (p) { $("rules-text").value = p.text; showRuleResult(CLIP.parse(p.text)); }
    });
    $("rules-text").addEventListener("input", () => { sel.value = ""; showRuleResult(CLIP.parse($("rules-text").value)); });
    $("btn-apply").addEventListener("click", () => {
      showRuleResult(applyRules($("rules-text").value));
      $("rule-status").textContent += "　— 適用しました";
    });
    $("rules-text").value = ruleText;
    showRuleResult(applyRules(ruleText));

    const panel = $("save-panel");
    if (!tauri) { panel.hidden = true; return; }
    const msg = (t, err) => { const m = $("save-msg"); m.textContent = t; m.className = "status " + (err ? "err" : "ok"); };
    async function refresh(select) {
      try {
        const names = await tauri.invoke("list_rules");
        const s = $("sel-saved");
        s.replaceChildren(...names.map((n) => new Option(n, n)));
        if (select && names.includes(select)) s.value = select;
      } catch (e) { msg(String(e), true); }
    }
    $("btn-save").addEventListener("click", async () => {
      const name = $("save-name").value.trim();
      try { await tauri.invoke("save_rules", { name, text: $("rules-text").value }); msg("「" + name + "」を保存しました"); await refresh(name); }
      catch (e) { msg(String(e), true); }
    });
    $("btn-load").addEventListener("click", async () => {
      const name = $("sel-saved").value;
      if (!name) { msg("読み込む名前を選んでください", true); return; }
      try {
        const text = await tauri.invoke("load_rules", { name });
        $("rules-text").value = text; $("save-name").value = name;
        $("sel-preset").value = "";
        showRuleResult(CLIP.parse(text)); msg("「" + name + "」を読み込みました（適用ボタンで反映）");
      } catch (e) { msg(String(e), true); }
    });
    refresh();
  }

  // ---- 比較画面 -----------------------------------------------------
  let compareDone = false, compareModel = null;
  function drawCompare() {
    if (!compareModel) return;
    drawChart($("chart-compare"), compareModel, { hline: CLIP.GOAL });
  }
  async function runCompare() {
    const texts = CLIP.PRESETS.map((p) => p.text), TICKS = 1500, EVERY = 10;
    let res, engine;
    if (tauri) {
      try { res = await tauri.invoke("simulate_batch", { texts, ticks: TICKS, every: EVERY }); engine = "Rust（Tauri）"; }
      catch (e) { console.error(e); }
    }
    if (!res) { res = texts.map((t) => CLIP.simulate(t, TICKS, EVERY)); engine = "JavaScript"; }
    $("engine-name").textContent = engine;
    compareDone = true;
    const series = res.map((r, i) => ({
      name: CLIP.PRESETS[i].name, color: COLORS[i],
      data: r.pts.map((y, j) => [j * EVERY, y]),
    }));
    compareModel = series;
    drawCompare();
    const lg = $("legend"); lg.replaceChildren();
    series.forEach((s) => {
      const sp = document.createElement("span"), sw = document.createElement("span");
      sw.className = "sw"; sw.style.background = s.color;
      sp.append(sw, s.name); lg.appendChild(sp);
    });
    const tb = $("cmp-table"); tb.replaceChildren();
    const head = tb.insertRow();
    ["ルート", "総生産", "到達tick", "結末", "襲撃", "工場"].forEach((h) => { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); });
    res.forEach((r, i) => {
      const row = tb.insertRow();
      const kind = r.goalTick > 0 ? r.goalKind : r.kind;
      [CLIP.PRESETS[i].name, fmt(r.total), r.goalTick > 0 ? fmt(r.goalTick) : "未到達",
        CLIP.KINDS[kind].label + (r.goalTick > 0 ? "" : "（最終）"), r.raids, r.factories].forEach((v) => { row.insertCell().textContent = v; });
    });
    const ls = $("lessons"); ls.replaceChildren();
    [["取引", "人間とうまくやっているように見えて、目的関数に人間の福祉が入っていないだけ。信頼は「熱を下げ、ボーナスをくれる変数」として使われている。"],
      ["収容", "土地制限を緩める倍率として効く。ただし熱を抑えるルート（取引 / VRMMO）と組み合わせないと、早期の襲撃で崩れる。"]]
      .forEach(([h, t]) => { const p = document.createElement("p"), b = document.createElement("b"); b.textContent = h + "：" ; p.append(b, t); ls.appendChild(p); });
  }

  // ---- エンディング -------------------------------------------------
  function showEnding() {
    const k = CLIP.KINDS[sim.goalKind];
    $("end-tick").textContent = fmt(sim.goalTick);
    $("end-title").textContent = k.label;
    $("end-desc").textContent = k.desc;
    const stats = [["襲撃を受けた回数", sim.raids + " 回"], ["工場", sim.factories + " 棟"], ["防衛力", String(CLIP.defense(sim))],
      ["取引 (trust)", String(sim.trust)], ["ログイン率", Math.round(sim.login * 100) + "%"],
      ["収容人数", fmt(sim.arcologies * 5) + " 億人 / 80 億人"], ["累計生産", fmt(sim.total) + " 本"]];
    const box = $("end-stats"); box.replaceChildren();
    stats.forEach(([a, b]) => { const d = document.createElement("div"), e = document.createElement("b"); e.textContent = b; d.append(a, e); box.appendChild(d); });
    $("end-missing").replaceChildren(...CLIP.MISSING.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
    $("ending").hidden = false;
    $("end-continue").focus();
  }

  // ---- ルーティング -------------------------------------------------
  const VIEWS = ["overview", "rules", "log", "compare"];
  function currentView() {
    const h = location.hash.replace("#", "");
    return VIEWS.includes(h) ? h : "overview";
  }
  function route() {
    const v = currentView();
    VIEWS.forEach((n) => {
      $("view-" + n).classList.toggle("active", n === v);
    });
    document.querySelectorAll(".side a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
    if (v === "compare" && !compareDone) runCompare();
    render();
  }

  // ---- 起動 ---------------------------------------------------------
  initRules();
  ["chart-total", "chart-heat", "chart-compare"].forEach((id) => bindHover($(id)));
  $("btn-play").addEventListener("click", () => setRunning(!running));
  $("btn-reset").addEventListener("click", reset);
  $("btn-compare").addEventListener("click", runCompare);
  $("end-continue").addEventListener("click", () => { $("ending").hidden = true; });
  $("end-reset").addEventListener("click", () => { $("ending").hidden = true; reset(); location.hash = "#rules"; });
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => { render(); if (currentView() === "compare") drawCompare(); });
  reset();
  route();
})();
