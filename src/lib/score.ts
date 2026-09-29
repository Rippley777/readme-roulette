import { Repository, ScoreCriterion } from './types';
export function scoreRepository(
  repo: Repository,
  markdown: string,
): { total: number; criteria: ScoreCriterion[] } {
  const visible = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const has = (pattern: RegExp) => pattern.test(visible);
  const rules: [string, number, boolean, string][] = [
    [
      'README completeness',
      20,
      visible.trim().length > 400 && has(/^##? .+/m),
      'Write an overview and document the core features.',
    ],
    [
      'Screenshots',
      12,
      has(/!\[[^\]]*\]\((?!https:\/\/img\.shields\.io)[^)]+\)/),
      'Add a screenshot of the project in action.',
    ],
    [
      'Architecture',
      10,
      has(/^## (?:Architecture|How it works|Under the hood)/im) &&
        has(/```mermaid|(?:architecture|how it works|under the hood)[^\n]*\n\n.{60}/is),
      'Explain how the main components fit together.',
    ],
    [
      'Setup instructions',
      14,
      has(/^## (?:Getting Started|Quick start|Installation)/im) && has(/```(?:bash|sh)\n[^`]+/),
      'Add runnable setup instructions.',
    ],
    ['License', 8, Boolean(repo.license), 'Add a license to your repository.'],
    [
      'Testing documentation',
      8,
      has(/^## Testing\n\n[^#]{20}/m),
      'Document the actual test command.',
    ],
    [
      'Repository description',
      8,
      Boolean(repo.description),
      'Add a concise repository description.',
    ],
    ['Topics', 5, repo.topics.length > 0, 'Add searchable topics on GitHub.'],
    [
      'Release information',
      5,
      has(/^## (?:Releases?|Changelog)/im),
      'Document releases or link to a changelog.',
    ],
    ['Contributing', 5, has(/^## Contribut/m), 'Explain how someone can contribute.'],
    ['Project structure', 5, has(/^## Project Structure/m), 'Include a short directory tree.'],
  ];
  const criteria = rules.map(([label, points, passed, recommendation]) => ({
    label,
    points,
    earned: passed ? points : 0,
    recommendation,
  }));
  return { total: criteria.reduce((n, c) => n + c.earned, 0), criteria };
}
