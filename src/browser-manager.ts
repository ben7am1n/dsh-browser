/**
 * Browser manager: a single reusable Playwright Chromium instance shared by
 * every browser_* tool in the plugin, so the agent can drive a page across
 * multiple tool calls without losing state.
 */

import { chromium, type Browser, type Page } from 'playwright-core'

export interface BrowserLaunchConfig {
  /** Absolute path to a browser binary (takes precedence over channel). */
  executablePath?: string
  /** Browser channel: 'chromium' | 'chrome' | 'msedge'. */
  channel?: string
  /** Default navigation/action timeout in milliseconds. */
  navigationTimeoutMs?: number
  /** Viewport size for the page. */
  viewport?: { width: number; height: number }
}

/** Channels tried in order when neither executablePath nor channel is set. */
const CHANNEL_CANDIDATES = ['chromium', 'chrome', 'msedge'] as const

export class BrowserManager {
  private browser: Browser | undefined
  private currentPage: Page | undefined
  private readonly config: BrowserLaunchConfig

  constructor(config: BrowserLaunchConfig) {
    this.config = config
  }

  get isOpen(): boolean {
    return this.browser !== undefined && this.browser.isConnected()
  }

  async launch(): Promise<void> {
    if (this.isOpen) return
    const { executablePath, channel, viewport } = this.config
    const attempts: Array<{ executablePath?: string; channel?: string }> = []
    if (executablePath) {
      attempts.push({ executablePath })
    } else if (channel) {
      attempts.push({ channel })
    } else {
      attempts.push(...CHANNEL_CANDIDATES.map((c) => ({ channel: c })))
    }

    let lastError: unknown
    for (const opts of attempts) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          ...opts,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        })
        this.currentPage = await this.browser.newPage({
          viewport: viewport ?? { width: 1280, height: 800 },
        })
        if (this.config.navigationTimeoutMs) {
          this.currentPage.setDefaultNavigationTimeout(this.config.navigationTimeoutMs)
          this.currentPage.setDefaultTimeout(this.config.navigationTimeoutMs)
        }
        return
      } catch (err) {
        lastError = err
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(
      `Browser launch failed: ${detail}. ` +
      'Install a browser with: npx playwright install chromium — ' +
      'or configure launch.executablePath / launch.channel in the plugin config.',
    )
  }

  /** Return the current page, launching the browser on first use. */
  async page(): Promise<Page> {
    if (!this.currentPage || !this.browser?.isConnected()) {
      await this.launch()
    }
    return this.currentPage as Page
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close()
    } catch {
      // Browser already gone; nothing to do.
    }
    this.browser = undefined
    this.currentPage = undefined
  }
}

/** Best-effort JSON-safe serialization of a page-eval result. */
export function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}
