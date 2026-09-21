/**
 * Models return JSON wrapped in prose, fences, or with trailing commas.
 * This pulls the first balanced JSON object out of whatever came back.
 */
export function extractJsonObject(raw: string): unknown {
  const text = raw.trim();

  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed !== undefined) return parsed;
  }

  const start = text.indexOf('{');
  if (start === -1) throw new Error('Model response contained no JSON object.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed = tryParse(text.slice(start, i + 1));
        if (parsed !== undefined) return parsed;
        break;
      }
    }
  }

  throw new Error('Model response could not be parsed as JSON.');
}

function tryParse(candidate: string): unknown {
  const cleaned = candidate.trim().replace(/,(\s*[}\]])/g, '$1');
  if (!cleaned.startsWith('{')) return undefined;
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}
