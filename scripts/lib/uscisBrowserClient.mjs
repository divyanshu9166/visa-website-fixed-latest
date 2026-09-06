import { chromium } from 'playwright';

export class UscisClientError extends Error {
  constructor(message, category = 'UNKNOWN') {
    super(message);
    this.name = 'UscisClientError';
    this.category = category; // 'WAF_CHALLENGE' | 'INTERACTIVE_CHALLENGE' | 'SCHEMA_CANARY' | 'TIMEOUT' | 'LAUNCH_ERROR'
  }
}

const CHALLENGE_TITLE = 'just a moment';
const INTERACTIVE_MARKERS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'input[type="checkbox"]',
  '#cf-turnstile',
  '.cf-turnstile-wrapper',
  'iframe[title*="Cloudflare security challenge"]',
];

export class UscisBrowserClient {
  #browser = null;
  #page = null;
  #isEstablished = false;

  get isEstablished() {
    return this.#isEstablished;
  }

  async init() {
    const isHeadless = process.env.PLAYWRIGHT_HEADLESS === 'true';

    // 1. Attempt to launch real installed Chrome first
    try {
      this.#browser = await chromium.launch({
        channel: 'chrome',
        headless: isHeadless,
      });
    } catch (chromeErr) {
      // 2. Fall back to bundled Chromium if real Chrome is not found
      try {
        this.#browser = await chromium.launch({
          headless: isHeadless,
        });
      } catch (chromiumErr) {
        throw new UscisClientError(
          `Failed to launch browser (Chrome: ${chromeErr.message}; Chromium: ${chromiumErr.message})`,
          'LAUNCH_ERROR'
        );
      }
    }

    const context = await this.#browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });

    this.#page = await context.newPage();

    try {
      await this.#page.goto('https://egov.uscis.gov/processing-times/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
    } catch (navErr) {
      // Even if navigation times out on networkidle, page might still load challenge
    }

    await this.#resolveChallengeOrThrow();
    this.#isEstablished = true;
  }

  async #resolveChallengeOrThrow() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const title = ((await this.#page.title()) || '').toLowerCase();
      if (!title.includes(CHALLENGE_TITLE) && !title.includes('attention required') && !title.includes('security check')) {
        return; // cleared — cf_clearance should now be active in the browser context
      }

      // Check for interactive challenge escalation via frames and DOM markers
      const frames = this.#page.frames();
      const hasTurnstileFrame = frames.some(
        (f) => f.url().includes('challenges.cloudflare.com') || f.url().includes('turnstile')
      );
      if (hasTurnstileFrame) {
        throw new UscisClientError(
          'Cloudflare escalated to an interactive Turnstile challenge — refusing to attempt to solve it. Falling back to preserved data.',
          'INTERACTIVE_CHALLENGE'
        );
      }

      for (const selector of INTERACTIVE_MARKERS) {
        try {
          const el = await this.#page.$(selector);
          if (el) {
            throw new UscisClientError(
              'Cloudflare escalated to an interactive human-verification challenge — refusing to attempt to solve it. Falling back to preserved data.',
              'INTERACTIVE_CHALLENGE'
            );
          }
        } catch (err) {
          if (err instanceof UscisClientError) throw err;
        }
      }

      await this.#page.waitForTimeout(1000);
    }

    throw new UscisClientError(
      'Cloudflare Managed Challenge did not resolve within timeout.',
      'WAF_CHALLENGE'
    );
  }

  async getProcessingTime(formType, slug) {
    if (!this.#page || !this.#isEstablished) {
      throw new UscisClientError('Browser session not established', 'WAF_CHALLENGE');
    }

    const url = `https://egov.uscis.gov/processing-times/api/processingtime/${formType}/${slug}`;
    const result = await this.#page.evaluate(async (u) => {
      try {
        const res = await fetch(u, {
          headers: {
            Accept: 'application/json, text/plain, */*',
          },
        });
        const text = await res.text();
        return { status: res.status, text };
      } catch (err) {
        return { status: 0, text: err.message };
      }
    }, url);

    if (result.status !== 200 || !result.text || result.text.trim().startsWith('<!DOCTYPE') || result.text.trim().startsWith('<html')) {
      throw new UscisClientError(
        `Non-JSON or non-200 response for ${formType}/${slug} (status ${result.status})`,
        'WAF_CHALLENGE'
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new UscisClientError(
        `Failed to parse JSON for ${formType}/${slug}`,
        'SCHEMA_CANARY'
      );
    }

    if (!parsed?.data?.processing_time?.length) {
      throw new UscisClientError(
        `Schema canary failed for ${formType}/${slug}`,
        'SCHEMA_CANARY'
      );
    }

    return parsed;
  }

  async close() {
    this.#isEstablished = false;
    try {
      await this.#page?.close();
    } catch {}
    try {
      await this.#browser?.close();
    } catch {}
    this.#page = null;
    this.#browser = null;
  }
}
