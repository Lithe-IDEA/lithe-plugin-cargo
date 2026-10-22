//! Test-only bridge to Lithe's public JSON API; it contains no Cargo semantics.

fn main() {
    let request = std::env::args().nth(1).expect("one JSON request argument");
    println!("{}", lithe_core::execute_json(&request));
}
