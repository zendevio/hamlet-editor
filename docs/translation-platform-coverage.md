# Translation platform coverage

The automated checks cover catalogs and mock-IPC browser tests in Chromium and WebKit for every editor language at 800x600 and 1366x768. Browser engine results do not establish packaged webview acceptance, which this table tracks.

| Platform | Packaged launch | Detection paths | CJK fonts | IME | High DPI | Live switch |
| --- | --- | --- | --- | --- | --- | --- |
| macOS WKWebView | Passed (1.1.0, 2026-10-26, owner's Mac) | Passed on the owner's Steam install | Japanese passed | Not tested | Not tested | Passed (German, Japanese and one more) |
| Windows WebView2 | Not tested | Not tested | Not tested | Not tested | Not tested at 150% scaling | Not tested |
| Linux WebKitGTK | Not tested | Not tested | Not tested with system fonts | Not tested | Not tested | Not tested |

The macOS row comes from a manual run of the packaged 1.1.0 app, which also covered window activation, the About report link and a real save edit. No native-speaker review is claimed. Node ICU branch coverage and Chromium/WebKit mock-IPC checks do not prove glyph availability, operating-system language detection, or real-save behavior on another platform.
