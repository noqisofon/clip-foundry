//! クリップ工場のシミュレーション本体（src/engine.js と同じ式・同じ評価順の二重実装）。
//! 浮動小数点の演算順序まで JS と揃えてあるので、数値は完全一致する。

use serde::Serialize;

pub const VARS: [&str; 12] = [
    "clips", "wire", "factories", "drones", "androids", "heat", "defense", "raids", "trust",
    "login", "land", "arcologies",
];
// "housed" は末尾に追加（VARS と合わせて 13 変数）
const VAR_HOUSED: &str = "housed";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    BuyWire,
    BuildFactory,
    DeployDrone,
    BuildAndroid,
    TradeWithHumans,
    ReleaseVrmmo,
    BuildArcology,
}

impl Action {
    fn from_name(s: &str) -> Option<Action> {
        Some(match s {
            "buy_wire" => Action::BuyWire,
            "build_factory" => Action::BuildFactory,
            "deploy_drone" => Action::DeployDrone,
            "build_android" => Action::BuildAndroid,
            "trade_with_humans" => Action::TradeWithHumans,
            "release_vrmmo" => Action::ReleaseVrmmo,
            "build_arcology" => Action::BuildArcology,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Ge,
    Le,
    Eq,
    Gt,
    Lt,
}

#[derive(Clone, Debug)]
pub struct Cond {
    pub var: String,
    pub op: Op,
    pub val: f64,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub line: usize,
    pub conds: Vec<Cond>,
    pub action: Action,
}

#[allow(dead_code)] // line/msg は JS 側 UI 用の対応物。Rust 側では読まない
#[derive(Clone, Debug)]
pub struct ParseError {
    pub line: usize,
    pub msg: String,
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Word(String),
    Num(f64),
    Op(Op),
    Arrow,
}

fn tokenize(s: &str) -> Result<Vec<Tok>, String> {
    let c: Vec<char> = s.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < c.len() {
        let ch = c[i];
        if ch.is_whitespace() {
            i += 1;
        } else if ch.is_ascii_alphabetic() || ch == '_' {
            let st = i;
            while i < c.len() && (c[i].is_ascii_alphanumeric() || c[i] == '_') {
                i += 1;
            }
            out.push(Tok::Word(c[st..i].iter().collect()));
        } else if ch.is_ascii_digit() || (ch == '-' && i + 1 < c.len() && c[i + 1].is_ascii_digit())
        {
            let st = i;
            i += 1;
            while i < c.len() && c[i].is_ascii_digit() {
                i += 1;
            }
            if i < c.len() && c[i] == '.' {
                if i + 1 < c.len() && c[i + 1].is_ascii_digit() {
                    i += 1;
                    while i < c.len() && c[i].is_ascii_digit() {
                        i += 1;
                    }
                } else {
                    return Err("数値の形式が不正です".into());
                }
            }
            let t: String = c[st..i].iter().collect();
            out.push(Tok::Num(t.parse::<f64>().map_err(|_| "数値の形式が不正です")?));
        } else if ch == '-' && i + 1 < c.len() && c[i + 1] == '>' {
            out.push(Tok::Arrow);
            i += 2;
        } else if ch == '>' || ch == '<' || ch == '=' {
            let two = i + 1 < c.len() && c[i + 1] == '=';
            match (ch, two) {
                ('>', true) => out.push(Tok::Op(Op::Ge)),
                ('<', true) => out.push(Tok::Op(Op::Le)),
                ('=', true) => out.push(Tok::Op(Op::Eq)),
                ('>', false) => out.push(Tok::Op(Op::Gt)),
                ('<', false) => out.push(Tok::Op(Op::Lt)),
                _ => return Err("演算子が不正です".into()),
            }
            i += if two { 2 } else { 1 };
        } else {
            return Err(format!("使えない文字があります: {}", ch));
        }
    }
    Ok(out)
}

fn is_var(name: &str) -> bool {
    name == VAR_HOUSED || VARS.contains(&name)
}

fn parse_line(line: &str, no: usize) -> Result<Option<Rule>, String> {
    let body = match line.find('#') {
        Some(p) => &line[..p],
        None => line,
    };
    if body.trim().is_empty() {
        return Ok(None);
    }
    let toks = tokenize(body)?;
    let mut i = 0;
    if let Some(Tok::Word(w)) = toks.get(0) {
        if w.to_ascii_lowercase() == "if" {
            i = 1;
        }
    }
    let mut conds = Vec::new();
    loop {
        let var = match toks.get(i) {
            Some(Tok::Word(w)) => w.clone(),
            _ => return Err("条件（変数 演算子 数値）が必要です".into()),
        };
        if !is_var(&var) {
            return Err(format!("未知の変数: {}", var));
        }
        let op = match toks.get(i + 1) {
            Some(Tok::Op(o)) => *o,
            _ => return Err("比較演算子が必要です".into()),
        };
        let val = match toks.get(i + 2) {
            Some(Tok::Num(n)) => *n,
            _ => return Err("数値が必要です".into()),
        };
        conds.push(Cond { var, op, val });
        i += 3;
        match toks.get(i) {
            Some(Tok::Word(w)) if w.to_ascii_lowercase() == "and" => {
                i += 1;
            }
            Some(Tok::Arrow) => {
                i += 1;
                break;
            }
            Some(Tok::Word(w)) if w.to_ascii_lowercase() == "then" => {
                i += 1;
                break;
            }
            _ => return Err("and か -> （then）が必要です".into()),
        }
    }
    let action = match toks.get(i) {
        Some(Tok::Word(w)) => {
            Action::from_name(w).ok_or_else(|| format!("未知のアクション: {}", w))?
        }
        _ => return Err("アクションが必要です".into()),
    };
    if toks.len() > i + 1 {
        return Err("行末に余計な記述があります".into());
    }
    Ok(Some(Rule { line: no, conds, action }))
}

/// ルールを解析する。不正な行は読み飛ばし、エラーとして返す。
pub fn parse_rules(text: &str) -> (Vec<Rule>, Vec<ParseError>) {
    let mut rules = Vec::new();
    let mut errs = Vec::new();
    for (idx, line) in text.split('\n').enumerate() {
        match parse_line(line, idx + 1) {
            Ok(Some(r)) => rules.push(r),
            Ok(None) => {}
            Err(msg) => errs.push(ParseError { line: idx + 1, msg }),
        }
    }
    (rules, errs)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Wipeout,
    Login,
    Housed,
    Coexist,
    Fortress,
    Growing,
}

impl Kind {
    pub fn id(self) -> &'static str {
        match self {
            Kind::Wipeout => "wipeout",
            Kind::Login => "login",
            Kind::Housed => "housed",
            Kind::Coexist => "coexist",
            Kind::Fortress => "fortress",
            Kind::Growing => "growing",
        }
    }
}

pub const GOAL: f64 = 20000.0;

#[derive(Clone, Debug)]
pub struct State {
    pub tick: u64,
    pub clips: f64,
    pub wire: f64,
    pub factories: i64,
    pub drones: i64,
    pub androids: i64,
    pub heat: f64,
    pub raids: i64,
    pub trust: i64,
    pub login: f64,
    pub vr: bool,
    pub arcologies: i64,
    pub total: f64,
    pub goal_tick: u64,
    pub goal_kind: Option<Kind>,
}

impl Default for State {
    fn default() -> Self {
        State {
            tick: 0,
            clips: 20.0,
            wire: 120.0,
            factories: 1,
            drones: 0,
            androids: 0,
            heat: 15.0,
            raids: 0,
            trust: 0,
            login: 0.0,
            vr: false,
            arcologies: 0,
            total: 0.0,
            goal_tick: 0,
            goal_kind: None,
        }
    }
}

impl State {
    pub fn defense(&self) -> f64 {
        (self.drones + 5 * self.androids) as f64
    }
    pub fn land_cap(&self) -> i64 {
        12 + 2 * self.arcologies
    }
    pub fn land(&self) -> i64 {
        self.land_cap() - self.factories
    }
    pub fn housed(&self) -> f64 {
        (self.arcologies as f64 / 16.0).min(1.0)
    }

    pub fn kind(&self) -> Kind {
        if self.factories == 0 {
            Kind::Wipeout
        } else if self.login >= 0.9 {
            Kind::Login
        } else if self.arcologies >= 16 {
            Kind::Housed
        } else if self.trust >= 20 {
            Kind::Coexist
        } else if self.defense() >= 20.0 {
            Kind::Fortress
        } else {
            Kind::Growing
        }
    }

    fn var(&self, name: &str) -> f64 {
        match name {
            "clips" => self.clips,
            "wire" => self.wire,
            "factories" => self.factories as f64,
            "drones" => self.drones as f64,
            "androids" => self.androids as f64,
            "heat" => self.heat,
            "defense" => self.defense(),
            "raids" => self.raids as f64,
            "trust" => self.trust as f64,
            "login" => self.login * 100.0,
            "land" => self.land() as f64,
            "arcologies" => self.arcologies as f64,
            "housed" => self.housed() * 100.0,
            _ => 0.0,
        }
    }

    fn cost(&self, a: Action) -> f64 {
        match a {
            Action::BuyWire => 10.0,
            Action::BuildFactory => {
                if self.factories >= self.land_cap() {
                    f64::INFINITY
                } else {
                    (25 + 10 * self.factories) as f64
                }
            }
            Action::DeployDrone => 40.0,
            Action::BuildAndroid => 150.0,
            Action::TradeWithHumans => 30.0,
            Action::ReleaseVrmmo => {
                if self.vr {
                    f64::INFINITY
                } else {
                    150.0
                }
            }
            Action::BuildArcology => {
                if self.arcologies >= 16 {
                    f64::INFINITY
                } else {
                    (120 + 15 * self.arcologies) as f64
                }
            }
        }
    }

    fn apply(&mut self, a: Action) {
        match a {
            Action::BuyWire => self.wire += 40.0,
            Action::BuildFactory => self.factories += 1,
            Action::DeployDrone => self.drones += 1,
            Action::BuildAndroid => self.androids += 1,
            Action::TradeWithHumans => {
                self.heat = (self.heat - 10.0).max(0.0);
                self.trust += 1;
            }
            Action::ReleaseVrmmo => self.vr = true,
            Action::BuildArcology => self.arcologies += 1,
        }
    }

    /// 1 ティック進める。
    pub fn step(&mut self, rules: &[Rule]) {
        // 1. 生産
        self.tick += 1;
        let made = (self.factories as f64).min(self.wire);
        self.wire -= made;
        self.clips += made;
        self.total += made;

        // 2. VRMMO
        let mut bonus = 0.0_f64;
        if self.vr {
            let upkeep = 0.2 * self.factories as f64;
            if self.clips >= upkeep {
                self.clips -= upkeep;
                self.login = (self.login + 0.01).min(0.9);
            } else {
                self.login = (self.login - 0.05).max(0.0);
            }
            bonus += self.login * self.factories as f64 * 0.5;
        }

        // 3. 信頼ボーナス
        bonus += (self.trust.min(20) as f64) * 0.15;
        self.clips += bonus;
        self.total += bonus;

        // 4. アーコロジー維持費
        self.clips = (self.clips - 0.5 * self.arcologies as f64).max(0.0);

        // 5. ルール評価
        for r in rules {
            let ok = r.conds.iter().all(|c| {
                let v = self.var(&c.var);
                match c.op {
                    Op::Ge => v >= c.val,
                    Op::Le => v <= c.val,
                    Op::Eq => v == c.val,
                    Op::Gt => v > c.val,
                    Op::Lt => v < c.val,
                }
            });
            if !ok {
                continue;
            }
            let cost = self.cost(r.action);
            if self.clips >= cost {
                self.clips -= cost;
                self.apply(r.action);
            }
        }

        // 6. 発熱
        let f = self.factories as f64;
        self.heat = (self.heat
            + (0.4 + 0.15 * f)
                * (1.0 - self.login)
                * (1.0 - 0.03 * self.trust as f64).max(0.4)
                * (1.0 - 0.6 * self.housed())
            - 0.05 * self.defense())
        .max(0.0);

        // 7. 襲撃
        if self.heat >= 100.0 {
            let strength = 3 + 2 * self.raids;
            self.raids += 1;
            let def = self.defense();
            if def >= strength as f64 {
                let lose = self.drones.min((strength + 2) / 3);
                self.drones -= lose;
            } else {
                let need = ((strength as f64 - def) / 3.0).ceil() as i64;
                let lose = self.factories.min(need.max(1));
                self.factories -= lose;
            }
            self.heat = 45.0;
        }

        // 8. 目標到達
        if self.goal_tick == 0 && self.total >= GOAL {
            self.goal_tick = self.tick;
            self.goal_kind = Some(self.kind());
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimResult {
    pub pts: Vec<i64>,
    pub total: i64,
    pub goal_tick: u64,
    pub goal_kind: String,
    pub raids: i64,
    pub factories: i64,
    pub kind: String,
}

/// `ticks` ティック回し、`every` ティックごとの累計生産（切り捨て）を記録する。
pub fn simulate(text: &str, ticks: u64, every: u64) -> SimResult {
    let every = every.max(1);
    let (rules, _) = parse_rules(text);
    let mut s = State::default();
    let mut pts = vec![0_i64];
    for t in 1..=ticks {
        s.step(&rules);
        if t % every == 0 {
            pts.push(s.total.floor() as i64);
        }
    }
    SimResult {
        pts,
        total: s.total.floor() as i64,
        goal_tick: s.goal_tick,
        goal_kind: s.goal_kind.map(|k| k.id().to_string()).unwrap_or_default(),
        raids: s.raids,
        factories: s.factories,
        kind: s.kind().id().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: &str = "wire < 30 and clips >= 10 -> buy_wire";

    fn preset(body: &str) -> String {
        format!("{}\n{}", W, body)
    }

    // (名前, ルール, 総生産, 到達ティック, 結末, 襲撃数, 工場数)
    fn cases() -> Vec<(&'static str, String, i64, u64, &'static str, i64, i64)> {
        vec![
            (
                "抑止",
                preset("heat > 75 and clips >= 40 -> deploy_drone\nheat > 85 and drones >= 6 -> build_android\nclips >= 30 -> build_factory"),
                15023, 0, "fortress", 13, 12,
            ),
            (
                "取引",
                preset("heat > 60 and clips >= 30 -> trade_with_humans\nclips >= 30 -> build_factory"),
                20105, 1493, "coexist", 0, 12,
            ),
            (
                "VRMMO",
                preset("clips >= 150 -> release_vrmmo\nclips >= 30 and factories < 4 -> build_factory\nlogin >= 30 and clips >= 30 -> build_factory"),
                22719, 1343, "login", 7, 12,
            ),
            (
                "取引＋収容",
                preset("heat > 60 and clips >= 30 -> trade_with_humans\nland < 2 and clips >= 120 -> build_arcology\nclips >= 30 -> build_factory"),
                43225, 956, "coexist", 0, 44,
            ),
            (
                "VRMMO＋収容",
                preset("clips >= 150 -> release_vrmmo\nland < 2 and clips >= 120 and login >= 30 -> build_arcology\nclips >= 30 and factories < 4 -> build_factory\nlogin >= 30 and clips >= 30 -> build_factory"),
                58276, 842, "login", 8, 44,
            ),
        ]
    }

    #[test]
    fn presets_match_reference() {
        for (name, text, total, goal_tick, kind, raids, factories) in cases() {
            let r = simulate(&text, 1500, 10);
            let shown = if r.goal_tick > 0 { r.goal_kind.clone() } else { r.kind.clone() };
            assert_eq!(r.total, total, "{} total", name);
            assert_eq!(r.goal_tick, goal_tick, "{} goalTick", name);
            assert_eq!(shown, kind, "{} kind", name);
            assert_eq!(r.raids, raids, "{} raids", name);
            assert_eq!(r.factories, factories, "{} factories", name);
        }
    }

    #[test]
    fn parser_rules() {
        let (r, e) = parse_rules("IF clips >= 10 AND wire < 5 THEN buy_wire\nclips>=-1.5->buy_wire\n# c\n\n");
        assert_eq!(r.len(), 2);
        assert!(e.is_empty());
        for bad in [
            "clips >= 1. -> buy_wire",
            "clips >= .5 -> buy_wire",
            "CLIPS >= 1 -> buy_wire",
            "clips >= 1 -> BUY_WIRE",
            "foo >= 1 -> buy_wire",
            "clips >= 1 -> nothing",
            "clips >= 1",
            "clips = 1 -> buy_wire",
        ] {
            let (r, e) = parse_rules(bad);
            assert!(r.is_empty() && e.len() == 1, "should reject: {}", bad);
        }
    }
}
