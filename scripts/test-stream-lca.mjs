import fs from 'fs';

function unescapeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function parseSharedStrings(ssPath) {
  const ssContent = fs.readFileSync(ssPath, 'utf8');
  const strings = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRegex.exec(ssContent)) !== null) {
    const si = match[1];
    const tMatches = si.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g);
    if (tMatches) {
      const text = tMatches.map(t => {
        const inner = t.replace(/^<t(?:\s+[^>]*)?>/, '').replace(/<\/t>$/, '');
        return unescapeXml(inner);
      }).join('');
      strings.push(text);
    } else {
      strings.push('');
    }
  }
  return strings;
}

async function inspectHeaders() {
  const strings = await parseSharedStrings('./tmp/lca_extracted/xl/sharedStrings.xml');

  const readStream = fs.createReadStream('./tmp/lca_extracted/xl/worksheets/sheet1.xml', {
    encoding: 'utf8',
    highWaterMark: 64 * 1024
  });

  let buffer = '';
  for await (const chunk of readStream) {
    buffer += chunk;
    const rowStart = buffer.indexOf('<row ');
    const rowEnd = buffer.indexOf('</row>', rowStart);
    if (rowEnd !== -1) {
      const rowXml = buffer.substring(rowStart, rowEnd + 6);
      const cellMatches = rowXml.match(/<c\s+r="([A-Z]+)\d+"(?:[^>]*\st="([a-z]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g);
      const cells = {};
      for (const c of cellMatches) {
        const colMatch = c.match(/r="([A-Z]+)\d+"/);
        const typeMatch = c.match(/t="([a-z]+)"/);
        const valMatch = c.match(/<v>([\s\S]*?)<\/v>/);
        if (!colMatch) continue;
        const col = colMatch[1];
        const type = typeMatch ? typeMatch[1] : null;
        let val = valMatch ? valMatch[1] : '';
        if (type === 's') {
          val = strings[parseInt(val, 10)] || '';
        } else if (val) {
          val = unescapeXml(val);
        }
        cells[col] = val;
      }
      console.log('Total Columns:', Object.keys(cells).length);
      console.log('Columns Mapping:', JSON.stringify(cells, null, 2));
      break;
    }
  }
}

inspectHeaders().catch(err => console.error(err));
