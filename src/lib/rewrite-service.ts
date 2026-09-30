import { ProviderError } from './provider-error';
import { AIProvider, Analysis, Tone } from './types';
import { allProductFacts, DocumentationGenerator, LocalAIProvider } from './generator';
import { markdownSegments } from './markdown-sections';
import { QualityIssue, validateCandidate } from './readme-quality';
import { redact } from './safety';

export function validateRewrite(text: string, original: string, a: Analysis): QualityIssue[] {
  const before = markdownSegments(original),
    after = markdownSegments(text);
  const protectedText = (segments: ReturnType<typeof markdownSegments>) =>
    segments.filter((s) => s.protected).map((s) => s.text);
  if (JSON.stringify(protectedText(before)) !== JSON.stringify(protectedText(after)))
    return [
      {
        rule: 'changed-instruction',
        section: 'Selection',
        detail: 'Preserve code, identifiers, links, headings and tables exactly.',
      },
    ];
  if (!text.trim() || text.length > 50000)
    return [
      {
        rule: 'invalid-selection',
        section: 'Selection',
        detail: 'Return a nonempty selected passage under 50,000 characters.',
      },
    ];
  const prose = (segments: ReturnType<typeof markdownSegments>) =>
    segments.map((s) => (s.protected ? '\n' : s.text)).join('');
  // Reuse the generation gate, keeping the surrounding product introduction fixed.
  const baseline = new DocumentationGenerator().draft(a, 'Professional', [], []);
  baseline.sections = [
    {
      id: 'Features',
      title: 'Selection',
      body: prose(before),
      claimIds: allProductFacts(a).map((f) => f.id),
    },
  ];
  const candidate = structuredClone(baseline);
  candidate.sections[0].body = prose(after);
  if (!candidate.sections[0].body.trim() && !baseline.sections[0].body.trim()) return [];
  return validateCandidate(candidate, baseline, a);
}

/** Invalid optional copy never replaces the user's selected text. */
export async function rewriteSelection(
  text: string,
  instruction: string,
  a: Analysis,
  tone: Tone = 'Personality',
  provider?: AIProvider,
) {
  const original = redact(text);
  let issues: QualityIssue[] = [];
  if (provider) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const candidate = await provider.rewrite(original, instruction, a, { tone, issues });
        issues = validateRewrite(candidate, original, a);
        if (!issues.length && candidate === redact(candidate))
          return { text: candidate, provider: 'http' as const };
        if (candidate !== redact(candidate))
          issues.push({
            rule: 'secret',
            section: 'Selection',
            detail: 'Never return credentials.',
          });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        break;
      }
    }
  }
  const local = new LocalAIProvider();
  const parts = await Promise.all(
    markdownSegments(original).map(async (segment) => {
      if (segment.protected || !segment.text.trim()) return segment.text;
      const leading = segment.text.match(/^\s*/)?.[0] || '';
      const trailing = segment.text.match(/\s*$/)?.[0] || '';
      return leading + (await local.rewrite(segment.text.trim(), instruction, a)) + trailing;
    }),
  );
  const candidate = parts.join('');
  const valid = !validateRewrite(candidate, original, a).length;
  const result = valid ? candidate : original;
  return {
    text: result,
    provider:
      result === original
        ? ('unchanged' as const)
        : provider
          ? ('local-fallback' as const)
          : ('local' as const),
  };
}
