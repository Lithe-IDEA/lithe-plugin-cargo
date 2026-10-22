#[test]
fn greeting_is_available() {
    assert_eq!(cargo_plugin_util::greeting(), "cargo plugin");
}
