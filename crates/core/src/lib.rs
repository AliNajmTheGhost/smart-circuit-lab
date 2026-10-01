//! نبض (Nabd) simulation core.
//!
//! Pure computation with no I/O, so the same code runs in the browser (WebAssembly),
//! in the desktop app and on the school server (re-checking a student's exam circuit).
//!
//! Flow: [`doc::CircuitDoc`] (the drawing) → [`netlist`] (electrical nodes) →
//! [`engine::Engine`] (part models from [`devices`] stamped into [`stamp::Stamper`],
//! solved by [`linalg`]) → readings, doctor notes, Bode plots, curves.

pub mod builder;
pub mod catalog;
pub mod curves;
pub mod devices;
pub mod doc;
pub mod doctor;
pub mod engine;
pub mod fault;
pub mod linalg;
pub mod netlist;
pub mod stamp;
pub mod trace;

pub use doc::{CircuitDoc, ParamValue, Params, Part, Pt, Wire};
pub use engine::{Engine, Failure, PartIssue, Reading};
