//! The circuit as the student drew it: parts placed on a grid and straight wires.
//! This is the same JSON shape as a saved `.nabd` file.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A point on the board, in board pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

impl Pt {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// Exact identity of a point, used to find where pins and wire ends meet.
    /// `-0` and `0` are the same point, as they are in the TypeScript key `"x,y"`.
    pub fn key(self) -> PointKey {
        let norm = |v: f64| if v == 0.0 { 0u64 } else { v.to_bits() };
        PointKey(norm(self.x), norm(self.y))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PointKey(u64, u64);

/// A parameter is a number (resistance, voltage...) or a choice from a list (waveform, colour).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    Num(f64),
    Text(String),
}

impl ParamValue {
    /// Number value with JavaScript `parseFloat` rules for text, so `"16"` reads as 16.
    pub fn as_num(&self) -> Option<f64> {
        match self {
            ParamValue::Num(v) => Some(*v),
            ParamValue::Text(s) => parse_float_prefix(s),
        }
    }

    /// Text value with JavaScript `String(v)` rules for numbers, so 16 reads as `"16"`.
    pub fn as_text(&self) -> String {
        match self {
            ParamValue::Text(s) => s.clone(),
            ParamValue::Num(v) => js_number_string(*v),
        }
    }
}

pub type Params = HashMap<String, ParamValue>;

/// Reading parameters with the fallbacks the part models use.
pub trait ParamsExt {
    /// A finite number, or `fallback` when missing or not a number.
    fn num(&self, key: &str, fallback: f64) -> f64;
    /// The value as text (`"undefined"` when missing, like JavaScript).
    fn text(&self, key: &str) -> String;
    /// JavaScript `Number(v)`: text that is not entirely a number gives NaN.
    fn strict_num(&self, key: &str) -> f64;
}

impl ParamsExt for Params {
    fn num(&self, key: &str, fallback: f64) -> f64 {
        match self.get(key).and_then(ParamValue::as_num) {
            Some(v) if v.is_finite() => v,
            _ => fallback,
        }
    }

    fn text(&self, key: &str) -> String {
        self.get(key).map_or_else(|| "undefined".to_string(), ParamValue::as_text)
    }

    fn strict_num(&self, key: &str) -> f64 {
        match self.get(key) {
            Some(ParamValue::Num(v)) => *v,
            Some(ParamValue::Text(s)) => {
                let t = s.trim();
                if t.is_empty() { 0.0 } else { t.parse().unwrap_or(f64::NAN) }
            }
            None => f64::NAN,
        }
    }
}

/// One component placed on the board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Part {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub x: f64,
    pub y: f64,
    /// Quarter turns clockwise.
    #[serde(default)]
    pub rot: i32,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub params: Params,
}

/// A straight wire segment. Wires connect wherever their ends meet a pin or another wire end.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wire {
    pub id: String,
    pub a: Pt,
    pub b: Pt,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircuitDoc {
    #[serde(default = "one")]
    pub version: u32,
    #[serde(default)]
    pub title: String,
    pub parts: Vec<Part>,
    pub wires: Vec<Wire>,
}

fn one() -> u32 {
    1
}

impl CircuitDoc {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    pub fn part(&self, id: &str) -> Option<&Part> {
        self.parts.iter().find(|p| p.id == id)
    }

    /// Time step: 10 µs normally, smaller when a source runs fast (at least 50 steps per cycle),
    /// so a 5 kHz carrier still looks like a sine wave.
    pub fn choose_dt(&self) -> f64 {
        let mut fmax = 0.0f64;
        for p in &self.parts {
            if p.kind != "ac" && p.kind != "funcgen" {
                continue;
            }
            let f = or_zero(p.params.strict_num("f"));
            let extra = if p.params.text("wave") == "fm" { or_zero(p.params.strict_num("dev")) } else { 0.0 };
            fmax = fmax.max(f + extra);
        }
        if fmax <= 0.0 {
            return 1e-5;
        }
        (1.0 / (fmax * 50.0)).clamp(2e-7, 1e-5)
    }

    /// Changes only when the wiring changes (not values), so the simulator can keep running
    /// while a student turns a knob or flips a switch.
    pub fn topology_key(&self) -> String {
        let mut s = String::new();
        for p in &self.parts {
            s.push_str(&format!("{}:{}:{}:{}:{};", p.id, p.kind, p.x, p.y, p.rot));
        }
        s.push('#');
        for w in &self.wires {
            s.push_str(&format!("{},{}-{},{};", w.a.x, w.a.y, w.b.x, w.b.y));
        }
        s
    }
}

/// JavaScript `Number(v) || 0`.
fn or_zero(v: f64) -> f64 {
    if v.is_nan() { 0.0 } else { v }
}

/// JavaScript `parseFloat`: the longest leading decimal number, ignoring leading spaces.
fn parse_float_prefix(s: &str) -> Option<f64> {
    let t = s.trim_start();
    if let Some(rest) = t.strip_prefix("Infinity").or_else(|| t.strip_prefix("+Infinity")) {
        let _ = rest;
        return Some(f64::INFINITY);
    }
    if t.starts_with("-Infinity") {
        return Some(f64::NEG_INFINITY);
    }
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let digits_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i == digits_start || (i == digits_start + 1 && b[digits_start] == b'.') {
        return None;
    }
    let mantissa_end = i;
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let exp_start = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > exp_start {
            i = j;
        }
    }
    let end = if i > mantissa_end { i } else { mantissa_end };
    t[..end].parse().ok()
}

/// Number to text the way JavaScript prints it, for the values parts use (integers and short decimals).
pub fn js_number_string(v: f64) -> String {
    if v.is_nan() {
        "NaN".into()
    } else if v.is_infinite() {
        if v > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if v == v.trunc() && v.abs() < 1e21 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_float_like_javascript() {
        assert_eq!(parse_float_prefix("16"), Some(16.0));
        assert_eq!(parse_float_prefix(" 2.5k"), Some(2.5));
        assert_eq!(parse_float_prefix("1e3x"), Some(1000.0));
        assert_eq!(parse_float_prefix("1e"), Some(1.0));
        assert_eq!(parse_float_prefix("abc"), None);
        assert_eq!(parse_float_prefix("."), None);
        assert_eq!(parse_float_prefix("-.5"), Some(-0.5));
    }

    #[test]
    fn number_text_like_javascript() {
        assert_eq!(js_number_string(16.0), "16");
        assert_eq!(js_number_string(0.5), "0.5");
        assert_eq!(js_number_string(-0.0), "0");
    }
}
