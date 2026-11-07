// JS エンジンの検証（Rust の sim.rs テストと同じ表）。`npm test` / `node scripts/verify.js`
const CLIP = require("../src/engine.js");
const expect = {
  deter: [15023, 0, "fortress", 13, 12],
  trade: [20105, 1493, "coexist", 0, 12],
  vrmmo: [22719, 1343, "login", 7, 12],
  "trade-arc": [43225, 956, "coexist", 0, 44],
  "vrmmo-arc": [58276, 842, "login", 8, 44],
};
let bad = 0;
for (const p of CLIP.PRESETS) {
  const r = CLIP.simulate(p.text, 1500, 10);
  const shown = r.goalTick > 0 ? r.goalKind : r.kind;
  const got = [r.total, r.goalTick, shown, r.raids, r.factories];
  const ok = JSON.stringify(got) === JSON.stringify(expect[p.id]);
  if (!ok) bad++;
  console.log(ok ? "OK " : "NG ", p.name, got.join(" "));
}
process.exit(bad ? 1 : 0);
