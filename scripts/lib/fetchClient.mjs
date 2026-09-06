import fs from 'fs';

// Load .env if present and environment variables are not yet loaded
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {}
} else if (fs.existsSync('.env')) {
  try {
    const envContent = fs.readFileSync('.env', 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] || '').trim().replace(/^["'](.*)["']$/, '$1');
      }
    }
  } catch {}
}

/**
 * Universal Scraper & Proxy Client for Government Datasets
 * Supports automated cascading fallback:
 * 1. ZenRows (ZENROWS_API_KEY) with Stealth/Residential bypass
 * 2. ScrapingBee (SCRAPINGBEE_API_KEY) with Stealth/Residential bypass
 * 3. ScraperAPI (SCRAPERAPI_KEY)
 * 4. Direct Browser Impersonation (Default fallback)
 */

export function classifyFetchError(status, message, bodySample = '') {
  if (status === 401 || message?.includes('401')) {
    return 'AUTH_OR_QUOTA_EXHAUSTED (Provider rejected authentication or plan quota exceeded)';
  }
  if (status === 403 || message?.includes('403')) {
    return 'WAF_BOT_PROTECTION_BLOCKED (Akamai Bot Manager / Cloudflare WAF block)';
  }
  if (status === 408 || message?.includes('timeout') || message?.includes('AbortError')) {
    return 'TIMEOUT_LATENCY_EXCEEDED (Upstream challenge or gateway timeout)';
  }
  if (bodySample && (bodySample.includes('<html') || bodySample.includes('Turnstile') || bodySample.includes('challenge-platform') || bodySample.includes('Attention Required'))) {
    return 'CHALLENGE_PAGE_RETURNED_AS_200 (WAF returned captcha/challenge HTML instead of machine payload)';
  }
  return `UPSTREAM_ERROR (${message || 'Unknown network error'})`;
}

export async function fetchWithBypass(targetUrl, options = {}) {
  const {
    isJson = false,
    renderJs = true,
    headers = {},
    timeout = 90000,
    validateBody = null,
    detailedTelemetry = false
  } = options;

  const zenrowsKey = process.env.ZENROWS_API_KEY || process.env.SCRAPER_API_KEY;
  const scrapingbeeKey = process.env.SCRAPINGBEE_API_KEY;
  const scraperApiKey = process.env.SCRAPERAPI_KEY;

  // Proxy headers
  const proxyHeaders = {
    'Accept': isJson ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  const directHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': proxyHeaders.Accept,
    'Accept-Language': 'en-US,en;q=0.9',
    ...headers
  };

  // Build candidate provider list based on available keys
  const providers = [];

  if (zenrowsKey) {
    const encoded = encodeURIComponent(targetUrl);
    let url = `https://api.zenrows.com/v1/?apikey=${zenrowsKey}&url=${encoded}&js_render=${renderJs}&premium_proxy=true&wait=3000`;
    if (isJson) url += '&json_response=true';
    providers.push({ name: 'ZenRows', url, headers: proxyHeaders });
  }

  if (scrapingbeeKey) {
    const encoded = encodeURIComponent(targetUrl);
    const url = `https://app.scrapingbee.com/api/v1/?api_key=${scrapingbeeKey}&url=${encoded}&render_js=${renderJs}&stealth_proxy=true&premium_proxy=true&wait=5000`;
    providers.push({ name: 'ScrapingBee', url, headers: proxyHeaders });
  }

  if (scraperApiKey) {
    const encoded = encodeURIComponent(targetUrl);
    const url = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encoded}&render=${renderJs}&premium=true&country_code=us&connection_timeout=70`;
    providers.push({ name: 'ScraperAPI', url, headers: proxyHeaders });
  }

  // Direct fetch fallback
  providers.push({ name: 'DirectFetch', url: targetUrl, headers: directHeaders });

  let lastError = null;

  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();

    try {
      console.log(`[fetchClient] Attempting via ${provider.name} -> Target: ${targetUrl.slice(0, 70)}...`);
      const res = await fetch(provider.url, {
        headers: provider.headers,
        signal: controller.signal
      });
      clearTimeout(timer);
      const elapsedMs = Date.now() - startTime;
      const contentType = res.headers.get('content-type') || 'unknown';

      if (!res.ok) {
        const errorClass = classifyFetchError(res.status, res.statusText);
        throw new Error(`HTTP ${res.status} (${res.statusText}) - ${errorClass}`);
      }

      let payload = isJson ? await res.json() : await res.text();
      const preview = typeof payload === 'string' ? payload.slice(0, 150).replace(/\s+/g, ' ') : JSON.stringify(payload).slice(0, 150);

      // Body validation to reject HTTP 200 captcha / challenges
      if (typeof payload === 'string') {
        const lower = payload.toLowerCase();
        if (lower.includes('access denied') || lower.includes('attention required! | cloudflare') || lower.includes('challenge-platform') || lower.includes('cf-turnstile')) {
          const errorClass = classifyFetchError(200, 'Challenge page', payload);
          throw new Error(`Invalid response body: WAF challenge page returned with HTTP 200 - ${errorClass}`);
        }
      }

      if (validateBody && typeof validateBody === 'function') {
        const validationResult = validateBody(payload, res.status, contentType);
        if (validationResult === false || (validationResult && validationResult.valid === false)) {
          const reason = validationResult?.error || 'Custom validation check failed';
          throw new Error(`Body validation failed: ${reason}`);
        }
      }

      console.log(`[fetchClient] ${provider.name} succeeded HTTP 200 in ${elapsedMs}ms (${contentType}, size: ${typeof payload === 'string' ? payload.length : 'JSON'} bytes)`);
      if (detailedTelemetry) {
        console.log(`  [diagnosticPreview] "${preview}"`);
      }

      return payload;
    } catch (err) {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startTime;
      console.warn(`  [fetchClient] ${provider.name} failed after ${elapsedMs}ms: ${err.message}`);
      lastError = err;
      if (providers.indexOf(provider) < providers.length - 1) {
        continue;
      }
    }
  }

  throw lastError || new Error(`All fetch attempts failed for ${targetUrl}`);
}

