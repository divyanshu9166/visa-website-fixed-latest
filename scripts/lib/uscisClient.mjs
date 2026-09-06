import { Session } from 'impers';

const USCIS_BASE_URL = 'https://egov.uscis.gov/processing-times';
const USCIS_LANDING_URL = 'https://egov.uscis.gov/processing-times/';

const DEFAULT_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
};

/**
 * Error classifications for granular diagnosis and health reporting
 */
export class UscisClientError extends Error {
  constructor(message, { category = 'UNKNOWN', status = null, bodyPreview = null } = {}) {
    super(message);
    this.name = 'UscisClientError';
    this.category = category; // 'WAF_CHALLENGE' | 'RATE_LIMIT' | 'HTTP_ERROR' | 'SCHEMA_CANARY' | 'NETWORK_ERROR'
    this.status = status;
    this.bodyPreview = bodyPreview;
  }
}

/**
 * Validates that a response is not an HTML challenge page or error page disguised as 200
 */
function validateRawResponse(status, contentType, bodyText) {
  if (status === 403) {
    if (bodyText && (bodyText.includes('Attention Required!') || bodyText.includes('Just a moment...') || bodyText.includes('cf-mitigated') || bodyText.includes('cloudflare'))) {
      throw new UscisClientError('Cloudflare WAF JS/CAPTCHA Challenge received (HTTP 403)', {
        category: 'WAF_CHALLENGE',
        status: 403,
        bodyPreview: bodyText.slice(0, 300),
      });
    }
    throw new UscisClientError(`HTTP 403 Forbidden`, {
      category: 'HTTP_ERROR',
      status: 403,
      bodyPreview: bodyText?.slice(0, 300),
    });
  }

  if (status === 429) {
    throw new UscisClientError('HTTP 429 Rate Limit Exceeded', {
      category: 'RATE_LIMIT',
      status: 429,
    });
  }

  if (status >= 500) {
    throw new UscisClientError(`HTTP ${status} Upstream Server Error`, {
      category: 'HTTP_ERROR',
      status,
      bodyPreview: bodyText?.slice(0, 300),
    });
  }

  if (status < 200 || status >= 300) {
    throw new UscisClientError(`HTTP ${status} Unexpected Status`, {
      category: 'HTTP_ERROR',
      status,
      bodyPreview: bodyText?.slice(0, 300),
    });
  }

  // Check for HTML returned instead of JSON
  if (bodyText && (bodyText.trim().startsWith('<!DOCTYPE html>') || bodyText.trim().startsWith('<html'))) {
    if (bodyText.includes('Attention Required!') || bodyText.includes('Just a moment...')) {
      throw new UscisClientError('Cloudflare WAF Challenge Page returned with 200 OK', {
        category: 'WAF_CHALLENGE',
        status,
        bodyPreview: bodyText.slice(0, 300),
      });
    }
    throw new UscisClientError('Received HTML page instead of JSON API response', {
      category: 'SCHEMA_CANARY',
      status,
      bodyPreview: bodyText.slice(0, 300),
    });
  }
}

/**
 * Dedicated USCIS HTTP Client using curl-impersonate (`impers`)
 */
export class UscisImpersonatedClient {
  constructor({ target = 'chrome124', timeout = 15000 } = {}) {
    this.target = target;
    this.timeout = timeout;
    this.session = null;
    this.isEstablished = false;
  }

  initSession() {
    if (this.session) {
      try {
        this.session.close();
      } catch {}
    }
    this.session = new Session({
      impersonate: this.target,
      timeout: this.timeout,
    });
    this.isEstablished = false;
  }

  /**
   * Phase 1: Landing Page Handshake (establishes browser session & cookies)
   */
  async establishSession(maxRetries = 3) {
    if (!this.session) {
      this.initSession();
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.session.get(USCIS_LANDING_URL, {
          headers: {
            ...DEFAULT_BROWSER_HEADERS,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
        });

        const status = res.status;
        const text = typeof res.text === 'function' ? await res.text() : res.text;
        const contentType = res.headers?.get ? res.headers.get('content-type') : '';

        // Check if landing page was challenged
        validateRawResponse(status, contentType, text);

        this.isEstablished = true;
        return { success: true, status };
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Phase 2: Form Offices API Endpoint
   */
  async getFormOffices(formType, maxRetries = 3) {
    if (!this.session || !this.isEstablished) {
      await this.establishSession();
    }

    const url = `${USCIS_BASE_URL}/api/formoffices/${formType}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.session.get(url, {
          headers: {
            ...DEFAULT_BROWSER_HEADERS,
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://egov.uscis.gov',
            'Referer': USCIS_LANDING_URL,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
          },
        });

        const status = res.status;
        const text = typeof res.text === 'function' ? await res.text() : res.text;
        const contentType = res.headers?.get ? res.headers.get('content-type') : '';

        validateRawResponse(status, contentType, text);

        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new UscisClientError('Failed to parse JSON response from formoffices API', {
            category: 'SCHEMA_CANARY',
            status,
            bodyPreview: text?.slice(0, 300),
          });
        }

        // Canary check for form offices
        const offices = json?.data?.form_offices || json?.form_offices || json?.data;
        if (!offices) {
          throw new UscisClientError('Canary failed: missing form_offices in response', {
            category: 'SCHEMA_CANARY',
            status,
            bodyPreview: text?.slice(0, 300),
          });
        }

        return json;
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Phase 3: Processing Time API Endpoint
   */
  async getProcessingTime(formType, centerSlug, maxRetries = 3) {
    if (!this.session || !this.isEstablished) {
      await this.establishSession();
    }

    const url = `${USCIS_BASE_URL}/api/processingtime/${formType}/${centerSlug}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.session.get(url, {
          headers: {
            ...DEFAULT_BROWSER_HEADERS,
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://egov.uscis.gov',
            'Referer': USCIS_LANDING_URL,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
          },
        });

        const status = res.status;
        const text = typeof res.text === 'function' ? await res.text() : res.text;
        const contentType = res.headers?.get ? res.headers.get('content-type') : '';

        validateRawResponse(status, contentType, text);

        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new UscisClientError('Failed to parse JSON response from processingtime API', {
            category: 'SCHEMA_CANARY',
            status,
            bodyPreview: text?.slice(0, 300),
          });
        }

        // Schema Canary Validation
        const ptData = json?.data?.processing_time;
        if (!ptData || !Array.isArray(ptData) || ptData.length === 0) {
          throw new UscisClientError('Canary failed: malformed or missing processing_time array in payload', {
            category: 'SCHEMA_CANARY',
            status,
            bodyPreview: text?.slice(0, 300),
          });
        }

        const subtypes = ptData[0]?.subtypes || [];
        if (!Array.isArray(subtypes) || subtypes.length === 0) {
          throw new UscisClientError('Canary failed: empty subtypes in processing_time payload', {
            category: 'SCHEMA_CANARY',
            status,
            bodyPreview: text?.slice(0, 300),
          });
        }

        return json;
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  close() {
    if (this.session) {
      try {
        this.session.close();
      } catch {}
      this.session = null;
      this.isEstablished = false;
    }
  }
}
