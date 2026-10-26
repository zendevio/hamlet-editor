# Translation platform coverage

The automated checks cover catalogs and mock-IPC browser tests in Chromium and WebKit for every editor language at 800x600 and 1366x768. Browser engine results do not establish packaged webview acceptance, which this table tracks.

| Platform | Packaged launch | Detection paths | CJK fonts | IME | High DPI | Live switch |
| --- | --- | --- | --- | --- | --- | --- |
| macOS WKWebView | Not tested in Phase 3 | Not tested in packaged app | Not tested in packaged app | Not tested | Not tested in packaged app | Not tested in packaged app |
| Windows WebView2 | Not tested | Not tested | Not tested | Not tested | Not tested at 150% scaling | Not tested |
| Linux WebKitGTK | Not tested | Not tested | Not tested with system fonts | Not tested | Not tested | Not tested |

Packaged platform checks belong to Phase 4. No native-speaker review is claimed. Node ICU branch coverage and Chromium/WebKit mock-IPC checks do not prove glyph availability, operating-system language detection, or real-save behavior on another platform.
