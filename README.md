# dsh-browser

Browser automation for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a Playwright-powered `browser_*` tool family so the agent can drive real web pages — fill forms, click through flows, scrape SPA content, and take screenshots it can then view with `read_image`.

## Install

```sh
dsh plugin --profile <name> add dsh-browser
```

The plugin depends on `playwright-core` (bundled with the package) and needs a Chromium-based browser. It tries `chromium`, then `chrome`, then `msedge` channels automatically; if none is found:

```sh
npx playwright install chromium
```

or configure `launch.executablePath` / `launch.channel` in the plugin config.

## Tools

| Tool | Purpose |
|---|---|
| `browser_open` | Open (or reuse) the browser, optionally navigate to a URL |
| `browser_navigate` | Navigate the current page and wait for load |
| `browser_click` | Click an element by CSS selector |
| `browser_type` | Type text into an input (optionally press Enter) |
| `browser_select` | Select option(s) in a `<select>` |
| `browser_screenshot` | Capture a PNG to `<workspace>/browser-screenshots/`; view it with `read_image` |
| `browser_eval` | Evaluate JavaScript in the page, return JSON |
| `browser_get_text` / `browser_get_html` | Read visible text or outer HTML |
| `browser_wait` | Wait for slow pages / lazy content |
| `browser_close` | Close the browser (reopenable by any tool) |
| `browser_install` | Explain or verify browser availability |

The browser persists across tool calls — open once, drive many times, close when done.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `launch.executablePath` | — | Absolute path to a browser binary (takes precedence) |
| `launch.channel` | auto (`chromium` → `chrome` → `msedge`) | Browser channel |
| `launch.navigationTimeoutMs` | — | Default navigation/action timeout |
| `launch.viewport` | `1280×800` | Page viewport |
| `screenshotDir` | `browser-screenshots` | Screenshot directory under the workspace |

```yaml
# profile cordis.patch.yml
- id: browser
  config:
    launch:
      channel: chrome
      navigationTimeoutMs: 30000
```

## Notes

- Runs headless by default; a headed mode may come later.
- Screenshots land in the calling agent's workspace so the model can read them with `read_image`.

## License

MIT
