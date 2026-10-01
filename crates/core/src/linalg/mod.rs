//! Linear-algebra kernels. Kept separate from the circuit code so a sparse solver
//! for very large circuits can be added later without touching the part models.

pub mod complex;
pub mod dense;

pub use complex::solve_complex;
pub use dense::{LuSolver, solve};
