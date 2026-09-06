import fs from 'fs';
import * as cheerio from 'cheerio';

function analyzeMendeley() {
  console.log('=== ANALYZING MENDELEY DATASET ===');
  const html = fs.readFileSync('./tmp/mendeley_raw.html', 'utf8');
  const $ = cheerio.load(html);

  // Extract JSON-LD
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}');
      console.log('JSON-LD Block ' + i + ':\n', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('JSON-LD parse error:', e.message);
    }
  });

  // Extract text content from main body
  console.log('Title:', $('title').text());
  console.log('Meta description:', $('meta[name="description"]').attr('content'));

  // Search for license mentions in raw HTML
  const licenseMatches = html.match(/license[^<]{0,200}/gi) || [];
  console.log('License matches in HTML:', licenseMatches.slice(0, 10));

  // Search for CC BY or similar
  const ccMatches = html.match(/CC\s*BY[^<]{0,200}/gi) || [];
  console.log('CC BY matches in HTML:', ccMatches);
}

function analyzeImmigrationTimes() {
  console.log('\n=== ANALYZING IMMIGRATIONTIMES.ORG/DATA/ ===');
  const html = fs.readFileSync('./tmp/imm_times_raw.html', 'utf8');
  const $ = cheerio.load(html);

  console.log('Title:', $('title').text());
  console.log('Meta description:', $('meta[name="description"]').attr('content'));

  // Get text content
  $('script, style, nav, footer').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  console.log('Body Text Summary (first 3000 chars):');
  console.log(text.slice(0, 3000));

  // Search for API, endpoints, license, terms, curl examples
  const fullHtml = fs.readFileSync('./tmp/imm_times_raw.html', 'utf8');
  const apiMatches = fullHtml.match(/https?:\/\/[^\s"']+(api|\/data|\/v1|\/v2)[^\s"']*/gi) || [];
  console.log('API-like URLs found in page:', Array.from(new Set(apiMatches)));

  const codeBlocks = [];
  $('pre, code').each((i, el) => {
    codeBlocks.push($(el).text().trim());
  });
  console.log('Code blocks on page:', codeBlocks.slice(0, 10));
}

analyzeMendeley();
analyzeImmigrationTimes();
