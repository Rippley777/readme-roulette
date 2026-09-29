import { z } from 'zod';
import { Analysis, Profile, ReadmeDraft, Tone } from './types';
import { DocumentationGenerator, inspectDraft, renderDraft } from './generator';
import { generationPrompt } from './generation-prompt';
import { reviewDraft, validateCandidate } from './readme-quality';
import { splitMarkdown } from './markdown-sections';
export type DraftWriter = (request: ReturnType<typeof generationPrompt>) => Promise<unknown>;
const schema = z.object({
  title: z.string().max(150),
  tagline: z.string().max(300),
  introduction: z.string().max(3000),
  aside: z.string().max(500),
  openingClaimIds: z.array(z.string()).max(40),
  sections: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().max(100),
        body: z.string().max(30000),
        claimIds: z.array(z.string()).max(100),
      }),
    )
    .max(25),
  badges: z.string().max(5000),
  screenshotComment: z.string().max(3000),
});
/** Legacy Markdown responses cross the same factual and editorial gate. */
function legacyDraft(text: string, baseline: ReadmeDraft): ReadmeDraft {
  const blocks = splitMarkdown(text.replace(/<!--[\s\S]*?-->/g, ''));
  const opening = blocks[0].body;
  const title = opening.match(/^# (.+)$/m)?.[1] || '';
  const tagline = opening.match(/^> (.+)$/m)?.[1] || '';
  const paragraphs = opening
    .replace(/^# .+$/m, '')
    .replace(/^> .+$/m, '')
    .replace(baseline.badges, '')
    .trim()
    .split(/\n\n+/);
  return {
    ...baseline,
    title,
    tagline,
    introduction: paragraphs[0] || '',
    aside: paragraphs.slice(1).join('\n\n'),
    sections: blocks.slice(1).map((block) => {
      const original = baseline.sections.find((s) => s.title === block.title);
      return {
        id: original?.id || `unknown:${block.title}`,
        title: block.title,
        body: block.body,
        claimIds: original?.claimIds || [],
      };
    }),
  };
}
export async function generateReadme(
  a: Analysis,
  options: { profile?: Profile; tone?: Tone; sections?: string[]; badges?: string[] },
  writer?: DraftWriter,
) {
  const profile = options.profile || 'Professional',
    tone = options.tone || 'Personality';
  const baseline = new DocumentationGenerator().draft(
    a,
    profile,
    options.sections,
    options.badges,
    tone,
  );
  let draft = baseline;
  let provider = 'local';
  let issues: ReturnType<typeof validateCandidate> = [];
  if (writer) {
    provider = 'local-fallback';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await writer(generationPrompt(a, profile, tone, baseline, issues));
        const data = response as { draft?: unknown; text?: unknown };
        const parsed = schema.safeParse(
          data?.draft ||
            (typeof data?.text === 'string' && data.text.length < 300000
              ? legacyDraft(data.text, baseline)
              : undefined),
        );
        if (!parsed.success) {
          issues = [
            {
              rule: 'invalid-structure',
              section: 'Draft',
              detail: 'Return a draft object matching the supplied baseline schema.',
            },
          ];
          continue;
        }
        const candidate: ReadmeDraft = {
          ...parsed.data,
          badges: baseline.badges,
          screenshotComment: baseline.screenshotComment,
        };
        issues = validateCandidate(candidate, baseline, a);
        if (!issues.length) {
          draft = candidate;
          provider = 'http';
          break;
        }
      } catch {
        issues = [
          {
            rule: 'provider-unavailable',
            section: 'Draft',
            detail: 'The optional provider did not return usable documentation.',
          },
        ];
        break;
      }
    }
  }
  const quality = reviewDraft(draft, a);
  return {
    markdown: renderDraft(quality.draft),
    sections: quality.draft.sections.map(({ id, title }) => ({ id, title })),
    inspection: inspectDraft(quality.draft, a),
    provider,
    tone,
    quality: { ...quality, providerIssues: issues },
  };
}
