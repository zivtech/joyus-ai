/**
 * Extract accessibility failures from common CI check output.
 */

export type A11yTool = 'axe-core' | 'lighthouse' | 'pa11y' | 'unknown-a11y';

export interface A11yFindingInput {
  source?: string;
  path?: string;
  url?: string;
  message?: string;
  title?: string;
  rawDetails?: string;
  annotationLevel?: string;
  startLine?: number;
  endLine?: number;
}

export interface A11yFailure {
  source: A11yTool;
  ruleId?: string;
  severity?: string;
  path?: string;
  url?: string;
  selector?: string;
  message: string;
  helpUrl?: string;
  rawExcerpt: string;
  startLine?: number;
  endLine?: number;
}

const A11Y_TERMS = /\b(a11y|accessibility|aria|wcag|axe(?:-core)?|lighthouse|pa11y|contrast|screen reader|keyboard|accessible name)\b/i;
const HELP_URL_TERMS = /(dequeuniversity\.com|web\.dev|w3\.org\/WAI|pa11y\.org)/i;
const MAX_EXCERPT_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 240;

/**
 * Parse one or more text blocks into structured accessibility failures.
 */
export function extractA11yFailures(inputs: A11yFindingInput[]): A11yFailure[] {
  return inputs
    .map(parseA11yFailure)
    .filter((failure): failure is A11yFailure => failure !== null);
}

function parseA11yFailure(input: A11yFindingInput): A11yFailure | null {
  const rawParts = [input.source, input.title, input.message, input.rawDetails].filter(Boolean);
  const raw = rawParts.join('\n').trim();

  if (!raw || !A11Y_TERMS.test(raw)) {
    return null;
  }

  const source = detectTool(raw);
  if (!source) {
    return null;
  }

  const urls = extractUrls(raw);
  const helpUrl = urls.find((url) => HELP_URL_TERMS.test(url));
  const contentUrl = input.url ?? urls.find((url) => url !== helpUrl);
  const ruleId = extractRuleId(raw, source);
  const severity = extractSeverity(raw, input.annotationLevel);
  const selector = extractSelector(raw);

  return {
    source,
    ...(ruleId ? { ruleId } : {}),
    ...(severity ? { severity } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(contentUrl ? { url: contentUrl } : {}),
    ...(selector ? { selector } : {}),
    message: buildMessage(input.title, input.message, input.rawDetails),
    ...(helpUrl ? { helpUrl } : {}),
    rawExcerpt: boundText(raw, MAX_EXCERPT_LENGTH),
    ...(input.startLine !== undefined ? { startLine: input.startLine } : {}),
    ...(input.endLine !== undefined ? { endLine: input.endLine } : {})
  };
}

function detectTool(raw: string): A11yTool | null {
  if (/\baxe(?:-core)?\b/i.test(raw) || /dequeuniversity\.com\/rules\/axe/i.test(raw)) {
    return 'axe-core';
  }

  if (/\blighthouse\b/i.test(raw) || /web\.dev\/measure/i.test(raw)) {
    return 'lighthouse';
  }

  if (/\bpa11y\b/i.test(raw) || /\bWCAG2[AAA]?\./i.test(raw)) {
    return 'pa11y';
  }

  return A11Y_TERMS.test(raw) ? 'unknown-a11y' : null;
}

function extractRuleId(raw: string, source: A11yTool): string | undefined {
  const helpRule = raw.match(/dequeuniversity\.com\/rules\/axe\/[^/\s]+\/([a-z0-9-]+)/i);
  if (helpRule?.[1]) {
    return cleanToken(helpRule[1]);
  }

  const pa11yCode = raw.match(/\b(WCAG2[AAA]?\.[A-Za-z0-9_.-]+)/i);
  if (pa11yCode?.[1]) {
    return cleanToken(pa11yCode[1]);
  }

  const labeledRule = raw.match(/\b(?:rule|rule id|id|audit|violation|code)[:=]\s*([A-Za-z0-9_.:-]+)/i);
  if (labeledRule?.[1]) {
    return cleanToken(labeledRule[1]);
  }

  const commonRule = raw.match(/\b(aria-[a-z0-9-]+|color-contrast|image-alt|label|link-name|button-name|document-title|html-has-lang|html-lang-valid|heading-order|landmark-one-main)\b/i);
  if (commonRule?.[1]) {
    return cleanToken(commonRule[1]);
  }

  if (source === 'lighthouse') {
    const bracketedAudit = raw.match(/\[([a-z0-9-]+)\]/i);
    if (bracketedAudit?.[1]) {
      return cleanToken(bracketedAudit[1]);
    }
  }

  return undefined;
}

function extractSeverity(raw: string, annotationLevel?: string): string | undefined {
  const impact = raw.match(/\b(?:impact|severity|level)[:=]\s*(critical|serious|moderate|minor|error|warning|notice|failure)\b/i);
  if (impact?.[1]) {
    return impact[1].toLowerCase();
  }

  const inlineSeverity = raw.match(/\b(critical|serious|moderate|minor|error|warning|notice|failure)\b/i);
  if (inlineSeverity?.[1]) {
    return inlineSeverity[1].toLowerCase();
  }

  return annotationLevel?.toLowerCase();
}

function extractSelector(raw: string): string | undefined {
  const selector = raw.match(/\b(?:selector|target|node)[:=]\s*(\[[^\n]+\]|`[^`]+`|"[^"]+"|'[^']+'|[^\n;,]+)/i);
  if (!selector?.[1]) {
    return undefined;
  }

  return selector[1]
    .replace(/^[`'"]+/, '')
    .replace(/[`'"]+$/, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
}

function extractUrls(raw: string): string[] {
  const matches = raw.match(/https?:\/\/[^\s)]+/g) ?? [];
  return matches.map((url) => url.replace(/[.,;]+$/, ''));
}

function buildMessage(title?: string, message?: string, rawDetails?: string): string {
  const text = [title, message, rawDetails]
    .filter(Boolean)
    .join(' — ')
    .replace(/\s+/g, ' ')
    .trim();

  return boundText(text, MAX_MESSAGE_LENGTH);
}

function cleanToken(token: string): string {
  return token.replace(/[.,;:)]+$/, '').trim();
}

function boundText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}
