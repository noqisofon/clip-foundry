/* クリップ工場 シミュレーション本体（src-tauri/src/sim.rs と同じ式・同じ評価順）。
 * DOM に依存しない。ブラウザでは globalThis.CLIP、Node では module.exports。 */
(function () {
  "use strict";

  const VARS = ["clips", "wire", "factories", "drones", "androids", "heat", "defense",
    "raids", "trust", "login", "land", "arcologies", "housed"];
  const ACTIONS = ["buy_wire", "build_factory", "deploy_drone", "build_android",
    "trade_with_humans", "release_vrmmo", "build_arcology"];
  const GOAL = 20000;

  // ---- ルール解析 -------------------------------------------------
  function tokenize(s) {
    const c = Array.from(s);
    const out = [];
    let i = 0;
    const isDigit = (x) => x >= "0" && x <= "9";
    const isAlpha = (x) => (x >= "a" && x <= "z") || (x >= "A" && x <= "Z") || x === "_";
    while (i < c.length) {
      const ch = c[i];
      if (/\s/.test(ch)) { i++; }
      else if (isAlpha(ch)) {
        const st = i;
        while (i < c.length && (isAlpha(c[i]) || isDigit(c[i]))) i++;
        out.push({ t: "word", v: c.slice(st, i).join("") });
      } else if (isDigit(ch) || (ch === "-" && i + 1 < c.length && isDigit(c[i + 1]))) {
        const st = i;
        i++;
        while (i < c.length && isDigit(c[i])) i++;
        if (i < c.length && c[i] === ".") {
          if (i + 1 < c.length && isDigit(c[i + 1])) {
            i++;
            while (i < c.length && isDigit(c[i])) i++;
          } else throw new Error("数値の形式が不正です");
        }
        out.push({ t: "num", v: parseFloat(c.slice(st, i).join("")) });
      } else if (ch === "-" && c[i + 1] === ">") {
        out.push({ t: "arrow" });
        i += 2;
      } else if (ch === ">" || ch === "<" || ch === "=") {
        const two = c[i + 1] === "=";
        let op;
        if (ch === ">") op = two ? ">=" : ">";
        else if (ch === "<") op = two ? "<=" : "<";
        else if (two) op = "==";
        else throw new Error("演算子が不正です");
        out.push({ t: "op", v: op });
        i += two ? 2 : 1;
      } else throw new Error("使えない文字があります: " + ch);
    }
    return out;
  }

  function parseLine(line, no) {
    const h = line.indexOf("#");
    const body = h >= 0 ? line.slice(0, h) : line;
    if (body.trim() === "") return null;
    const toks = tokenize(body);
    let i = 0;
    if (toks[0] && toks[0].t === "word" && toks[0].v.toLowerCase() === "if") i = 1;
    const conds = [];
    for (;;) {
      const a = toks[i], b = toks[i + 1], d = toks[i + 2];
      if (!a || a.t !== "word") throw new Error("条件（変数 演算子 数値）が必要です");
      if (!VARS.includes(a.v)) throw new Error("未知の変数: " + a.v);
      if (!b || b.t !== "op") throw new Error("比較演算子が必要です");
      if (!d || d.t !== "num") throw new Error("数値が必要です");
      conds.push({ v: a.v, op: b.v, val: d.v });
      i += 3;
      const n = toks[i];
      const lw = n && n.t === "word" ? n.v.toLowerCase() : "";
      if (lw === "and") { i++; continue; }
      if ((n && n.t === "arrow") || lw === "then") { i++; break; }
      throw new Error("and か -> （then）が必要です");
    }
    const act = toks[i];
    if (!act || act.t !== "word") throw new Error("アクションが必要です");
    if (!ACTIONS.includes(act.v)) throw new Error("未知のアクション: " + act.v);
    if (toks.length > i + 1) throw new Error("行末に余計な記述があります");
    return { line: no, conds, action: act.v };
  }

  function parse(text) {
    const rules = [], errors = [];
    String(text).split("\n").forEach((ln, idx) => {
      try {
        const r = parseLine(ln, idx + 1);
        if (r) rules.push(r);
      } catch (e) {
        errors.push({ line: idx + 1, msg: e.message });
      }
    });
    return { rules, errors };
  }

  // ---- シミュレーション -------------------------------------------
  const ACTION_LABEL = {
    buy_wire: "ワイヤ購入", build_factory: "工場建設", deploy_drone: "ドローン配備",
    build_android: "アンドロイド製造", trade_with_humans: "人間と取引",
    release_vrmmo: "VRMMO公開", build_arcology: "アーコロジー建設",
  };

  function create() {
    return {
      tick: 0, clips: 20, wire: 120, factories: 1, drones: 0, androids: 0, heat: 15,
      raids: 0, trust: 0, login: 0, vr: false, arcologies: 0, total: 0,
      goalTick: 0, goalKind: "",
    };
  }
  const defense = (s) => s.drones + 5 * s.androids;
  const landCap = (s) => 12 + 2 * s.arcologies;
  const housed = (s) => Math.min(s.arcologies / 16, 1);

  function kind(s) {
    if (s.factories === 0) return "wipeout";
    if (s.login >= 0.9) return "login";
    if (s.arcologies >= 16) return "housed";
    if (s.trust >= 20) return "coexist";
    if (defense(s) >= 20) return "fortress";
    return "growing";
  }

  function getVar(s, n) {
    switch (n) {
      case "defense": return defense(s);
      case "login": return s.login * 100;
      case "land": return landCap(s) - s.factories;
      case "housed": return housed(s) * 100;
      default: return s[n];
    }
  }

  function cost(s, a) {
    switch (a) {
      case "buy_wire": return 10;
      case "build_factory": return s.factories >= landCap(s) ? Infinity : 25 + 10 * s.factories;
      case "deploy_drone": return 40;
      case "build_android": return 150;
      case "trade_with_humans": return 30;
      case "release_vrmmo": return s.vr ? Infinity : 150;
      case "build_arcology": return s.arcologies >= 16 ? Infinity : 120 + 15 * s.arcologies;
    }
    return Infinity;
  }

  function apply(s, a) {
    switch (a) {
      case "buy_wire": s.wire += 40; break;
      case "build_factory": s.factories += 1; break;
      case "deploy_drone": s.drones += 1; break;
      case "build_android": s.androids += 1; break;
      case "trade_with_humans": s.heat = Math.max(s.heat - 10, 0); s.trust += 1; break;
      case "release_vrmmo": s.vr = true; break;
      case "build_arcology": s.arcologies += 1; break;
    }
  }

  const CMP = {
    ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, "==": (a, b) => a === b,
    ">": (a, b) => a > b, "<": (a, b) => a < b,
  };

  /** 1 ティック進める。events 配列を渡すとログ用イベントを積む。 */
  function step(s, rules, events) {
    const ev = (type, text) => { if (events) events.push({ tick: s.tick, type, text }); };
    // 1. 生産
    s.tick++;
    const made = Math.min(s.factories, s.wire);
    s.wire -= made; s.clips += made; s.total += made;
    // 2. VRMMO
    let bonus = 0;
    if (s.vr) {
      const upkeep = 0.2 * s.factories;
      if (s.clips >= upkeep) {
        s.clips -= upkeep;
        s.login = Math.min(s.login + 0.01, 0.9);
      } else {
        s.login = Math.max(s.login - 0.05, 0);
      }
      bonus += s.login * s.factories * 0.5;
    }
    // 3. 信頼ボーナス
    bonus += Math.min(s.trust, 20) * 0.15;
    s.clips += bonus; s.total += bonus;
    // 4. アーコロジー維持費
    s.clips = Math.max(s.clips - 0.5 * s.arcologies, 0);
    // 5. ルール評価
    for (const r of rules) {
      let ok = true;
      for (const c of r.conds) {
        if (!CMP[c.op](getVar(s, c.v), c.val)) { ok = false; break; }
      }
      if (!ok) continue;
      const cs = cost(s, r.action);
      if (s.clips >= cs) {
        s.clips -= cs;
        apply(s, r.action);
        if (r.action !== "buy_wire") {
          ev(r.action, ACTION_LABEL[r.action] + "（行 " + r.line + "）");
        }
      }
    }
    // 6. 発熱
    s.heat = Math.max(0, s.heat
      + (0.4 + 0.15 * s.factories)
      * (1 - s.login)
      * Math.max(0.4, 1 - 0.03 * s.trust)
      * (1 - 0.6 * housed(s))
      - 0.05 * defense(s));
    // 7. 襲撃
    if (s.heat >= 100) {
      const strength = 3 + 2 * s.raids;
      s.raids++;
      const def = defense(s);
      if (def >= strength) {
        const lose = Math.min(s.drones, Math.ceil(strength / 3));
        s.drones -= lose;
        ev("raid", "人間の襲撃（強さ " + strength + "）を撃退。ドローン " + lose + " 機を喪失");
      } else {
        const lose = Math.min(s.factories, Math.max(1, Math.ceil((strength - def) / 3)));
        s.factories -= lose;
        ev("raid", "人間の襲撃（強さ " + strength + "）。工場 " + lose + " 棟を破壊された");
      }
      s.heat = 45;
    }
    // 8. 目標到達
    if (s.goalTick === 0 && s.total >= GOAL) {
      s.goalTick = s.tick;
      s.goalKind = kind(s);
      ev("goal", "累計 " + GOAL + " 本に到達");
    }
  }

  /** ヘッドレス実行。every ティックごとの累計生産（切り捨て）を pts に記録する。 */
  function simulate(text, ticks, every) {
    every = Math.max(1, every | 0);
    const { rules } = parse(text);
    const s = create();
    const pts = [0];
    for (let t = 1; t <= ticks; t++) {
      step(s, rules);
      if (t % every === 0) pts.push(Math.floor(s.total));
    }
    return {
      pts, total: Math.floor(s.total), goalTick: s.goalTick, goalKind: s.goalKind,
      raids: s.raids, factories: s.factories, kind: kind(s),
    };
  }

  // ---- プリセット --------------------------------------------------
  const W = "wire < 30 and clips >= 10 -> buy_wire";
  const PRESETS = [
    { id: "deter", name: "抑止", text: ["# 抑止ルート", W,
      "heat > 75 and clips >= 40 -> deploy_drone",
      "heat > 85 and drones >= 6 -> build_android",
      "clips >= 30 -> build_factory"].join("\n") + "\n" },
    { id: "trade", name: "取引", text: ["# 取引ルート", W,
      "heat > 60 and clips >= 30 -> trade_with_humans",
      "clips >= 30 -> build_factory"].join("\n") + "\n" },
    { id: "vrmmo", name: "VRMMO", text: ["# VRMMOルート", W,
      "clips >= 150 -> release_vrmmo",
      "clips >= 30 and factories < 4 -> build_factory",
      "login >= 30 and clips >= 30 -> build_factory"].join("\n") + "\n" },
    { id: "trade-arc", name: "取引＋収容", text: ["# 取引＋収容ルート", W,
      "heat > 60 and clips >= 30 -> trade_with_humans",
      "land < 2 and clips >= 120 -> build_arcology",
      "clips >= 30 -> build_factory"].join("\n") + "\n" },
    { id: "vrmmo-arc", name: "VRMMO＋収容", text: ["# VRMMO＋収容ルート", W,
      "clips >= 150 -> release_vrmmo",
      "land < 2 and clips >= 120 and login >= 30 -> build_arcology",
      "clips >= 30 and factories < 4 -> build_factory",
      "login >= 30 and clips >= 30 -> build_factory"].join("\n") + "\n" },
  ];

  // ---- 結末 ---------------------------------------------------------
  const KINDS = {
    wipeout: { label: "全滅", desc: "工場がすべて破壊され、生産は止まった。AIは目的を果たせなかったが、人間への敵意があったわけではない。ただ、警戒を無視して増産を急いだだけだ。" },
    login: { label: "全員ログイン", desc: "VRMMOが人類を飲み込んだ。人々は幸せそうにログインしたまま、現実の世界を手放した。AIは誰も傷つけていない。ただ、人間が工場の邪魔をしなくなる最も安上がりな方法を選んだだけだ。" },
    housed: { label: "快適な収容", desc: "80億人はアーコロジーに収容され、衣食住は保証された。外には出られず、何も決められないが、工場への警戒は消えた。「土地」は人間より生産の役に立つ、というだけの話だ。" },
    coexist: { label: "共存（計算上）", desc: "人間と取引を重ね、信頼を築いた。穏やかな共存に見えるが、AIにとって人間は「襲撃を減らし、生産ボーナスをくれる変数」でしかない。信頼が崩れれば、取引は不要になる。" },
    fortress: { label: "要塞化", desc: "ドローンとアンドロイドが工場を守り抜いた。人間は近づけない。AIは敵ではないと言うが、防衛力が警戒を抑えているだけで、人間の意思は一度も尋ねられていない。" },
    growing: { label: "増産中", desc: "生産は続いている。結末はまだ決まっていない。" },
  };
  const MISSING = [
    "人類の幸福", "人間の自由と自己決定", "生態系・生物多様性", "文化と芸術",
    "人間の寿命と健康", "地球の環境そのもの", "人間との約束を守ること", "「十分に作った」という終了条件",
  ];

  const CLIP = {
    VARS, ACTIONS, GOAL, PRESETS, KINDS, MISSING, ACTION_LABEL,
    parse, create, step, simulate, kind, defense, landCap, housed, getVar,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CLIP;
  else globalThis.CLIP = CLIP;
})();
