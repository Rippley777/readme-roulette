import {
  AIProvider,
  Analysis,
  DraftSection,
  GenerationInspection,
  ProductFact,
  ProductModel,
  Profile,
  ReadmeDraft,
  Tone,
} from './types';
import { reviewDraft } from './readme-quality';
export const profiles: Profile[] = [
  'Professional',
  'Open Source',
  'Portfolio',
  'Minimal',
  'Developer',
  'Chaotic Good',
];
export const tones: Tone[] = ['Professional', 'Developer', 'Personality', 'Unhinged'];
export const toneDescriptions: Record<Tone, string> = {
  Professional: 'Direct, composed documentation. The product does the talking.',
  Developer: 'The voice of a developer explaining a useful tool to another developer.',
  Personality: 'Project-specific, memorable, and lightly witty. Mostly docs, a little character.',
  Unhinged: 'Sharper jokes and playful asides. The facts still have to earn their place.',
};
export const sectionNames = [
  'Features',
  'Why',
  'Screenshots',
  'Getting Started',
  'Usage',
  'Architecture',
  'Tech Stack',
  'Environment Variables',
  'Development',
  'Testing',
  'API',
  'Keyboard shortcuts',
  'Roadmap',
  'Known limitations',
  'Contributing',
  'License',
];
export function sectionTitle(id: string, model: ProductModel, tone: Tone = 'Personality') {
  if (id === 'Features')
    return model.kind === 'CLI'
      ? 'Commands'
      : tone === 'Professional'
        ? 'Features'
        : 'What it does';
  if (id === 'Tech Stack') return tone === 'Professional' ? 'Tech stack' : 'Under the hood';
  if (id === 'Getting Started') return model.kind === 'library' ? 'Installation' : 'Quick start';
  if (id === 'Why')
    return model.motivation && /\bI (?:built|wanted|needed|was|got)\b/.test(model.motivation.text)
      ? 'Why I built this'
      : 'Why';
  if (id === 'Environment Variables') return 'Configuration';
  return id;
}
const finish = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : text.trim() + '.');
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1).replace(/[.!?]$/, '');
const list = (items: string[]) =>
  items.length < 2
    ? items[0] || ''
    : items.length === 2
      ? items.join(' and ')
      : items.slice(0, -1).join(', ') + ', and ' + items.at(-1);
export function productOf(a: Analysis): ProductModel {
  if (a.product?.version === 2) return a.product;
  // Cached pre-product analyses are reanalyzed by the API. Legacy callers get no invented behavior.
  return {
    version: 2,
    name: a.repo.name,
    kind: 'project',
    summary: a.repo.description
      ? {
          id: 'description',
          text: a.repo.description,
          sources: [{ path: 'GitHub repository description' }],
          confidence: 'documented',
        }
      : null,
    problem: null,
    audience: null,
    workflow: [],
    features: [],
    differentiators: [],
    technical: [],
    motivation: null,
    terminology: [],
    theme: 'neutral',
    screenshots: [],
    documentedSections: {},
    cli: [],
    packageManager: 'npm',
    unknowns: ['Product behavior has not been analyzed.'],
  };
}
export function allProductFacts(a: Analysis): ProductFact[] {
  const m = productOf(a);
  return [
    m.summary,
    m.problem,
    m.audience,
    m.motivation,
    ...m.features,
    ...m.differentiators,
    ...m.technical,
    ...Object.values(m.documentedSections),
    ...a.evidence.map((e) => ({
      id: `evidence:${e.source}:${e.name}`,
      text: `${e.name}: ${e.value}`,
      sources: [{ path: e.source }],
      confidence: 'implemented' as const,
    })),
    ...m.screenshots.map((s, i) => ({
      id: `screenshot-${i}`,
      text: `Screenshot: ${s.alt}`,
      sources: [{ path: s.path }],
      confidence: 'implemented' as const,
    })),
  ].filter((f): f is ProductFact => !!f);
}
export function inspectDraft(draft: ReadmeDraft, a: Analysis): GenerationInspection {
  const facts = new Map(allProductFacts(a).map((f) => [f.id, f]));
  return [
    {
      section: 'Opening',
      claims: draft.openingClaimIds.map((id) => facts.get(id)).filter((f): f is ProductFact => !!f),
    },
    ...draft.sections.map((s) => ({
      section: s.title,
      claims: s.claimIds.map((id) => facts.get(id)).filter((f): f is ProductFact => !!f),
    })),
  ];
}
export function badgeOptions(a: Analysis) {
  const r = a.repo;
  return [
    {
      id: 'language',
      label: r.language,
      url: `https://img.shields.io/badge/${encodeURIComponent(r.language)}-3178C6?style=flat-square`,
      available: r.language !== 'Unknown',
    },
    {
      id: 'license',
      label: r.license || 'License unknown',
      url: `https://img.shields.io/badge/license-${encodeURIComponent(r.license || 'unknown')}-a3be8c?style=flat-square`,
      available: !!r.license,
    },
    {
      id: 'stars',
      label: 'GitHub stars',
      url: `https://img.shields.io/github/stars/${r.fullName}?style=flat-square`,
      available: !r.demo,
    },
    ...a.evidence
      .filter((e) => e.name === 'Node.js')
      .slice(0, 1)
      .map((e) => ({
        id: 'node',
        label: `Node ${e.value}`,
        url: `https://img.shields.io/badge/Node.js-${encodeURIComponent(e.value)}-84ba64?style=flat-square`,
        available: true,
      })),
  ];
}
export class DocumentationGenerator {
  draft(
    a: Analysis,
    profile: Profile = 'Professional',
    enabled?: string[],
    badges: string[] = ['language', 'license'],
    tone: Tone = 'Personality',
  ): ReadmeDraft {
    const m = productOf(a);
    const available = this.sectionDrafts(a, profile, tone);
    const defaults = this.defaultSections(a, profile, tone);
    const chosen = enabled ?? defaults;
    const opening = this.opening(m, tone, profile);
    const draft: ReadmeDraft = {
      title: m.name,
      ...opening,
      sections: chosen
        .map((id) => available.find((s) => s.id === id))
        .filter((s): s is DraftSection => !!s),
      badges: badgeOptions(a)
        .filter((b) => b.available && badges.includes(b.id))
        .map((b) => `![${b.label}](${b.url})`)
        .join(' '),
      screenshotComment:
        !m.screenshots.length && m.features.length && profile !== 'Minimal'
          ? `<!--\nRecommended screenshots:\n${m.features
              .slice(0, 3)
              .map((f, i) => `${i + 1}. ${f.label.replace(/--/g, '—')}`)
              .join('\n')}\n-->`
          : '',
    };
    return reviewDraft(draft, a).draft;
  }
  generate(
    a: Analysis,
    profile: Profile = 'Professional',
    enabled?: string[],
    badges: string[] = ['language', 'license'],
    tone: Tone = 'Personality',
  ) {
    return renderDraft(this.draft(a, profile, enabled, badges, tone));
  }
  defaultSections(a: Analysis, profile: Profile = 'Professional', tone: Tone = 'Personality') {
    const available = this.sectionDrafts(a, profile, tone).map((s) => s.id);
    const preference =
      profile === 'Minimal'
        ? ['Features', 'Getting Started', 'Usage', 'License']
        : [
            'Features',
            ...(['Portfolio', 'Open Source', 'Chaotic Good'].includes(profile) ||
            Boolean(productOf(a).motivation)
              ? ['Why']
              : []),
            'Screenshots',
            'Getting Started',
            'Usage',
            ...(profile === 'Developer' ? ['Architecture'] : []),
            'Tech Stack',
            'Environment Variables',
            'Development',
            ...(profile === 'Developer' ? ['API', 'Testing'] : []),
            'Keyboard shortcuts',
            'Known limitations',
            ...(profile === 'Open Source' ? ['Contributing'] : []),
            'License',
          ];
    return preference.filter((s) => available.includes(s));
  }
  opening(
    m: ProductModel,
    tone: Tone,
    profile: Profile,
  ): Pick<ReadmeDraft, 'tagline' | 'introduction' | 'aside' | 'openingClaimIds'> {
    const core = m.features[0],
      secondary = m.features.filter((f) => f !== core).slice(0, 3);
    const phrases = m.features.slice(0, 3).map((f) => lower(f.action));
    const portTool = m.features.some((f) => f.id === 'ports');
    let introduction = core
      ? `${m.name} lets you ${list(phrases)}.`
      : m.summary
        ? finish(m.summary.text)
        : '';
    let tagline = '';
    let aside = '';
    if (portTool) {
      const next = m.features
        .filter((f) => ['terminate', 'open-browser', 'restart', 'search'].includes(f.id))
        .slice(0, 3)
        .map((f) => lower(f.action));
      const controls = next.length
        ? ` ${tone === 'Professional' ? 'From the service list, you can' : 'From there,'} ${list(next)}.`
        : '';
      introduction =
        tone === 'Professional'
          ? `${m.name} shows listening ports and the processes that own them.${controls}`
          : tone === 'Developer'
            ? `Something is already using that port. ${m.name} shows you which process it is.${controls}`
            : `A busy port should not turn into a detective story. ${m.name} brings listening ports and their owning processes into one view.${controls}`;
      tagline =
        tone === 'Professional'
          ? 'Inspect and manage local services.'
          : m.theme === 'navigation'
            ? 'Put localhost back in order.'
            : 'Find the process behind the port.';
      if (tone === 'Unhinged')
        aside = 'Your dev server has enough problems without a mystery tenant.';
    } else if (core) {
      tagline =
        m.summary && m.summary.text.length < 100 && m.summary.text !== introduction
          ? m.summary.text.replace(/[.!]$/, '')
          : core.label.replace(/[.!]$/, '');
      if (tone === 'Professional') tagline = core.label.replace(/[.!]$/, '');
      if (tone === 'Developer') introduction = `Use ${m.name} to ${list(phrases)}.`;
      if (tone === 'Personality' && m.problem && !m.motivation)
        introduction = finish(m.problem.text) + ' ' + introduction;
      if (tone === 'Unhinged')
        aside =
          m.theme === 'archaeology'
            ? 'Some projects need a second life. Some need a decent burial.'
            : m.theme === 'gaming'
              ? 'Bad decisions happen. At least make the next move deliberate.'
              : m.theme === 'garden'
                ? 'One less thing left to wilt in a forgotten tab.'
                : 'Less ceremony. Back to the thing you were trying to do.';
    }
    // Sparse evidence gets a short honest introduction, not an invented product pitch.
    if (profile === 'Minimal') aside = '';
    return {
      tagline,
      introduction,
      aside,
      openingClaimIds: [
        ...(core ? m.features.slice(0, 4).map((f) => f.id) : []),
        ...(m.summary ? [m.summary.id] : []),
        ...(m.problem ? [m.problem.id] : []),
      ],
    };
  }
  sectionDrafts(a: Analysis, profile: Profile, tone: Tone): DraftSection[] {
    const m = productOf(a);
    const blocks: DraftSection[] = [];
    const add = (id: string, body: string, claims: ProductFact[] = []) => {
      if (body.trim())
        blocks.push({
          id,
          title: sectionTitle(id, m, tone),
          body: body.trim(),
          claimIds: claims.map((f) => f.id),
        });
    };
    if (m.features.length) {
      const limit = profile === 'Minimal' ? 3 : tone === 'Professional' ? 6 : 7;
      add(
        'Features',
        m.features
          .slice(0, limit)
          .map((f) => {
            const detail =
              f.detail.toLowerCase().replace(/[.!?]$/, '') ===
              f.label.toLowerCase().replace(/[.!?]$/, '')
                ? ''
                : f.detail;
            return profile === 'Minimal'
              ? `- ${finish(f.action)}`
              : `- **${f.label.replace(/[.!?]$/, '')}**${detail ? ` — ${detail}` : ''}`;
          })
          .join('\n'),
        m.features.slice(0, limit),
      );
    }
    if (m.motivation) add('Why', m.motivation.text, [m.motivation]);
    else if (m.problem && m.features.length) {
      add(
        'Why',
        `${finish(m.problem.text)} ${m.name} puts ${m.features.some((f) => f.id === 'ports') ? 'the port and the process beside each other' : 'the main workflow in one place'}${m.features.some((f) => f.id === 'terminate') ? ', with the controls to act on what you find' : ''}.`,
        [m.problem, ...m.features.filter((f) => ['ports', 'terminate'].includes(f.id))],
      );
    }
    if (m.screenshots.length)
      add(
        'Screenshots',
        m.screenshots
          .map(
            (s) =>
              `![${s.alt.replace(/[\[\]]/g, '')}](${s.path.split('/').map(encodeURIComponent).join('/')})`,
          )
          .join('\n\n'),
        m.screenshots.map((s, i) => ({
          id: `screenshot-${i}`,
          text: `Screenshot: ${s.alt}`,
          sources: [{ path: s.path }],
          confidence: 'implemented',
        })),
      );
    const rootScripts = a.evidence.filter(
      (e) => e.category === 'Scripts' && e.source === 'package.json',
    );
    const run = (name: string) =>
      m.packageManager === 'npm' ? `npm run ${name}` : `${m.packageManager} ${name}`;
    const canInstall = a.evidence.some(
      (e) =>
        e.source === 'package.json' &&
        ['Scripts', 'Tech Stack', 'Dependencies'].includes(e.category),
    );
    if (canInstall) {
      const primary =
        rootScripts.find((e) => e.name === 'dev') ||
        rootScripts.find((e) => e.name === 'start') ||
        rootScripts.find((e) => e.name === 'build');
      const runtime = a.evidence.find((e) => e.name === 'Node.js');
      const commands = [
        `git clone https://github.com/${a.repo.fullName}.git`,
        `cd ${a.repo.name}`,
        `${m.packageManager} install`,
        ...(primary ? [run(primary.name)] : []),
      ];
      add(
        'Getting Started',
        `${runtime ? `Requires Node.js ${runtime.value}.\n\n` : ''}\`\`\`bash\n${commands.join('\n')}\n\`\`\``,
      );
    } else if (m.documentedSections.Installation)
      add('Getting Started', m.documentedSections.Installation.text, [
        m.documentedSections.Installation,
      ]);
    if (m.documentedSections.Usage)
      add('Usage', m.documentedSections.Usage.text, [m.documentedSections.Usage]);
    else if (m.cli.length)
      add(
        'Usage',
        m.cli
          .map(
            (c) =>
              `### ${c.description.replace(/[.!?]$/, '')}\n\n\`\`\`text\n${c.invocation}\n\`\`\``,
          )
          .join('\n\n'),
      );
    if (m.documentedSections.Architecture)
      add('Architecture', m.documentedSections.Architecture.text, [
        m.documentedSections.Architecture,
      ]);
    const roles = m.technical.filter((e) => !['Vitest', 'Jest', 'Playwright'].includes(e.name));
    if (roles.length)
      add(
        'Tech Stack',
        roles
          .map((e) => `**${e.name}${e.version ? ` ${e.version}` : ''}**\n${e.text}`)
          .join('\n\n'),
        roles,
      );
    else {
      const stack = a.evidence.filter(
        (e) => e.category === 'Tech Stack' && !['Node.js'].includes(e.name),
      );
      if (stack.length)
        add(
          'Tech Stack',
          stack
            .map(
              (e) =>
                `**${e.name}**${e.value.startsWith('^') || /^\d/.test(e.value) ? ` ${e.value}` : ''}`,
            )
            .join(' · '),
        );
    }
    if (a.env.length)
      add(
        'Environment Variables',
        `Set these variables for your environment. Keep local values out of version control.\n\n\`\`\`env\n${a.env.map((n) => `${n}=`).join('\n')}\n\`\`\``,
      );
    if (rootScripts.length)
      add(
        'Development',
        `| Command | Runs |\n| --- | --- |\n${rootScripts.map((s) => `| \`${run(s.name)}\` | \`${s.value.replace(/\|/g, '\\|')}\` |`).join('\n')}`,
      );
    const test = rootScripts.find((s) => s.name === 'test');
    if (test) add('Testing', `Run the test suite:\n\n\`\`\`bash\n${run(test.name)}\n\`\`\``);
    const endpoints = a.evidence.filter((e) => e.category === 'API');
    if (endpoints.length)
      add(
        'API',
        `| Method | Endpoint |\n| --- | --- |\n${endpoints
          .map((e) => {
            const [method, ...path] = e.name.split(' ');
            return `| ${method} | \`${path.join(' ')}\` |`;
          })
          .join('\n')}`,
      );
    for (const id of ['Keyboard shortcuts', 'Roadmap', 'Known limitations', 'Contributing'])
      if (m.documentedSections[id])
        add(id, m.documentedSections[id].text, [m.documentedSections[id]]);
    if (a.repo.license) add('License', `${a.repo.license}. See [LICENSE](LICENSE) for the terms.`);
    // Attach technical proof internally, keeping source paths out of README prose.
    for (const block of blocks)
      if (!block.claimIds.length) {
        block.claimIds = a.evidence
          .filter((e) =>
            block.id === 'Getting Started' || block.id === 'Development'
              ? e.category === 'Scripts'
              : block.id === 'Environment Variables'
                ? e.category === 'Environment Variables'
                : block.id === 'Testing'
                  ? e.category === 'Testing' || e.name === 'test'
                  : block.id === 'API'
                    ? e.category === 'API'
                    : block.id === 'Tech Stack'
                      ? e.category === 'Tech Stack'
                      : false,
          )
          .map((e) => `evidence:${e.source}:${e.name}`);
      }
    return blocks;
  }
  sections(
    a: Analysis,
    profile: Profile = 'Professional',
    tone: Tone = 'Personality',
  ): Record<string, string> {
    return Object.fromEntries(
      this.sectionDrafts(a, profile, tone).map((s) => [
        s.id,
        reviewDraft(
          {
            title: '',
            tagline: '',
            introduction: '',
            aside: '',
            sections: [s],
            openingClaimIds: [],
            badges: '',
            screenshotComment: '',
          },
          a,
        ).draft.sections[0]?.body || '',
      ]),
    );
  }
  portfolio(a: Analysis) {
    const m = productOf(a);
    const opening = this.opening(m, 'Professional', 'Portfolio');
    const one = m.features.length
      ? `${m.name}: ${list(m.features.slice(0, 2).map((f) => lower(f.action)))}.`
      : m.summary?.text || m.name;
    const technical = m.technical
      .slice(0, 3)
      .map((t) => `${t.name} ${lower(t.text)}`)
      .join(' ');
    return {
      'One-line description': one,
      'Short portfolio description': opening.introduction,
      'Long portfolio description': [opening.introduction, m.problem?.text, technical]
        .filter(Boolean)
        .join('\n\n'),
      'Resume bullet': m.features.length
        ? `Built ${m.name} to ${list(m.features.slice(0, 3).map((f) => lower(f.action)))}.`
        : one,
      'GitHub description': one.slice(0, 350),
      'LinkedIn project description': [opening.introduction, technical]
        .filter(Boolean)
        .join('\n\n'),
    };
  }
}
export function renderDraft(draft: ReadmeDraft) {
  return (
    [
      `# ${draft.title}`,
      draft.tagline ? `> ${draft.tagline}` : '',
      draft.introduction,
      draft.aside,
      draft.badges,
      ...draft.sections.map((s) => `## ${s.title}\n\n${s.body}`),
      draft.screenshotComment,
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
export class LocalAIProvider implements AIProvider {
  async rewrite(text: string, instruction: string, a?: Analysis) {
    if (instruction === 'Shorten')
      return text
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(' ');
    if (instruction === 'Make more casual')
      return text
        .replace(/utilizes|utilize/g, 'uses')
        .replace(/provides/g, 'offers')
        .replace(/application/g, 'app');
    if (instruction === 'Make more technical')
      return text.replace(/app\b/g, 'application').replace(/setup\b/g, 'configuration');
    if (instruction === 'Fix grammar')
      return text
        .replace(/\bteh\b/g, 'the')
        .replace(/\brecieve\b/g, 'receive')
        .replace(/\bi\b/g, 'I')
        .replace(/([^\n]) {2,}/g, '$1 ');
    if (instruction === 'Expand' && a) {
      const feature = productOf(a).features.find(
        (f) =>
          !text.includes(f.detail) &&
          text
            .toLowerCase()
            .split(/\W+/)
            .some((w) => w.length > 4 && f.text.toLowerCase().includes(w)),
      );
      return feature ? `${text}\n\n${feature.detail}` : text;
    }
    return text;
  }
}
