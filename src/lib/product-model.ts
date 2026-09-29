import ts from 'typescript';
import {
  Analysis,
  ProductFact,
  ProductFeature,
  ProductModel,
  RepoFile,
  SourceReference,
} from './types';
import { redact, safePath } from './safety';
import { splitMarkdown } from './markdown-sections';

const actionVerb =
  /\b(?:see|view|find|search|filter|inspect|track|monitor|watch|open|create|write|edit|save|delete|remove|archive|restore|export|import|compare|generate|manage|schedule|play|run|list|kill|terminate|restart|stop|start|capture|sync|organize|browse|share|download|upload|record|convert|render|parse|validate)\b/i;
const nonFeature =
  /\b(?:dependencies|dockerfile|package\.json|vitest|jest|typescript support|built with|uses react|coming soon|planned|roadmap|todo|not implemented|not yet|does not|cannot|not supported)\b/i;
const instruction =
  /ignore (?:all |previous |prior )?instructions|system prompt|you are (?:an? |the )?(?:assistant|chatgpt)|reveal .*secret|\[REDACTED\]/i;
const clean = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : s + '.');
function useful(s: string) {
  return (
    s.length > 8 &&
    s.length < 600 &&
    !instruction.test(s) &&
    !/coming soon|could not|not provided|not been verified|unknown|this documentation is based/i.test(
      s,
    )
  );
}
function titleCase(s: string) {
  return s
    .split(/[-_\s]+/)
    .map((w) =>
      /^(api|cli|tcp|http|sql|ui)$/i.test(w) ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1),
    )
    .join(' ');
}
function stripComments(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|#(?!\[)).*$/gm, '');
}
type CodeFile = { path: string; text: string; raw: string };
type Call = { name: string; args: string[] };
function callsIn(text: string): Call[] {
  const sf = ts.createSourceFile(
    'signal.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const calls: Call[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node))
      calls.push({
        name: node.expression.getText(sf),
        args: node.arguments.map((a) => a.getText(sf)),
      });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}
type BoundAction = { label: string; body: string; source: SourceReference };

/** Interpret bounded source signals. Dependencies alone cannot create product features. */
export function understandProduct(a: Analysis, files: RepoFile[]): ProductModel {
  const usable = files.filter(
    (f) =>
      safePath(f.path) &&
      !/(^|\/)(tests?|__tests__|fixtures?|mocks?)(\/|$)|\.(test|spec)\./i.test(f.path) &&
      !/^\.env/.test(f.path),
  );
  const code: CodeFile[] = usable
    .filter((f) => /\.(?:[jt]sx?|py|rs|go|svelte|vue|sh)$/.test(f.path))
    .map((f) => ({
      path: f.path,
      raw: redact(f.content || ''),
      text: stripComments(redact(f.content || '')),
    }));
  const functions = new Map<string, { body: string; source: SourceReference }[]>();
  const actions: BoundAction[] = [];
  const uiTitles: string[] = [];
  const metadata: Record<string, any> = {};
  let counter = 0;
  const fact = (
    text: string,
    sources: SourceReference[],
    confidence: ProductFact['confidence'] = 'implemented',
  ): ProductFact => ({ id: `claim-${++counter}`, text, sources, confidence });
  const model: ProductModel = {
    version: 2,
    name: titleCase(a.repo.name),
    kind: 'project',
    summary: null,
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
    unknowns: [],
  };
  for (const file of usable.filter((f) => /(?:package|tauri\.conf)\.json$/.test(f.path))) {
    try {
      const json = JSON.parse(file.content || '{}');
      if (file.path === 'package.json') Object.assign(metadata, json);
      if (json.productName) model.name = clean(json.productName);
      if (json.packageManager && /^(npm|pnpm|yarn|bun)@/.test(json.packageManager))
        model.packageManager = json.packageManager.split('@')[0];
    } catch {
      /* invalid metadata is left unknown */
    }
  }
  const repoSummary = clean(a.repo.description || metadata.description || '');
  if (useful(repoSummary))
    model.summary = fact(
      sentence(repoSummary),
      [
        {
          path: a.repo.description ? 'GitHub repository description' : 'package.json',
          excerpt: repoSummary,
        },
      ],
      'documented',
    );
  const reference = (file: CodeFile, node: ts.Node, sf: ts.SourceFile): SourceReference => ({
    path: file.path,
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    excerpt: node.getText(sf).slice(0, 220),
  });
  for (const file of code) {
    if (!/\.[jt]sx?$/.test(file.path)) continue;
    const sf = ts.createSourceFile(
      file.path,
      file.raw,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const list = functions.get(node.name.text) || [];
        list.push({ body: node.body.getText(sf), source: reference(file, node, sf) });
        functions.set(node.name.text, list);
        if (
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
          node.body.statements.length &&
          !/TODO|not implemented/.test(node.body.getText(sf))
        ) {
          const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
          const description = docs
            .map((doc) => (typeof doc.comment === 'string' ? doc.comment : ''))
            .join(' ')
            .trim();
          if (useful(description) && actionVerb.test(description)) {
            const claim = fact(sentence(description), [reference(file, node, sf)], 'documented');
            model.features.push({
              ...claim,
              label: node.name.text
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/^./, (c) => c.toUpperCase()),
              action:
                description.charAt(0).toLowerCase() + description.slice(1).replace(/[.!?]$/, ''),
              detail: sentence(description),
              priority: 72,
              role: 'core',
            });
          }
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const method = node.expression.name.text;
        const handler = node.arguments.find(
          (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
        );
        const operations: Record<string, { label: string; check: RegExp; priority: number }> = {
          get: {
            label: 'List',
            check: /\.(?:findMany|findAll|all|read|find)\b|\breadFile\b/,
            priority: 60,
          },
          post: {
            label: 'Create',
            check: /\.(?:create|insert|push)\b|\bwriteFile\b/,
            priority: 80,
          },
          patch: { label: 'Update', check: /\.(?:update|save)\b/, priority: 65 },
          delete: { label: 'Delete', check: /\.(?:delete|remove)\b|\bunlink\b/, priority: 50 },
        };
        const rule = operations[method];
        if (
          rule &&
          handler &&
          callsIn(handler.getText(sf)).some((call) => rule.check.test(call.name))
        ) {
          const resource = node.arguments[0].text
            .split('/')
            .find((part) => part && !/^(?:api|v\d+)$/.test(part) && !part.startsWith(':'))
            ?.replace(/[-_]/g, ' ');
          if (resource) {
            const label = `${rule.label} ${resource}`;
            const detail = `${label} through the HTTP API.`;
            const claim = fact(detail, [reference(file, node, sf)]);
            model.features.push({
              ...claim,
              label,
              action: label.charAt(0).toLowerCase() + label.slice(1),
              detail,
              priority: rule.priority,
              role: method === 'post' ? 'core' : 'workflow',
            });
          }
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        const list = functions.get(node.name.text) || [];
        list.push({ body: node.initializer.body.getText(sf), source: reference(file, node, sf) });
        functions.set(node.name.text, list);
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText(sf);
        const attrs = opening.attributes.properties.filter(ts.isJsxAttribute);
        const value = (name: string) => {
          const attr = attrs.find((p) => p.name.getText(sf) === name);
          return attr?.initializer?.getText(sf).replace(/^["']|["']$/g, '') || '';
        };
        const text = ts.isJsxElement(node)
          ? node.children
              .filter(ts.isJsxText)
              .map((n) => n.text)
              .join(' ')
          : '';
        const label = clean(value('aria-label') || text || value('title') || value('placeholder'));
        if (/^(h1|title)$/i.test(tag) && useful(label)) uiTitles.push(label);
        if (
          /^(button|a|input|select|textarea|Button|MenuItem)$/.test(tag) &&
          label &&
          label.length < 100
        ) {
          const handler = attrs.find((p) =>
            /^on(?:Click|Change|Submit|Select)$/.test(p.name.getText(sf)),
          );
          if (handler?.initializer)
            actions.push({
              label,
              body: handler.initializer.getText(sf),
              source: reference(file, node, sf),
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const bin =
      typeof metadata.bin === 'string' ? metadata.name : Object.keys(metadata.bin || {})[0];
    if (bin) {
      for (const match of file.text.matchAll(
        /\.command\(\s*['"]([^'"]+)['"]\s*\)([\s\S]{0,220}?)(?=\.command\(|;|$)/g,
      )) {
        const description = match[2].match(/\.description\(\s*['"]([^'"]+)['"]/)?.[1];
        if (
          description &&
          useful(description) &&
          /\.action\(/.test(match[2]) &&
          !/\.action\(\s*\([^)]*\)\s*=>\s*\{\s*\}/.test(match[2])
        )
          model.cli.push({
            invocation: `${bin} ${match[1]}`,
            description: sentence(description),
            sources: [{ path: file.path, excerpt: match[0].slice(0, 220) }],
          });
      }
    }
  }
  const docFiles = usable.filter((f) => /\.(md|mdx)$/i.test(f.path));
  for (const doc of docFiles) {
    const text = redact(doc.content || '');
    const title = text.match(/^# ([^\n]+)/)?.[1];
    if (
      /^README\.md$/i.test(doc.path) &&
      title &&
      clean(title).length < 70 &&
      !/badge|!\[/.test(title)
    )
      model.name = /^\S+-\S+$/.test(clean(title)) ? titleCase(clean(title)) : clean(title);
    for (const block of splitMarkdown(text)) {
      if (/^(?:who (?:it is|it's) for|audience)$/i.test(block.title) && useful(clean(block.body)))
        model.audience = fact(
          clean(block.body),
          [{ path: doc.path, excerpt: clean(block.body).slice(0, 220) }],
          'documented',
        );
      if (/^(?:the problem|problem)$/i.test(block.title) && useful(clean(block.body)))
        model.problem = fact(
          clean(block.body),
          [{ path: doc.path, excerpt: clean(block.body).slice(0, 220) }],
          'documented',
        );
      if (
        /^(?:what makes it different|design decisions|tradeoffs)$/i.test(block.title) &&
        useful(clean(block.body))
      )
        model.differentiators.push(
          fact(
            clean(block.body),
            [{ path: doc.path, excerpt: clean(block.body).slice(0, 220) }],
            'documented',
          ),
        );
      if (
        /^(?:why(?: i built (?:this|it))?|motivation|background)$/i.test(block.title) &&
        useful(clean(block.body))
      )
        model.motivation = fact(
          block.body,
          [{ path: doc.path, excerpt: clean(block.body).slice(0, 220) }],
          'documented',
        );
      const key = /^usage|^cli usage|^examples?$/i.test(block.title)
        ? 'Usage'
        : /^keyboard shortcuts$/i.test(block.title)
          ? 'Keyboard shortcuts'
          : /^known limitations|^limitations$/i.test(block.title)
            ? 'Known limitations'
            : /^roadmap$/i.test(block.title)
              ? 'Roadmap'
              : /^contribut/i.test(block.title)
                ? 'Contributing'
                : /^architecture|^how it works$/i.test(block.title)
                  ? 'Architecture'
                  : /^install/i.test(block.title)
                    ? 'Installation'
                    : null;
      if (key && useful(clean(block.body)))
        model.documentedSections[key] = fact(
          block.body,
          [{ path: doc.path, excerpt: clean(block.body).slice(0, 220) }],
          'documented',
        );
      if (/^(features|what it does|capabilities|highlights)$/i.test(block.title)) {
        for (const item of block.body.matchAll(/^[-*]\s+(.+)(?:\n[ \t]+([^\n]+))?/gm)) {
          const full = clean(item[1] + ' ' + (item[2] || ''));
          if (!useful(full) || nonFeature.test(full) || !actionVerb.test(full)) continue;
          const label = clean(
            item[1].match(/\*\*([^*]+)\*\*/)?.[1] || full.split(/[.:—]/)[0],
          ).slice(0, 75);
          const detail = sentence(
            full.replace(new RegExp('^' + escapeRegex(label) + '[:. —-]*'), '') || full,
          );
          const f = fact(full, [{ path: doc.path, excerpt: item[0].slice(0, 220) }], 'documented');
          model.features.push({
            ...f,
            label,
            action: full.replace(/[.!?]$/, ''),
            detail,
            priority: 50 - model.features.length,
            role: 'workflow',
          });
        }
      }
    }
  }
  function resolve(
    body: string,
    depth = 0,
    seen = new Set<string>(),
  ): { text: string; sources: SourceReference[] } {
    let text = body;
    const sources: SourceReference[] = [];
    if (depth < 3)
      for (const [name, implementations] of functions) {
        if (!seen.has(name) && new RegExp(`\\b${escapeRegex(name)}\\b`).test(body)) {
          seen.add(name);
          for (const implementation of implementations) {
            const nested = resolve(implementation.body, depth + 1, seen);
            text += '\n' + nested.text;
            sources.push(implementation.source, ...nested.sources);
          }
        }
      }
    return { text, sources };
  }
  const addFeature = (
    id: string,
    label: string,
    action: string,
    detail: string,
    priority: number,
    sources: SourceReference[],
    role: ProductFeature['role'] = 'workflow',
  ) => {
    if (model.features.some((f) => f.id === id || f.label.toLowerCase() === label.toLowerCase()))
      return;
    model.features.push({ ...fact(detail, sources), id, label, action, detail, priority, role });
  };
  // Operation detectors require executable calls. Names/descriptions never satisfy them.
  const portSources = code.filter((file) =>
    /\.[jt]sx?$/.test(file.path)
      ? callsIn(file.text).some(
          (call) =>
            /^(?:execFile|exec|spawn)$/.test(call.name) &&
            /^['"](?:lsof|netstat|ss)['"]$/.test(call.args[0] || '') &&
            (!/lsof/.test(call.args[0]) || /['"]-i(?:TCP|UDP)?['"]/.test(call.args[1] || '')),
        )
      : /\bpsutil\.net_connections\s*\(|\bget_sockets_info\s*\(/.test(file.text),
  );
  const portRefs = portSources.map((file) => ({
    path: file.path,
    excerpt: file.text.match(
      /.{0,30}(?:lsof|netstat|net_connections|get_sockets_info).{0,150}/,
    )?.[0],
  }));
  if (portSources.length) {
    addFeature(
      'ports',
      'See what owns each port',
      'see which processes are listening on your local ports',
      'See listening ports and their owning processes together, so you can identify a service before touching it.',
      100,
      portRefs,
      'core',
    );
    model.problem = fact(
      'A development server will not start when another process already owns its port.',
      portRefs,
      'inferred',
    );
    model.audience = fact('Developers running local services.', portRefs, 'inferred');
  }
  for (const action of actions) {
    const resolved = resolve(action.body);
    const connected = resolved.text;
    const calls = callsIn(connected);
    const refs = [action.source, ...resolved.sources];
    const meaningful = calls.some((call) =>
      /^(?:fetch|invoke|set[A-Z]\w*|dispatch|process\.kill|window\.open|localStorage\.setItem|writeFile|execFile|spawn)$|\.(?:post|put|delete|patch|save|write|update|filter|kill)$/.test(
        call.name,
      ),
    );
    if (!meaningful || /throw new Error\(['"](?:not implemented|todo)/i.test(connected)) continue;
    if (
      /kill|terminate|stop process/i.test(action.label) &&
      (calls.some((call) => call.name === 'process.kill') ||
        (/fetch\s*\([^)]*(?:kill|terminate)/s.test(connected) &&
          code.some(
            (f) =>
              callsIn(f.text).some((call) => call.name === 'process.kill') &&
              /\.(?:post|delete)\(['"][^'"]*(?:kill|terminate)/.test(f.text),
          )))
    )
      addFeature(
        'terminate',
        'Stop a process',
        'stop the selected process',
        'Terminate the selected process from the interface instead of copying its PID into another terminal.',
        85,
        [
          ...refs,
          ...code
            .filter((f) => callsIn(f.text).some((call) => call.name === 'process.kill'))
            .map((f) => ({ path: f.path })),
        ],
      );
    else if (
      /restart/i.test(action.label) &&
      /\b(?:spawn|execFile|Command::new)\s*\(/.test(connected)
    )
      addFeature(
        'restart',
        'Restart a service',
        'restart a development service',
        'Restart a service using its configured command.',
        80,
        refs,
      );
    else if (
      /open.*browser|open.*service/i.test(action.label) &&
      /window\.open\s*\(|\bopenUrl\s*\(/.test(connected)
    )
      addFeature(
        'open-browser',
        'Open the service',
        'open a service in your browser',
        'Jump from a running service to its page in your browser.',
        70,
        refs,
        'convenience',
      );
    else if (/search|filter/i.test(action.label) && code.some((f) => /\.filter\s*\(/.test(f.text)))
      addFeature(
        'search',
        clean(action.label).split(/\s+by\s+/i)[0],
        clean(action.label).toLowerCase(),
        'Narrow the list as you type, instead of scrolling through every entry.',
        65,
        refs,
        'convenience',
      );
    else if (!/restart|kill|terminate/i.test(action.label) && actionVerb.test(action.label)) {
      const label = clean(action.label);
      addFeature(
        `action-${model.features.length}`,
        label,
        label[0].toLowerCase() + label.slice(1),
        sentence(label),
        55,
        refs,
      );
    }
  }
  if (portSources.length) {
    const watches = code.filter((file) =>
      callsIn(file.text).some(
        (call) =>
          call.name === 'setInterval' &&
          /port|listener|service/i.test(resolve(call.args[0] || '').text),
      ),
    );
    if (watches.length)
      addFeature(
        'watch',
        'Keep the list current',
        'watch the list refresh as services change',
        'The service list refreshes automatically while you work.',
        75,
        watches.map((f) => ({
          path: f.path,
          excerpt: f.text.match(/.{0,40}(?:setInterval|subscribe|watch).{0,120}/)?.[0],
        })),
        'convenience',
      );
  }
  for (const entry of model.cli) {
    addFeature(
      `cli-${model.features.length}`,
      entry.description.replace(/[.!?]$/, ''),
      entry.description.replace(/[.!?]$/, '').toLowerCase(),
      entry.description,
      60,
      entry.sources,
    );
  }
  // Python CLI commands use actual decorators, function docstrings, and an explicit entry point.
  for (const file of code.filter((f) => /\.py$/.test(f.path))) {
    for (const match of file.text.matchAll(
      /@(?:app|cli)\.command\([^)]*\)\s*\ndef\s+(\w+)\([^)]*\)(?:\s*->[^:]+)?:\s*\n\s*["']{3}([^"']+)["']{3}/g,
    )) {
      const description = clean(match[2]);
      if (useful(description) && actionVerb.test(description))
        addFeature(
          `python-${match[1]}`,
          titleCase(match[1]),
          description[0].toLowerCase() + description.slice(1).replace(/[.!?]$/, ''),
          sentence(description),
          60,
          [{ path: file.path, excerpt: match[0].slice(0, 220) }],
        );
    }
  }
  const has = (name: string) => a.evidence.some((e) => e.name === name);
  if (metadata.bin || model.cli.length || code.some((f) => /@(?:app|cli)\.command\(/.test(f.text)))
    model.kind = 'CLI';
  else if (
    a.files.some((p) => /(?:tauri\.conf\.json|electron\.[jt]s)$/.test(p)) ||
    a.evidence.some((e) => e.name === 'electron' || e.name.startsWith('@tauri-apps/'))
  )
    model.kind = 'desktop app';
  else if (code.some((f) => /new Phaser\.Game\(|pygame\.init\(/.test(f.text))) model.kind = 'game';
  else if (code.some((f) => /\.[jt]sx$|\.vue$|\.svelte$/.test(f.path))) model.kind = 'web app';
  else if (metadata.exports || (metadata.main && !metadata.private)) model.kind = 'library';
  else if (a.evidence.some((e) => e.category === 'API')) model.kind = 'server';
  const roles: Record<string, { pattern: RegExp; description: string }> = {
    React: {
      pattern: /(?:from\s*['"]react['"]|createRoot\s*\()/,
      description:
        'Builds the interactive interface and keeps its state in sync with user actions.',
    },
    'Next.js': {
      pattern: /from\s*['"]next(?:\/[^'"]*)?['"]/,
      description: 'Handles page rendering and application routing.',
    },
    Express: {
      pattern: /\bexpress\s*\(|from\s*['"]express['"]/,
      description: 'Routes HTTP requests to the server handlers.',
    },
    Vite: {
      pattern: /\bvite(?:\s|$)/,
      description: 'Runs the frontend development server and creates the production build.',
    },
    Vitest: { pattern: /\bvitest\b/, description: 'Runs the automated test suite.' },
  };
  for (const e of a.evidence.filter((e) => ['Tech Stack', 'Testing'].includes(e.category))) {
    const role = roles[e.name];
    const sources = role
      ? code.filter((f) => role.pattern.test(f.text)).map((f) => ({ path: f.path }))
      : [];
    if (
      (e.name === 'Vite' || e.name === 'Vitest') &&
      Object.values(a.scripts).some((s) => role?.pattern.test(s))
    )
      sources.push({ path: e.source });
    if (sources.length && role)
      model.technical.push({
        ...fact(role.description, [{ path: e.source }, ...sources]),
        name: e.name,
        version: e.value,
      });
  }
  if (portSources.length)
    model.technical.push({
      ...fact(
        'Queries the operating system for listening sockets and process ownership.',
        portRefs,
      ),
      name: 'Process discovery',
    });
  const jsx = code.find((f) => /\.[jt]sx$/.test(f.path) && /from\s*['"]react['"]/.test(f.text));
  if (jsx && has('TypeScript'))
    model.technical.push({
      ...fact('Checks the interface code and data shapes during development.', [
        { path: jsx.path },
        { path: 'package.json' },
      ]),
      name: 'TypeScript',
      version: a.evidence.find((e) => e.name === 'TypeScript')?.value,
    });
  const deduped: ProductFeature[] = [];
  for (const f of model.features.sort((x, y) => y.priority - x.priority)) {
    if (
      !deduped.some(
        (d) =>
          d.label.toLowerCase() === f.label.toLowerCase() ||
          d.action.toLowerCase() === f.action.toLowerCase(),
      )
    )
      deduped.push(f);
  }
  model.features = deduped.slice(0, 8);
  model.workflow = model.features
    .filter((f) => f.role !== 'convenience')
    .slice(0, 4)
    .map((f) => f.id);
  const themeText = [model.name, repoSummary, ...uiTitles].join(' ');
  model.theme = /port|harbou?r|radar|traffic|ship|captain/i.test(themeText)
    ? 'navigation'
    : /reap|grave|archive|resurrect/i.test(themeText)
      ? 'archaeology'
      : /scum|save.?game|checkpoint|quest/i.test(themeText)
        ? 'gaming'
        : /plant|garden|grow|water/i.test(themeText)
          ? 'garden'
          : 'neutral';
  model.terminology = [
    ...new Set(
      themeText.match(
        /\b(?:ports?|radar|control tower|traffic|graveyard|archive|reap|checkpoint|quest|garden|plants?|watering)\b/gi,
      ) || [],
    ),
  ].slice(0, 8);
  if (!model.problem && model.motivation) model.problem = model.motivation;
  // Images are selected by existing Markdown references or explicit screenshot paths, never by extension alone.
  const pathSet = new Set(a.files);
  const shots = new Map<string, ProductModel['screenshots'][number]>();
  for (const doc of docFiles) {
    for (const match of (doc.content || '').matchAll(
      /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      let path = match[2];
      if (/^(?:https?:|data:|\/\/)/.test(path)) continue;
      const segments =
        (doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/') + 1) : '') + path;
      const resolved: string[] = [];
      for (const segment of segments.split('/')) {
        if (segment === '..') resolved.pop();
        else if (segment && segment !== '.') resolved.push(segment);
      }
      path = resolved.join('/');
      if (
        pathSet.has(path) &&
        /\.(png|jpe?g|webp|gif)$/i.test(path) &&
        !/logo|icon|badge|avatar/i.test(path)
      )
        shots.set(path, {
          path,
          alt: clean(match[1]) || 'Application preview',
          hero: /hero|overview|dashboard|main/i.test(path + ' ' + match[1]),
          source: doc.path,
        });
    }
  }
  for (const path of a.files) {
    if (
      /(?:screenshots?|previews?|demo)[/_-].*\.(png|jpe?g|webp|gif)$/i.test(path) &&
      !/logo|icon|badge|avatar/i.test(path) &&
      !shots.has(path)
    )
      shots.set(path, {
        path,
        alt: titleCase(
          path
            .split('/')
            .pop()!
            .replace(/\.[^.]+$/, '')
            .replace(/[-_]/g, ' '),
        ),
        hero: /hero|dashboard|main|overview/i.test(path),
        source: path,
      });
  }
  model.screenshots = [...shots.values()]
    .sort((x, y) => Number(y.hero) - Number(x.hero))
    .slice(0, 4);
  if (model.screenshots.length && !model.screenshots.some((s) => s.hero))
    model.screenshots[0].hero = true;
  if (!model.features.length)
    model.unknowns.push(
      'No user-facing behavior could be established from the inspected source or documentation.',
    );
  if (!model.summary && !model.features.length)
    model.unknowns.push('A product introduction needs author input.');
  if (!model.audience) model.unknowns.push('The intended audience is not explicit.');
  if (!model.differentiators.length)
    model.unknowns.push('No supported comparison with other products was found.');
  return model;
}
function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
