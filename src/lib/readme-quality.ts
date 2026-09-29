import { Analysis, ReadmeDraft } from './types';
import { redact } from './safety';

export const bannedLanguage =
  /\b(?:a powerful tool for|this project aims to|built with modern technologies|this documentation is based on|streamline(?:s|d)? your workflow|seamlessly|robust|cutting[- ]edge|whether you(?:'|’)re a beginner|includes? .{0,45} in package\.json)\b/i;
const inventoryFeature =
  /\b(?:includes? (?:a |an )?(?:vitest|jest|docker(?:file)?|react|vite|package\.json|container configuration)|uses? (?:react|typescript|docker|vitest)|typescript support|declared dependency|project tooling)\b/i;
const emptyCopy =
  /^(?:unknown[.!]?|(?:no|not) .*(?:detected|verified|provided|found)[.!]?|.*(?:coming soon|could not be (?:determined|verified)|has not been verified|add verified behavior here|configuration files?\.)$)/i;
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[`*_>#]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const plain = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '');
export type QualityIssue = { rule: string; section: string; detail: string };
function pruneEmptyHeadings(body: string, section: string, issues: QualityIssue[]) {
  const lines = body.split('\n');
  let fenced = false;
  const headings: { index: number; level: number }[] = [];
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^(#{1,6}) /);
    if (heading) headings.push({ index, level: heading[1].length });
  });
  const remove = new Set<number>();
  for (const heading of headings) {
    const end =
      headings.find((next) => next.index > heading.index && next.level <= heading.level)?.index ??
      lines.length;
    const content = lines
      .slice(heading.index + 1, end)
      .join('\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^#{1,6} .*$/gm, '')
      .trim();
    if (!content) {
      remove.add(heading.index);
      issues.push({ rule: 'empty-heading', section, detail: lines[heading.index] });
    }
  }
  return lines
    .filter((_, index) => !remove.has(index))
    .join('\n')
    .trim();
}
export function reviewDraft(input: ReadmeDraft, a: Analysis) {
  const draft: ReadmeDraft = structuredClone(input);
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  const prose = (text: string, section: string) => {
    let inCode = false;
    return redact(text)
      .split('\n')
      .map((line) => {
        if (/^\s*```/.test(line)) {
          inCode = !inCode;
          return line;
        }
        if (inCode || /^\s*(?:\||!\[|<!--|-->|\d+\.)/.test(line)) return line;
        if (
          bannedLanguage.test(line) ||
          emptyCopy.test(line.trim()) ||
          (section === 'Features' && inventoryFeature.test(line))
        ) {
          issues.push({ rule: 'filler', section, detail: line });
          return '';
        }
        // Headings cannot survive without content; full sentences cannot recur across sections.
        if (/^#{1,6} /.test(line)) return line;
        const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z])/);
        return sentences
          .filter((sentence) => {
            const key = normalize(sentence);
            if (key.length < 35) return true;
            if (seen.has(key)) {
              issues.push({ rule: 'repetition', section, detail: sentence });
              return false;
            }
            seen.add(key);
            return true;
          })
          .join(' ');
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  draft.tagline = prose(draft.tagline, 'Opening');
  draft.introduction = prose(draft.introduction, 'Opening');
  draft.aside = prose(draft.aside, 'Opening');
  draft.sections = draft.sections
    .map((section) => ({
      ...section,
      body: pruneEmptyHeadings(prose(section.body, section.id), section.id, issues),
    }))
    .filter((section) => {
      const useful = plain(section.body)
        .replace(/^#{1,6} .*$/gm, '')
        .trim();
      if (!useful && !/```[^`]+```|!\[[^\]]*\]\([^)]+\)/.test(section.body)) {
        issues.push({
          rule: 'empty-section',
          section: section.id,
          detail: 'Section has no useful content.',
        });
        return false;
      }
      return true;
    });
  const text = [draft.introduction, ...draft.sections.map((s) => plain(s.body))].join(' ');
  const sentences = text.split(/[.!?]+\s+/).filter(Boolean);
  const words = sentences.map((s) => s.trim().split(/\s+/).length);
  if (!draft.introduction.trim())
    issues.push({
      rule: 'missing-product-introduction',
      section: 'Opening',
      detail: 'Insufficient product evidence for an introduction.',
    });
  if (
    /\bI (?:built|wanted|needed|got tired|spent|was)\b/.test(
      draft.introduction + ' ' + draft.aside,
    ) &&
    !a.product?.motivation
  )
    issues.push({
      rule: 'invented-personal-story',
      section: 'Opening',
      detail: 'No personal motivation is present in the source.',
    });
  return {
    draft,
    issues,
    readability: {
      averageSentenceWords: words.length
        ? Math.round(words.reduce((n, w) => n + w, 0) / words.length)
        : 0,
      longSentences: words.filter((w) => w > 35).length,
      asides: draft.aside ? 1 : 0,
    },
  };
}
/** Conservative boundary for optional model copy. Technical sections are immutable. */
export function validateCandidate(
  candidate: ReadmeDraft,
  baseline: ReadmeDraft,
  a: Analysis,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (rule: string, detail: string, section = 'Draft') =>
    issues.push({ rule, detail, section });
  if (candidate.title !== baseline.title)
    add('changed-fact', 'Project name must remain unchanged.');
  const allowed = new Map(baseline.sections.map((s) => [s.id, s]));
  if (
    candidate.sections.length !== baseline.sections.length ||
    candidate.sections.some((s, i) => s.id !== baseline.sections[i]?.id)
  )
    add('section-plan', 'Preserve the requested section selection and order.');
  const factualSections = new Set([
    'Getting Started',
    'Tech Stack',
    'Environment Variables',
    'Development',
    'Testing',
    'API',
    'Screenshots',
    'Usage',
    'License',
    'Architecture',
    'Roadmap',
    'Known limitations',
    'Keyboard shortcuts',
    'Contributing',
    'Why',
  ]);
  for (const section of candidate.sections) {
    const original = allowed.get(section.id);
    if (!original) {
      add('unknown-section', section.id);
      continue;
    }
    if (section.title !== original.title)
      add('changed-heading', 'Keep the selected heading.', section.id);
    if (factualSections.has(section.id) && section.body !== original.body)
      add(
        'changed-fact',
        'Technical instructions, motivation, and factual sections are locked.',
        section.id,
      );
    if (!section.claimIds.length && section.body !== original.body)
      add('missing-evidence', 'Changed prose must cite supporting claim IDs.', section.id);
    if (section.claimIds.some((id) => !original.claimIds.includes(id)))
      add('unknown-evidence', 'A cited claim does not support this section.', section.id);
  }
  if (
    candidate.openingClaimIds.some((id) => !baseline.openingClaimIds.includes(id)) ||
    (!candidate.openingClaimIds.length && Boolean(candidate.introduction))
  )
    add('unknown-evidence', 'Opening must cite its product facts.');
  const prose = [
    candidate.tagline,
    candidate.introduction,
    candidate.aside,
    ...candidate.sections.filter((s) => s.id === 'Features').map((s) => s.body),
  ].join('\n');
  const supports = [
    ...(a.product?.features.map((f) => f.action + ' ' + f.detail) || []),
    a.product?.summary?.text || '',
  ].join('\n');
  const capabilities = [
    /\brestart\w*|\brelaunch\w*/i,
    /\bkill\w*|\bterminat\w*/i,
    /\bexport\w*/i,
    /\bimport\w*/i,
    /\bsync\w*/i,
    /\bencrypt\w*/i,
    /\bauthenticat\w*|\bsign[ -]?in/i,
    /\bpay(?:ments?|wall)|\bbilling/i,
    /\b(?:AI[- ]powered|machine learning|artificial intelligence)\b/i,
    /\b(?:real[- ]time|continuously|live updates)\b/i,
    /\b(?:offline|cross[- ]platform|zero[- ]config)\b/i,
    /\b(?:Linux|Windows|macOS|PostgreSQL|MySQL|Redis|AWS|Azure|Kubernetes|Rust|React|Docker|Electron|Tauri)\b/gi,
  ];
  for (const pattern of capabilities) {
    const matches = prose.match(pattern);
    const supportedText =
      supports + ' ' + a.product?.technical.map((t) => t.name + ' ' + t.text).join(' ');
    if (pattern.global) {
      for (const match of matches || [])
        if (!new RegExp(`\\b${match}\\b`, 'i').test(supportedText))
          add('unsupported-claim', `Unsupported claim: ${match}.`);
      continue;
    }
    if (matches && !new RegExp(pattern.source, pattern.flags.replace('g', '')).test(supportedText))
      add('unsupported-claim', `Unsupported claim: ${matches[0]}.`);
  }
  const allowedNumbers = new Set(JSON.stringify(baseline).match(/\b\d+(?:\.\d+)*\b/g) || []);
  for (const n of prose.match(/\b\d+(?:\.\d+)*\b/g) || [])
    if (!allowedNumbers.has(n)) add('unsupported-number', `Unverified number: ${n}.`);
  if (/https?:\/\/|```|\b(?:npm|pnpm|yarn|cargo|pip) (?:run|install|add)|\[REDACTED\]/.test(prose))
    add(
      'unsupported-instruction',
      'Product copy cannot introduce links, secrets, or runnable commands.',
    );
  if (
    /\b(?:guarantee[sd]?|best[- ]in[- ]class|faster than|the only|100%|production[- ]ready)\b/i.test(
      prose,
    )
  )
    add('unsupported-comparison', 'Unverified quality or comparison claim.');
  if (/\bI (?:built|wanted|needed|got tired|spent|was)\b/i.test(prose) && !a.product?.motivation)
    add('invented-personal-story', 'Do not invent the author’s history.');
  const review = reviewDraft(candidate, a);
  issues.push(...review.issues);
  if (review.readability.averageSentenceWords > 35)
    add('readability', 'Use shorter, concrete sentences.');
  // A rewritten introduction must still name a supported action or the declared product purpose.
  const anchors = (supports.match(/\b[a-z]{5,}\b/gi) || []).map((w) => w.toLowerCase());
  if (anchors.length && !anchors.some((w) => candidate.introduction.toLowerCase().includes(w)))
    add(
      'missing-product-introduction',
      'The introduction does not explain a supported product action.',
    );
  return issues;
}
