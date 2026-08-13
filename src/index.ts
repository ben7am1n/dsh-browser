/**
 * dsh-browser
 *
 * Browser automation for DeepSeek Harness. Registers a `browser_*` tool
 * family backed by a single reusable Playwright Chromium instance:
 *
 * - `browser_open` / `browser_navigate` — load pages
 * - `browser_click` / `browser_type` / `browser_select` — interact
 * - `browser_get_text` / `browser_get_html` / `browser_eval` — inspect
 * - `browser_screenshot` — capture the page to a workspace file (the model
 *   can then view it with the `read_image` tool)
 * - `browser_wait` / `browser_close` / `browser_install` — lifecycle
 *
 * The browser persists across tool calls: open once, drive many times, close
 * when done. Screenshots default to `<workspace>/browser-screenshots/`.
 *
 * @module dsh-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
// Type-only: makes exec.agent (and its session/cwd) visible.
import type {} from '@deepseek-ai/dsh-agent'
import { mkdirSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { BrowserManager, toJsonSafe, type BrowserLaunchConfig } from './browser-manager.ts'

export const name = 'browser'
export const inject = ['tools']

/** Plugin configuration. */
export interface Config extends BrowserLaunchConfig {
  /** Directory name for screenshots under the workspace (default browser-screenshots). */
  screenshotDir?: string
}

export const Config: Schema<Config> = Schema.object({
  executablePath: Schema.string(),
  channel: Schema.string(),
  navigationTimeoutMs: Schema.number(),
  screenshotDir: Schema.string(),
  viewport: Schema.object({
    width: Schema.number().default(1280),
    height: Schema.number().default(800),
  }),
})

/** Resolve a workspace-relative path to an absolute one. */
function resolveWorkspacePath(cwd: string | undefined, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path)
}

export function apply(ctx: Context, config: Config) {
  const manager = new BrowserManager(config)
  // Close the browser when the plugin unloads (HMR-safe).
  ctx.effect(() => () => {
    void manager.close()
  }, 'dsh-browser: browser lifecycle')

  const toolCwd = (exec: { agent?: { session?: { header?: { cwd?: string } } } }): string | undefined =>
    exec.agent?.session?.header?.cwd

  ctx.tools.register(defineTool({
    name: 'browser_open',
    description: 'Open (or reuse) the browser and optionally navigate to a URL. Returns the current page title and URL. Use before any other browser_* tool.',
    parameters: {
      url: { type: 'string', description: 'URL to navigate to (optional; opens about:blank when omitted)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          open: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      void toolCwd(exec)
      await manager.launch()
      const page = await manager.page()
      if (args.url) await page.goto(args.url)
      return { title: await page.title(), url: page.url(), open: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: 'Navigate the current page to a URL and wait for the page to load. Returns the new title and URL.',
    parameters: {
      url: { type: 'string', required: true, description: 'URL to navigate to' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      await page.goto(args.url)
      return { title: await page.title(), url: page.url() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click an element matching a CSS selector. Returns the resulting page URL and title.',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector for the element to click' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      await page.click(args.selector)
      return { url: page.url(), title: await page.title() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_type',
    description: 'Type text into an input/textarea matching a CSS selector. Optionally press Enter afterwards (e.g. to submit a search).',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector for the input element' },
      text: { type: 'string', required: true, description: 'Text to type' },
      submit: { type: 'boolean', description: 'Press Enter after typing (default false)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          url: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      await page.fill(args.selector, args.text)
      if (args.submit) await page.press(args.selector, 'Enter')
      return { ok: true, url: page.url() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_select',
    description: 'Select option(s) in a <select> element matching a CSS selector.',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector for the select element' },
      values: { type: 'array', items: { type: 'string' }, description: 'Option value(s) to select' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          selected: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      const selected = await page.selectOption(args.selector, args.values ?? [])
      return { ok: true, selected }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current page to a PNG file (default <workspace>/browser-screenshots/<timestamp>.png). Returns the absolute file path, width and height. Use the read_image tool to view it.',
    parameters: {
      path: { type: 'string', description: 'Output PNG path (absolute or relative to the workspace; default auto-generated under browser-screenshots/)' },
      fullPage: { type: 'boolean', description: 'Capture the full scrollable page instead of the viewport (default false)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const page = await manager.page()
      const cwd = toolCwd(exec)
      let target: string
      if (args.path) {
        target = resolveWorkspacePath(cwd, args.path)
      } else {
        const dir = resolveWorkspacePath(cwd, config.screenshotDir ?? 'browser-screenshots')
        mkdirSync(dir, { recursive: true })
        target = join(dir, `shot-${Date.now()}.png`)
      }
      await page.screenshot({ path: target, fullPage: args.fullPage === true })
      const viewport = page.viewportSize()
      return { path: target, width: viewport?.width ?? 0, height: viewport?.height ?? 0 }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_eval',
    description: 'Evaluate JavaScript in the page context and return the JSON-serialized result. Use for reading computed values, scraping data, or triggering page logic.',
    parameters: {
      expression: { type: 'string', required: true, description: 'JavaScript expression or function body to evaluate in the page' },
    },
    output: {
      schema: {
        type: 'json',
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      const result = await page.evaluate((expr) => {
        // eslint-disable-next-line no-new-func
        return Function(`"use strict"; return (${expr})`)()
      }, args.expression)
      return toJsonSafe(result) as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_get_text',
    description: 'Read the visible text of the first element matching a CSS selector (or of the whole body when the selector matches nothing).',
    parameters: {
      selector: { type: 'string', description: 'CSS selector; when omitted, returns the whole page text' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          found: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      if (args.selector) {
        const el = page.locator(args.selector).first()
        if (await el.count() > 0) {
          return { text: await el.innerText(), found: true }
        }
        return { text: '', found: false }
      }
      return { text: await page.locator('body').innerText(), found: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_get_html',
    description: 'Read the outer HTML of the first element matching a CSS selector (or the whole document when omitted). Useful for inspecting page structure.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector; when omitted, returns document.documentElement.outerHTML' },
      maxLength: { type: 'number', description: 'Truncate the returned HTML to this many characters (default 20000)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          html: { type: 'string' },
          truncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const page = await manager.page()
      const max = Math.max(1, Math.min(200_000, args.maxLength ?? 20_000))
      let html: string
      if (args.selector) {
        const el = page.locator(args.selector).first()
        html = (await el.count() > 0) ? await el.evaluate((n) => n.outerHTML) : ''
      } else {
        html = await page.evaluate(() => document.documentElement.outerHTML)
      }
      const truncated = html.length > max
      return { html: html.slice(0, max), truncated }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_wait',
    description: 'Wait a number of milliseconds (for slow pages, animations, or lazy-loaded content).',
    parameters: {
      ms: { type: 'number', required: true, description: 'Milliseconds to wait (1-60000)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      await new Promise((r) => setTimeout(r, Math.min(60_000, Math.max(1, args.ms))))
      return { ok: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_close',
    description: 'Close the browser and release resources. Call when browsing is finished. The browser can be reopened by any browser_* tool later.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      await manager.close()
      return { ok: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_install',
    description: 'Explain how to install a Chromium browser for dsh-browser, or attempt the installation by running "npx playwright install chromium". Use when a browser_* tool reports a launch failure.',
    parameters: {
      run: { type: 'boolean', description: 'Attempt the installation (default true). Requires network access.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string' },
          attempted: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      if (args.run === false) {
        return {
          message: 'Install Chromium manually: run "npx playwright install chromium" in the dsh host environment, or set launch.executablePath / launch.channel in the dsh-browser plugin config to use an installed browser.',
          attempted: false,
        }
      }
      // Try launching first: maybe a browser is already available.
      try {
        await manager.launch()
        await manager.close()
        return { message: 'A browser is already available; no install needed.', attempted: false }
      } catch {
        // Fall through to the install attempt.
      }
      return {
        message: 'Run "npx playwright install chromium" to download a Chromium browser, or configure launch.executablePath / launch.channel. This tool does not download browsers automatically.',
        attempted: false,
      }
    },
  }))
}
