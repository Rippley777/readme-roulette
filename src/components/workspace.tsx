'use client';
import { AISettingsCard } from './ai-settings';
import { AISettings, aiProviderLabels } from '@/lib/byok-types';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Code2,
  Copy,
  Dice5,
  Download,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  GitFork,
  GitPullRequest,
  Github,
  Heart,
  History,
  Info,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  TrendingUp,
  WandSparkles,
  X,
  Zap,
  Camera,
  CheckCircle2,
  Circle,
  SlidersHorizontal,
  Command,
  LogOut,
  GripVertical,
  Eye,
  Braces,
  Network,
  Activity,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import MarkdownSource from './markdown-source';
import TonePicker from './tone-picker';
import GenerationInspector from './generation-inspector';
import { splitMarkdown, joinMarkdown, replaceSection } from '@/lib/markdown-sections';
import remarkGfm from 'remark-gfm';
import { diffLines } from 'diff';
import { Analysis, Repository, Profile, Tone, GenerationInspection } from '@/lib/types';
import { demoRepos } from '@/lib/demo';
import {
  profiles,
  tones,
  sectionTitle,
  productOf,
  DocumentationGenerator,
  badgeOptions,
} from '@/lib/generator';
import { scoreRepository } from '@/lib/score';

type View = 'dashboard' | 'repositories' | 'scan' | 'activity' | 'settings' | 'help';
type Tab = 'overview' | 'analysis' | 'editor' | 'portfolio' | 'screenshots';
async function api(path: string, body?: unknown) {
  const res = await fetch(
    `/api/${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const languageColors: Record<string, string> = {
  TypeScript: '#5c9ded',
  Rust: '#dc997b',
  Python: '#e2c66b',
  Go: '#64c6d9',
  Shell: '#a8c87d',
  JavaScript: '#e7cf65',
  Unknown: '#82828b',
};
function health(score: number) {
  return score < 0
    ? { label: 'Not analyzed', className: 'neutral' }
    : score >= 85
      ? { label: 'Excellent', className: 'green' }
      : score >= 75
        ? { label: 'Looking good', className: 'blue' }
        : score >= 60
          ? { label: 'Needs polish', className: 'yellow' }
          : score >= 45
            ? { label: 'Needs work', className: 'orange' }
            : { label: 'Needs some love', className: 'red' };
}
function timeAgo(date: string) {
  const h = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 3600000));
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
function Score({ score, large = false }: { score: number; large?: boolean }) {
  const h = health(score);
  return (
    <span className={`score ${h.className} ${large ? 'large' : ''}`}>
      <svg viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="16" />
        <circle
          cx="20"
          cy="20"
          r="16"
          strokeDasharray={`${Math.max(0, score)} 100`}
          pathLength="100"
        />
      </svg>
      <span>{score < 0 ? '–' : score}</span>
    </span>
  );
}
function DiceArt() {
  return (
    <div className="dice-art" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <span className="art-spark spark-one">+</span>
      <span className="art-spark spark-two">+</span>
      <span className="art-dot" />
      <div className="die die-back">
        <i />
        <i />
        <i />
      </div>
      <div className="die die-front">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className={[0, 2, 4, 6, 8].includes(i) ? 'visible' : ''} />
        ))}
      </div>
      <span className="art-code code-one">{'</>'}</span>
      <span className="art-code code-two">.md</span>
    </div>
  );
}
function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          img: (props) =>
            String(props.src).startsWith('https://img.shields.io/') ? (
              <span className="readme-badge">
                <span>
                  {props.alt?.startsWith('Node')
                    ? 'runtime'
                    : props.alt === 'GitHub stars'
                      ? 'GitHub'
                      : props.alt?.includes('MIT')
                        ? 'license'
                        : 'built with'}
                </span>
                <strong>{props.alt}</strong>
              </span>
            ) : (
              <img {...props} alt={props.alt || ''} loading="lazy" referrerPolicy="no-referrer" />
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export default function Workspace() {
  const [view, setView] = useState<View>('dashboard');
  const [repos, setRepos] = useState<Repository[]>(demoRepos);
  const [session, setSession] = useState<{
    user: { login: string; avatar: string } | null;
    demo: boolean;
    configured: boolean;
    generationProvider?: string;
    ai?: AISettings;
  }>({ user: null, demo: true, configured: false });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [language, setLanguage] = useState('all');
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState<number[]>([]);
  const [grid, setGrid] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [repo, setRepo] = useState<Repository | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [markdown, setMarkdown] = useState('');
  const [profile, setProfile] = useState<Profile>('Professional');
  const [tone, setTone] = useState<Tone>('Personality');
  const [lastWriter, setLastWriter] = useState('');
  const [inspection, setInspection] = useState<GenerationInspection>([]);
  const [showInspection, setShowInspection] = useState(false);
  const [sections, setSections] = useState<string[]>([]);
  const [badges, setBadges] = useState(['language', 'license']);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<'connect' | 'diff' | 'history' | 'command' | null>(null);
  const [versions, setVersions] = useState<{ id: number; markdown: string; created_at: number }[]>(
    [],
  );
  const [publishMode, setPublishMode] = useState('pr');
  const [reviewed, setReviewed] = useState(false);
  const [portfolio, setPortfolio] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState('Overview');
  const [scanResults, setScanResults] = useState<{ repo: Repository; score: number }[]>([]);
  const [activity, setActivity] = useState<{ text: string; time: string }[]>([]);
  const [editorMode, setEditorMode] = useState('split');
  const [customize, setCustomize] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequest = useRef(0);
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  }
  function record(text: string) {
    setActivity((a) => [{ text, time: new Date().toISOString() }, ...a].slice(0, 50));
  }
  useEffect(() => {
    Promise.all([api('session'), api('repos')])
      .then(([s, r]) => {
        setSession(s);
        setRepos(r);
      })
      .catch((e) => notify(e.message));
    const savedTone = localStorage.getItem('rr:tone');
    if (savedTone && tones.includes(savedTone as Tone)) setTone(savedTone as Tone);
    if (new URLSearchParams(location.search).get('setup')) setModal('connect');
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModal((m) => (m === 'command' ? null : 'command'));
      }
      if (e.key === 'Escape') {
        setModal(null);
        setMobile(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector = 'button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]';
    const elements = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(selector) || []).filter(
        (el) => el.getClientRects().length > 0,
      );
    (modal === 'command' ? dialog?.querySelector<HTMLElement>('input') : elements()[0])?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = elements();
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', trap);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (repo && markdown) localStorage.setItem(`rr:draft:${repo.fullName}`, markdown);
  }, [markdown, repo]);
  const visible = useMemo(
    () =>
      repos
        .filter(
          (r) =>
            (r.name + ' ' + r.description).toLowerCase().includes(query.toLowerCase()) &&
            (filter === 'all' ||
              (filter === 'public' && !r.private) ||
              (filter === 'private' && r.private) ||
              (filter === 'missing' && r.readmeStatus === 'missing') ||
              (filter === 'outdated' && r.readmeStatus === 'outdated') ||
              (filter === 'attention' && r.score >= 0 && r.score < 75)) &&
            (language === 'all' || r.language === language),
        )
        .sort((a, b) =>
          sort === 'score'
            ? b.score - a.score
            : sort === 'stars'
              ? b.stars - a.stars
              : sort === 'language'
                ? a.language.localeCompare(b.language)
                : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [repos, query, filter, language, sort],
  );
  const scored = repos.filter((r) => r.score >= 0);
  const average = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + r.score, 0) / scored.length)
    : 0;
  const attention = repos.filter((r) => r.score >= 0 && r.score < 75).length;
  const score = analysis ? scoreRepository(analysis.repo, markdown) : null;
  const availableSections = analysis
    ? new DocumentationGenerator().sectionDrafts(analysis, profile, tone)
    : [];
  const headingFor = (id: string) => (analysis ? sectionTitle(id, productOf(analysis), tone) : id);
  function rememberTone(next: Tone) {
    setTone(next);
    localStorage.setItem('rr:tone', next);
  }
  function navigate(next: View) {
    activeRequest.current++;
    setBusy('');
    setView(next);
    setRepo(null);
    setAnalysis(null);
    setMobile(false);
    setQuery('');
    setFilter('all');
  }
  async function openRepo(r: Repository, refresh = false) {
    const request = ++activeRequest.current;
    setMobile(false);
    setRepo(r);
    setAnalysis(null);
    setTab('overview');
    setInspection([]);
    setLastWriter('');
    setShowInspection(false);
    setBusy('Inspecting repository');
    setMarkdown('');
    setTasks(JSON.parse(localStorage.getItem(`rr:tasks:${r.fullName}`) || '{}'));
    try {
      const a = await api('analyze', { repo: r.fullName, refresh });
      if (request !== activeRequest.current) return;
      setAnalysis(a);
      setSections(new DocumentationGenerator().defaultSections(a, profile, tone));
      setRepos((previous) =>
        previous.map((item) =>
          item.id === r.id
            ? {
                ...item,
                score: scoreRepository(r, a.readme).total,
                readmeStatus: a.readme ? 'complete' : 'missing',
              }
            : item,
        ),
      );
      setMarkdown(localStorage.getItem(`rr:draft:${r.fullName}`) || a.readme);
      const descriptions = await api('portfolio', { repo: r.fullName });
      if (request !== activeRequest.current) return;
      setPortfolio(descriptions);
      record(`Analyzed ${r.name}`);
    } catch (e) {
      if (request !== activeRequest.current) return;
      notify((e as Error).message);
      setRepo(null);
    } finally {
      if (request === activeRequest.current) setBusy('');
    }
  }
  async function generate(nextProfile = profile, nextTone = tone) {
    if (!repo || !analysis) return;
    const request = activeRequest.current;
    setBusy('Writing your README');
    try {
      const data = await api('generate', {
        repo: repo.fullName,
        profile: nextProfile,
        tone: nextTone,
        sections:
          nextProfile === profile
            ? sections
            : new DocumentationGenerator().defaultSections(analysis, nextProfile, nextTone),
        badges,
      });
      if (request !== activeRequest.current) return;
      setMarkdown(data.markdown);
      setLastWriter(
        data.writer || (data.provider === 'http' ? 'Workspace AI provider' : 'Local writer'),
      );
      setProfile(nextProfile);
      rememberTone(nextTone);
      setSections(data.sections.map((s: { id: string }) => s.id));
      setInspection(data.inspection);
      setTab('editor');
      record(`Generated a ${nextProfile.toLowerCase()} README for ${repo.name}`);
      notify(
        data.provider === 'local-fallback'
          ? 'AI copy did not pass the quality checks. Showing the grounded local draft instead.'
          : 'Your new README is ready. Make it yours.',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function scan() {
    const chosen = selected.length ? repos.filter((r) => selected.includes(r.id)) : repos;
    setSelected([]);
    setView('scan');
    setRepo(null);
    setScanResults([]);
    setBusy('Scanning repositories');
    for (const r of chosen) {
      try {
        const a: Analysis = await api('analyze', { repo: r.fullName });
        const result = scoreRepository(r, a.readme).total;
        setScanResults((s) => [...s, { repo: r, score: result }]);
        setRepos((prev) =>
          prev.map((p) =>
            p.id === r.id
              ? { ...p, score: result, readmeStatus: a.readme ? 'complete' : 'missing' }
              : p,
          ),
        );
      } catch (e) {
        notify(`${r.name}: ${(e as Error).message}`);
      }
    }
    setBusy('');
    record(`Completed health scan of ${chosen.length} repositories`);
    notify('Health scan complete. Your next project is waiting.');
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('Copied to clipboard');
    } catch {
      notify('Clipboard unavailable. Select and copy the text manually.');
    }
  }
  async function save() {
    if (!repo) return;
    try {
      await api('save', { repo: repo.fullName, markdown });
      record(`Saved a README version for ${repo.name}`);
      notify('Version saved. You can restore it from history.');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function download() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    link.download = 'README.md';
    link.click();
    URL.revokeObjectURL(link.href);
    notify('README.md downloaded');
  }
  async function history() {
    if (!repo) return;
    try {
      setVersions(await api(`versions?repo=${encodeURIComponent(repo.fullName)}`));
      setModal('history');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function toolbar(before: string, after = '') {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    setMarkdown(
      markdown.slice(0, start) + before + markdown.slice(start, end) + after + markdown.slice(end),
    );
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  }
  async function rewrite(instruction: string) {
    const el = editorRef.current;
    if (!el || !repo) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    if (start === end) {
      notify('Select some Markdown text to rewrite first.');
      return;
    }
    setBusy('Rewriting selection');
    try {
      const data = await api('rewrite', {
        repo: repo.fullName,
        text: markdown.slice(start, end),
        instruction,
        tone,
      });
      setMarkdown(markdown.slice(0, start) + data.text + markdown.slice(end));
      notify(
        data.provider === 'unchanged'
          ? 'No supported rewrite was found. Your selection is unchanged.'
          : data.provider === 'local-fallback'
            ? 'Provider copy did not pass review. Applied a local edit.'
            : data.provider === 'http'
              ? 'Selection updated and checked against product evidence.'
              : 'Selection updated using local editing rules.',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function toggleSection(name: string) {
    if (!analysis) return;
    const title = headingFor(name);
    if (sections.includes(name)) {
      setSections(sections.filter((s) => s !== name));
      setMarkdown((m) => replaceSection(m, title, null));
    } else {
      const text = new DocumentationGenerator().sections(analysis, profile, tone)[name];
      if (text) {
        setSections([...sections, name]);
        setMarkdown((m) => replaceSection(m, title, text));
      }
    }
  }
  async function regenerateSection(name: string) {
    if (!analysis || !repo) return;
    setBusy(`Rewriting ${headingFor(name)}`);
    try {
      const result = await api('generate', {
        repo: repo.fullName,
        profile,
        tone,
        sections: [name],
        badges: [],
      });
      const section = splitMarkdown(result.markdown).find((s) => s.title === headingFor(name));
      if (!section) {
        notify('There is not enough evidence for this section.');
        return;
      }
      setMarkdown((m) => replaceSection(m, section.title, section.body));
      setSections((previous) => (previous.includes(name) ? previous : [...previous, name]));
      setInspection((previous) => [
        ...previous.filter((s) => s.section !== section.title),
        ...result.inspection.filter((s: { section: string }) => s.section === section.title),
      ]);
      notify(`${section.title} regenerated`);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  function reorderSection(name: string, direction: number) {
    const blocks = splitMarkdown(markdown),
      index = blocks.findIndex((s) => s.title === headingFor(name)),
      next = index + direction;
    if (index < 1 || next < 1 || next >= blocks.length) return;
    [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
    setMarkdown(joinMarkdown(blocks));
    setSections(
      blocks
        .slice(1)
        .map((block) => availableSections.find((s) => s.title === block.title)?.id)
        .filter((id): id is string => !!id),
    );
  }
  async function publish() {
    if (!repo || !reviewed) return;
    setBusy('Publishing to GitHub');
    try {
      const result = await api('publish', {
        repo: repo.fullName,
        markdown,
        mode: publishMode,
        reviewed,
      });
      record(`Published README for ${repo.name}`);
      setModal(null);
      notify(`Published on branch ${result.branch}`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutGrid },
    { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
    { id: 'scan', label: 'Health scan', icon: Activity },
    { id: 'activity', label: 'Activity', icon: History },
  ] as const;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('dashboard');
          }}
        >
          <span className="brand-mark">
            <Dice5 size={22} />
          </span>
          <span>
            readme<span className="brand-light">roulette</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <button className="workspace-switch" onClick={() => setModal('connect')}>
          <span className="workspace-avatar">
            {session.user?.login.slice(0, 1).toUpperCase() || 'A'}
          </span>
          <span>
            <strong>{session.user?.login || 'Alex’s workspace'}</strong>
            <small>{session.demo ? 'Demo workspace' : 'Personal workspace'}</small>
          </span>
          <ChevronsUpDown size={14} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id && !repo ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.id === 'repositories' && <span className="nav-count">{repos.length}</span>}
              {item.id === 'scan' && <span className="new-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <span className="nav-label recent-heading">
          RECENT REPOSITORIES <span>↗</span>
        </span>
        <div className="recent-list">
          {repos.slice(0, 3).map((r) => (
            <button
              key={r.id}
              onClick={() => openRepo(r)}
              className={repo?.id === r.id ? 'selected' : ''}
            >
              <span className="language-dot" style={{ background: languageColors[r.language] }} />
              {r.name}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <Sparkles size={17} />
            </span>
            <strong>
              Good code deserves
              <br />
              great documentation.
            </strong>
            <p>
              Your next opportunity might
              <br />
              start with your README.
            </p>
            <button
              onClick={() => {
                const target = [...repos].sort((a, b) => a.score - b.score)[0];
                if (target) openRepo(target);
              }}
            >
              Give a repo some love <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings size={17} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => navigate('help')}>
            <BookOpen size={17} />
            <span>Help & documentation</span>
            <ArrowUpRight size={13} />
          </button>
          <button className="user-card" onClick={() => setModal('connect')}>
            <span className="user-avatar">
              {session.user?.login.slice(0, 2).toUpperCase() || 'AM'}
            </span>
            <span>
              <strong>{session.user?.login || 'Alex Morgan'}</strong>
              <small>
                <span className="connection-dot" />
                {session.demo ? 'Exploring demo' : 'GitHub connected'}
              </small>
            </span>
            <ChevronsUpDown size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle menu"
            >
              <Menu size={18} />
            </button>
            <FolderGit2 size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {repo
                ? repo.name
                : view === 'dashboard'
                  ? 'Overview'
                  : view === 'scan'
                    ? 'Health scan'
                    : view.charAt(0).toUpperCase() + view.slice(1)}
            </strong>
          </div>
          <div className="topbar-actions">
            <button className="search-shortcut" onClick={() => setModal('command')}>
              <Search size={15} />
              <span>Jump to a repository...</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-divider" />
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label="Open GitHub"
            >
              <Github size={18} />
            </a>
          </div>
        </header>
        <main>
          {!repo && (view === 'dashboard' || view === 'repositories') && (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">
                    <span /> YOUR CODE. BETTER DOCUMENTED.
                  </div>
                  <h1>
                    {view === 'dashboard'
                      ? 'A little polish. A lot of possibility.'
                      : 'Your repositories, all in one place.'}
                  </h1>
                  <p>
                    {view === 'dashboard'
                      ? 'Turn your side projects into your best first impression.'
                      : 'Every project has a story. Let’s make yours worth reading.'}
                  </p>
                </div>
                <button className="button primary" onClick={scan} disabled={!!busy}>
                  <Activity size={16} />
                  {busy ? 'Scanning…' : 'Run health scan'}
                  <span className="button-shortcut">↗</span>
                </button>
              </div>
              {view === 'dashboard' && (
                <>
                  <section className="hero-banner">
                    <div className="hero-content">
                      <span className="hero-kicker">
                        <Sparkles size={13} /> YOUR NEXT REPO GLOW-UP
                      </span>
                      <h2>
                        Great code.
                        <br />
                        Meet a great README.
                      </h2>
                      <p>
                        We read your code, connect the dots, and write the docs.
                        <br />
                        You take the credit. Your repositories deserve it.
                      </p>
                      <button
                        className="button light"
                        onClick={() => openRepo([...repos].sort((a, b) => a.score - b.score)[0])}
                      >
                        Let’s make something shine <ArrowRight size={15} />
                      </button>
                      <span className="hero-footnote">
                        <ShieldCheck size={12} /> Your code stays yours. Always.
                      </span>
                    </div>
                    <DiceArt />
                    <span className="banner-number">01 / ∞</span>
                  </section>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-label">
                        Total repositories
                        <FolderGit2 size={16} />
                      </div>
                      <div className="stat-value">
                        {repos.length}
                        <span className="stat-unit">repositories</span>
                      </div>
                      <div className="stat-foot">
                        <span className="mini-dots">
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                        {[...new Set(repos.map((r) => r.language))].length} languages, endless
                        potential
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">
                        Portfolio health
                        <Heart size={16} />
                      </div>
                      <div className="stat-value">
                        {average}
                        <span className="stat-denominator">/100</span>
                        <svg className="sparkline" viewBox="0 0 110 35">
                          <path d="M0 31L14 25L25 28L38 15L49 19L63 12L77 15L90 5L108 2" />
                        </svg>
                      </div>
                      <div className="stat-foot">
                        <span className="green-text">{scored.length} scored</span>
                        <span>Room to make it shine</span>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">
                        Looking good
                        <CheckCircle2 size={16} />
                      </div>
                      <div className="stat-value">
                        {repos.filter((r) => r.score >= 75).length}
                        <span className="stat-unit">portfolio-ready</span>
                        <div className="mini-bars">
                          {[30, 45, 38, 58, 52, 72, 80].map((n, i) => (
                            <i key={i} style={{ height: n + '%' }} />
                          ))}
                        </div>
                      </div>
                      <div className="stat-foot">
                        <span className="small-dot green-dot" />
                        Ready for their moment in the spotlight
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">
                        Could use some love
                        <WandSparkles size={16} />
                      </div>
                      <div className="stat-value">
                        {attention}
                        <span className="stat-unit">repositories</span>
                      </div>
                      <button
                        className="stat-link"
                        onClick={() => {
                          setFilter('attention');
                          searchRef.current?.focus();
                        }}
                      >
                        A little effort, a big difference <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
              <section className="repositories-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      Your repositories <span className="count-pill">{repos.length}</span>
                    </h2>
                    <p>
                      A bird’s-eye view of your documentation. A starting point for something
                      better.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={async () => {
                      setBusy('Syncing');
                      try {
                        setRepos(await api('repos'));
                        notify('Repositories are up to date');
                      } catch (e) {
                        notify((e as Error).message);
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    <RefreshCw size={13} className={busy === 'Syncing' ? 'spin' : ''} />
                    <span>Sync repositories</span>
                  </button>
                </div>
                <div className="table-tools">
                  <div className="repo-search">
                    <Search size={15} />
                    <input
                      ref={searchRef}
                      placeholder="Find a repository..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>/</kbd>
                  </div>
                  <div className="filter-select">
                    <SlidersHorizontal size={13} />
                    <select
                      aria-label="Filter repositories"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All repositories</option>
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                      <option value="missing">Missing README</option>
                      <option value="outdated">Outdated README</option>
                      <option value="attention">Needs attention</option>
                    </select>
                    <ChevronDown size={12} />
                  </div>
                  <div className="filter-select language-filter">
                    <span className="small-dot" />
                    <select
                      aria-label="Language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="all">All languages</option>
                      {[...new Set(repos.map((r) => r.language))].map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </div>
                  <div className="table-tools-right">
                    <div className="filter-select sort-select">
                      <ArrowDown size={13} />
                      <select
                        aria-label="Sort repositories"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="recent">Recently updated</option>
                        <option value="score">Highest score</option>
                        <option value="stars">Most stars</option>
                        <option value="language">Language</option>
                      </select>
                      <ChevronDown size={12} />
                    </div>
                    <div className="view-toggle">
                      <button
                        onClick={() => setGrid(false)}
                        className={!grid ? 'active' : ''}
                        aria-label="List view"
                      >
                        <List size={16} />
                      </button>
                      <button
                        onClick={() => setGrid(true)}
                        className={grid ? 'active' : ''}
                        aria-label="Grid view"
                      >
                        <LayoutGrid size={15} />
                      </button>
                    </div>
                  </div>
                </div>
                {selected.length > 0 && (
                  <div className="selection-bar">
                    <span>{selected.length} repositories selected</span>
                    <button onClick={scan}>
                      Analyze selected <ArrowRight size={14} />
                    </button>
                    <button onClick={() => setSelected([])}>Clear</button>
                  </div>
                )}
                <div className={grid ? 'repo-grid' : 'repo-table-wrap'}>
                  {grid ? (
                    visible.map((r) => (
                      <button className="repo-grid-card" key={r.id} onClick={() => openRepo(r)}>
                        <div>
                          <FolderGit2 size={20} />
                          <Score score={r.score} />
                        </div>
                        <h3>{r.name}</h3>
                        <p>{r.description}</p>
                        <div>
                          <span className="language-cell">
                            <i style={{ background: languageColors[r.language] }} />
                            {r.language}
                          </span>
                          <span>
                            <Star size={13} />
                            {r.stars}
                          </span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <table className="repo-table">
                      <thead>
                        <tr>
                          <th className="check-cell">
                            <input
                              type="checkbox"
                              aria-label="Select all visible repositories"
                              checked={
                                visible.length > 0 && visible.every((r) => selected.includes(r.id))
                              }
                              onChange={(e) =>
                                setSelected(e.target.checked ? visible.map((r) => r.id) : [])
                              }
                            />
                          </th>
                          <th>Repository</th>
                          <th>Language</th>
                          <th>
                            Makeover score <Info size={11} />
                          </th>
                          <th>Status</th>
                          <th>
                            Updated <ArrowDown size={11} />
                          </th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r) => (
                          <tr key={r.id}>
                            <td className="check-cell">
                              <input
                                type="checkbox"
                                aria-label={`Select ${r.name}`}
                                checked={selected.includes(r.id)}
                                onChange={() =>
                                  setSelected((prev) =>
                                    prev.includes(r.id)
                                      ? prev.filter((id) => id !== r.id)
                                      : [...prev, r.id],
                                  )
                                }
                              />
                            </td>
                            <td>
                              <button className="repo-name" onClick={() => openRepo(r)}>
                                <span className="repo-folder">
                                  <FolderGit2 size={17} />
                                </span>
                                <span>
                                  <strong>
                                    {r.name}
                                    {r.private && <Lock size={11} />}
                                    <span className="star-count">
                                      <Star size={11} />
                                      {r.stars}
                                    </span>
                                  </strong>
                                  <small>{r.description}</small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <span className="language-cell">
                                <i style={{ background: languageColors[r.language] }} />
                                {r.language}
                              </span>
                            </td>
                            <td>
                              <div className="score-cell">
                                <Score score={r.score} />
                                <span>/ 100</span>
                              </div>
                            </td>
                            <td>
                              <span className={`status-badge ${health(r.score).className}`}>
                                <i />
                                {health(r.score).label}
                              </span>
                            </td>
                            <td className="updated-cell">{timeAgo(r.updatedAt)}</td>
                            <td>
                              <button
                                className="row-action"
                                onClick={() => openRepo(r)}
                                aria-label={`Open ${r.name}`}
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {visible.length === 0 && (
                    <div className="empty-state">
                      <Search size={28} />
                      <h3>No repositories found</h3>
                      <p>Try a different search or clear your filters.</p>
                      <button
                        className="button"
                        onClick={() => {
                          setQuery('');
                          setFilter('all');
                          setLanguage('all');
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  <span>
                    Showing {visible.length} of {repos.length} repositories
                  </span>
                  <span>
                    <span className="small-dot green-dot" />
                    {session.demo ? 'Sample data · Demo workspace' : 'Connected to GitHub'}
                    <span className="footer-separator">·</span>All changes are yours to approve
                  </span>
                </div>
              </section>
              <div className="page-footer">
                <span>
                  <Dice5 size={13} /> Built for the projects you believe in.
                </span>
                <span>A little less roulette. A lot more README.</span>
              </div>
            </>
          )}
          {!repo && view === 'scan' && (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">A CHECKUP FOR YOUR CODE</div>
                  <h1>Every repo has potential.</h1>
                  <p>Find the projects that would benefit most from a little attention.</p>
                </div>
                <button className="button primary" onClick={scan} disabled={!!busy}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Activity size={16} />}{' '}
                  {busy || 'Scan all repositories'}
                </button>
              </div>
              <div className="scan-banner">
                <Activity size={36} />
                <div>
                  <h2>
                    {scanResults.length
                      ? `${scanResults.length} repositories inspected`
                      : 'Your portfolio, under the microscope.'}
                  </h2>
                  <p>Actual README content. Transparent criteria. Actionable next steps.</p>
                </div>
                {busy && <Loader2 className="spin" />}
              </div>
              <div className="scan-results">
                {scanResults.length ? (
                  scanResults
                    .sort((a, b) => a.score - b.score)
                    .map((result) => (
                      <button
                        key={result.repo.id}
                        className="scan-result"
                        onClick={() => openRepo(result.repo)}
                      >
                        <Score score={result.score} />
                        <span>
                          <strong>{result.repo.name}</strong>
                          <small>
                            {health(result.score).label} · Inspect the score breakdown to see what’s
                            missing.
                          </small>
                        </span>
                        <span className="button">
                          Open repository <ArrowRight size={14} />
                        </span>
                      </button>
                    ))
                ) : (
                  <div className="empty-state">
                    <ShieldCheck size={36} />
                    <h3>Good documentation starts with a closer look.</h3>
                    <p>
                      Run a health scan to evaluate README completeness, setup, screenshots, and
                      more.
                    </p>
                    <button className="button" onClick={scan}>
                      Run your first scan <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {!repo && view === 'activity' && (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">SMALL STEPS, BETTER PROJECTS</div>
                  <h1>Your documentation journey.</h1>
                  <p>Analyses, generated READMEs, and saved versions from this session.</p>
                </div>
              </div>
              {activity.length ? (
                <div className="activity-list">
                  {activity.map((a, i) => (
                    <div key={i}>
                      <span className="activity-icon">
                        <History size={17} />
                      </span>
                      <span>{a.text}</span>
                      <small>
                        {new Date(a.time).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <History size={32} />
                  <h3>A fresh start.</h3>
                  <p>Open a repository to kick off your first makeover.</p>
                  <button className="button" onClick={() => navigate('repositories')}>
                    Explore repositories
                  </button>
                </div>
              )}
            </>
          )}
          {!repo && view === 'settings' && (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                  <h1>Workspace settings.</h1>
                  <p>Your connection, your preferences, your code.</p>
                </div>
              </div>
              <div className="settings-card">
                <div className="settings-heading">
                  <Github size={24} />
                  <div>
                    <h3>GitHub connection</h3>
                    <p>
                      {session.demo
                        ? 'Explore sample repositories, or connect your own account.'
                        : `Signed in as ${session.user?.login}. Tokens are stored encrypted on the server.`}
                    </p>
                  </div>
                  <span className={`status-badge ${session.demo ? 'yellow' : 'green'}`}>
                    {session.demo ? 'Demo mode' : 'Connected'}
                  </span>
                </div>
                <button className="button primary" onClick={() => setModal('connect')}>
                  {session.demo ? 'Connect GitHub' : 'Manage permissions'}
                  <ArrowUpRight size={15} />
                </button>
                {!session.demo && (
                  <button
                    className="button"
                    onClick={async () => {
                      await api('auth/logout', {});
                      location.reload();
                    }}
                  >
                    <LogOut size={15} />
                    Disconnect
                  </button>
                )}
              </div>
              <AISettingsCard
                signedIn={!session.demo}
                settings={session.ai || { configured: false }}
                onChange={async () => setSession(await api('session'))}
                onConnect={() => setModal('connect')}
              />
              <div className="settings-card">
                <h3>README personality</h3>
                <p>Choose how your project introduces itself. Personality is the default.</p>
                <TonePicker value={tone} onChange={rememberTone} />
                <h3 className="profile-subheading">Documentation profile</h3>
                <p>Choose the depth and audience independently of the writing tone.</p>
                <div className="profile-grid">
                  {profiles.map((p) => (
                    <button
                      className={profile === p ? 'selected' : ''}
                      key={p}
                      onClick={() => {
                        setProfile(p);
                        notify(`${p} is now your default profile`);
                      }}
                    >
                      <Sparkles size={17} />
                      {p}
                      {profile === p && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-card">
                <ShieldCheck size={22} />
                <h3>Private by design</h3>
                <p>
                  Repository files are read on the server. Sensitive paths are excluded. Templates
                  contribute variable names only. Publishing always requires a reviewed diff.
                </p>
                <p className="muted">
                  {session.generationProvider !== 'local'
                    ? 'Your configured documentation provider receives normalized project evidence. Full source files are not sent.'
                    : 'Generation uses a deterministic local provider. No repository code is sent to a third-party AI service.'}
                </p>
              </div>
            </>
          )}
          {!repo && view === 'help' && (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">A LITTLE GUIDANCE</div>
                  <h1>From repo to ready.</h1>
                  <p>A better README, grounded in your actual code.</p>
                </div>
              </div>
              <div className="help-grid">
                {[
                  [
                    '01',
                    'Connect & discover',
                    'Connect GitHub or explore the demo. Search, filter, and sort repositories to find your next makeover.',
                  ],
                  [
                    '02',
                    'Inspect the evidence',
                    'Open a repository to inspect manifests, dependencies, scripts, and configuration. Every finding links to a source path.',
                  ],
                  [
                    '03',
                    'Find your voice',
                    'Choose a profile, generate documentation, and edit Markdown with a live preview. Toggle badges and rearrange sections.',
                  ],
                  [
                    '04',
                    'Review & publish',
                    'Compare the exact diff, save a version, and download or publish. A new branch and pull request is the default.',
                  ],
                ].map(([n, t, d]) => (
                  <div className="settings-card" key={n}>
                    <span className="step-number">{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
              <div className="settings-card">
                <h3>How the score works</h3>
                <p>
                  Documentation completeness (20), screenshots (12), architecture (10), setup (14),
                  license (8), testing (8), repository description (8), topics (5), release
                  information (5), contribution guide (5), and project structure (5). Scores measure
                  documented coverage, not software quality. Demo dashboard scores are illustrative
                  until you run a scan.
                </p>
              </div>
            </>
          )}
          {repo && (
            <>
              <div className="repo-page-header">
                <button className="back-link" onClick={() => navigate('repositories')}>
                  <ArrowLeft size={14} />
                  All repositories
                </button>
                <div className="page-title">
                  <div>
                    <div className="eyebrow">
                      <Github size={12} />
                      {repo.fullName.split('/')[0]}
                      <span className="public-label">
                        {repo.private ? 'PRIVATE' : 'PUBLIC'}
                        {repo.demo ? ' · DEMO' : ''}
                      </span>
                    </div>
                    <h1>
                      {repo.name}
                      <a
                        href={`https://github.com/${repo.fullName}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open repository on GitHub"
                      >
                        <ArrowUpRight size={20} />
                      </a>
                    </h1>
                    <p>{repo.description}</p>
                  </div>
                  <div className="repo-header-buttons">
                    <button
                      className="button"
                      aria-label="Reanalyze repository"
                      title="Reanalyze repository"
                      disabled={!!busy}
                      onClick={() => openRepo(repo, true)}
                    >
                      <RefreshCw size={15} />
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        setModal('diff');
                        setReviewed(false);
                      }}
                      disabled={!analysis}
                    >
                      <GitPullRequest size={15} />
                      Review & publish
                    </button>
                    <button
                      className="button primary"
                      onClick={() => generate()}
                      disabled={!!busy || !analysis}
                    >
                      {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                      Generate README
                    </button>
                  </div>
                </div>
              </div>
              <div className="repo-tabs">
                {(
                  [
                    { id: 'overview', title: 'Overview', icon: LayoutGrid },
                    { id: 'analysis', title: 'Architecture explorer', icon: Network },
                    { id: 'editor', title: 'README editor', icon: FileText },
                    { id: 'portfolio', title: 'Portfolio copy', icon: Sparkles },
                    { id: 'screenshots', title: 'Screenshots', icon: Camera },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={tab === t.id ? 'active' : ''}
                  >
                    <t.icon size={15} />
                    {t.title}
                  </button>
                ))}
                <span>
                  <GitBranch size={12} />
                  {repo.defaultBranch}
                </span>
              </div>
              {!analysis ? (
                <div className="analysis-loading">
                  <div className="loading-dice">
                    <Dice5 size={32} />
                  </div>
                  <h2>Reading between the lines.</h2>
                  <p>Inspecting manifests, source files, and project configuration…</p>
                  <div className="loading-track">
                    <span />
                  </div>
                </div>
              ) : (
                <>
                  {tab === 'overview' && (
                    <div className="repo-overview">
                      <div className="overview-main">
                        <div className="insight-card">
                          <div className="card-heading">
                            <h3>
                              <ShieldCheck size={17} />
                              Repository inspected
                            </h3>
                            <span className="status-badge green">Analysis complete</span>
                          </div>
                          <p>Here’s what your code tells us. Every finding has a source.</p>
                          <div className="analysis-stat-row">
                            <div>
                              <strong>{analysis.files.length}</strong>
                              <span>files discovered</span>
                            </div>
                            <div>
                              <strong>{analysis.inspected}</strong>
                              <span>files inspected</span>
                            </div>
                            <div>
                              <strong>{analysis.evidence.length}</strong>
                              <span>verified findings</span>
                            </div>
                            <div>
                              <strong>{analysis.env.length}</strong>
                              <span>environment variables</span>
                            </div>
                          </div>
                          <div className="tech-chips">
                            {analysis.evidence
                              .filter((e) => e.category === 'Tech Stack')
                              .slice(0, 8)
                              .map((e, i) => (
                                <span key={i}>
                                  <Code2 size={13} />
                                  {e.name}
                                </span>
                              ))}
                          </div>
                          <button className="text-button" onClick={() => setTab('analysis')}>
                            Explore the evidence <ArrowRight size={14} />
                          </button>
                        </div>
                        <div className="insight-card">
                          <div className="card-heading">
                            <h3>
                              <Sparkles size={17} />
                              Small changes, real impact
                            </h3>
                            <span className="muted">NEXT STEPS</span>
                          </div>
                          {score?.criteria
                            .filter((c) => !c.earned)
                            .slice(0, 5)
                            .map((c) => (
                              <button
                                className="recommendation"
                                key={c.label}
                                onClick={() =>
                                  c.label === 'Screenshots' ? setTab('screenshots') : generate()
                                }
                              >
                                <span className="points">+{c.points}</span>
                                <div>
                                  <strong>{c.label}</strong>
                                  <p>{c.recommendation}</p>
                                </div>
                                <ChevronRight size={16} />
                              </button>
                            ))}
                        </div>
                        <div className="insight-card existing-readme">
                          <div className="card-heading">
                            <h3>
                              <FileText size={16} />
                              Current README
                            </h3>
                            <button className="text-button" onClick={() => setTab('editor')}>
                              Open editor <ArrowUpRight size={13} />
                            </button>
                          </div>
                          {analysis.readme ? (
                            <Markdown text={analysis.readme} />
                          ) : (
                            <div className="empty-state compact">
                              <FileText size={24} />
                              <p>A blank canvas. Let’s write something good.</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <aside className="overview-side">
                        <div className="health-card">
                          <span className="eyebrow">REPO MAKEOVER SCORE</span>
                          <Score score={score?.total || 0} large />
                          <h3>{health(score?.total || 0).label}</h3>
                          <p>
                            {markdown !== analysis.readme
                              ? 'Draft documentation score'
                              : 'Current documentation score'}
                          </p>
                          <div className="criteria-list">
                            {score?.criteria.map((c) => (
                              <div key={c.label}>
                                <span>{c.label}</span>
                                <strong className={c.earned ? 'green-text' : ''}>
                                  {c.earned}/{c.points}
                                </strong>
                                <i>
                                  <b style={{ width: `${(c.earned / c.points) * 100}%` }} />
                                </i>
                              </div>
                            ))}
                          </div>
                          <small>11 transparent criteria. No guesswork.</small>
                        </div>
                        <div className="safe-note">
                          <ShieldCheck size={17} />
                          <p>Nothing changes on GitHub until you review and publish.</p>
                        </div>
                      </aside>
                    </div>
                  )}
                  {tab === 'analysis' && (
                    <div className="explorer">
                      <aside className="explorer-nav">
                        {[
                          'Overview',
                          'Tech Stack',
                          'Architecture',
                          'Dependencies',
                          'Scripts',
                          'Environment Variables',
                          'API',
                          'Database',
                          'Deployment',
                          'Testing',
                        ].map((c) => (
                          <button
                            key={c}
                            className={category === c ? 'active' : ''}
                            onClick={() => setCategory(c)}
                          >
                            {c}
                            <span>
                              {analysis.evidence.filter((e) => e.category === c).length || ''}
                            </span>
                          </button>
                        ))}
                      </aside>
                      <div className="explorer-content">
                        <div className="section-heading">
                          <div>
                            <h2>{category}</h2>
                            <p>Discovered from repository files. Source references included.</p>
                          </div>
                          <span className="status-badge green">
                            <i />
                            Evidence-based
                          </span>
                        </div>
                        {category === 'Overview' ? (
                          <>
                            <div className="evidence-summary">
                              <FileText size={24} />
                              <h3>{analysis.inspected} files, one clearer picture.</h3>
                              <p>
                                Select a category to inspect the technologies, scripts, and
                                configuration found in this repository.
                              </p>
                            </div>
                            <h4>Discovered file structure</h4>
                            <pre className="file-tree">
                              {analysis.files
                                .slice(0, 60)
                                .map((p) => `├── ${p}`)
                                .join('\n')}
                            </pre>
                            <div className="analysis-limit">
                              <Info size={16} />
                              <p>{analysis.limitations.join(' ')}</p>
                            </div>
                          </>
                        ) : category === 'Architecture' ? (
                          <>
                            <div className="architecture-map">
                              <div>
                                <FolderGit2 />
                                <strong>{repo.name}</strong>
                                <small>Repository</small>
                              </div>
                              <span>contains</span>
                              <div className="architecture-children">
                                {[
                                  ...new Set(
                                    analysis.files
                                      .filter((p) => p.includes('/'))
                                      .map((p) => p.split('/')[0]),
                                  ),
                                ]
                                  .slice(0, 5)
                                  .map((p) => (
                                    <div key={p}>
                                      <Layers size={18} />
                                      <strong>{p}/</strong>
                                      <small>Directory</small>
                                    </div>
                                  ))}
                              </div>
                            </div>
                            <div className="analysis-limit">
                              <Info size={16} />
                              <p>
                                This map shows verified directory containment. Runtime component
                                relationships are unknown and are not inferred from dependencies.
                              </p>
                            </div>
                          </>
                        ) : analysis.evidence.filter((e) => e.category === category).length ? (
                          <div className="evidence-list">
                            {analysis.evidence
                              .filter((e) => e.category === category)
                              .map((e, i) => (
                                <div className="evidence-row" key={i}>
                                  <span className="evidence-icon">
                                    <Braces size={17} />
                                  </span>
                                  <div>
                                    <strong>{e.name}</strong>
                                    <p>{e.value}</p>
                                  </div>
                                  <a
                                    href={
                                      repo.demo
                                        ? undefined
                                        : `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${e.source}`
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="source-link"
                                  >
                                    <FileText size={12} />
                                    {e.source}
                                    {!repo.demo && <ArrowUpRight size={12} />}
                                  </a>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="empty-state">
                            <Search size={26} />
                            <h3>Unknown, and that’s okay.</h3>
                            <p>
                              No confident evidence for {category.toLowerCase()} was found in the
                              inspected files.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {tab === 'editor' && (
                    <div className="editor-workspace">
                      <TonePicker
                        value={tone}
                        onChange={(next) => generate(profile, next)}
                        disabled={!!busy}
                      />
                      <div className="editor-controls">
                        <div className="filter-select profile-select">
                          <Sparkles size={14} />
                          <select
                            aria-label="README profile"
                            value={profile}
                            onChange={(e) => generate(e.target.value as Profile)}
                          >
                            {profiles.map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} />
                        </div>
                        <button
                          className={`button small ${customize ? 'selected' : ''}`}
                          onClick={() => setCustomize(!customize)}
                        >
                          <SlidersHorizontal size={13} />
                          Customize
                        </button>
                        {inspection.length > 0 && (
                          <button
                            className={`button small evidence-toggle ${showInspection ? 'selected' : ''}`}
                            onClick={() => setShowInspection(!showInspection)}
                            aria-expanded={showInspection}
                          >
                            <ShieldCheck size={13} />
                            <span>Why this copy?</span>
                          </button>
                        )}
                        <div className="editor-actions">
                          <button
                            className="icon-button"
                            title="Version history"
                            aria-label="Version history"
                            onClick={history}
                          >
                            <History size={16} />
                          </button>
                          <button
                            className="icon-button"
                            title="Copy Markdown"
                            aria-label="Copy Markdown"
                            onClick={() => copy(markdown)}
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            className="icon-button"
                            title="Download README"
                            aria-label="Download README"
                            onClick={download}
                          >
                            <Download size={16} />
                          </button>
                          <button className="button small" onClick={save}>
                            <Check size={14} />
                            Save version
                          </button>
                        </div>
                      </div>
                      {showInspection && <GenerationInspector inspection={inspection} />}
                      {customize && (
                        <div className="customize-panel">
                          <div>
                            <h4>README sections</h4>
                            <div className="section-controls">
                              {sections
                                .concat(
                                  availableSections
                                    .map((s) => s.id)
                                    .filter((s) => !sections.includes(s)),
                                )
                                .map((s) => (
                                  <div key={s}>
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={sections.includes(s)}
                                        onChange={() => toggleSection(s)}
                                      />
                                      {headingFor(s)}
                                    </label>
                                    <button
                                      className="icon-button"
                                      aria-label={`Move ${s} up`}
                                      onClick={() => reorderSection(s, -1)}
                                    >
                                      <ArrowUp size={11} />
                                    </button>
                                    <button
                                      className="icon-button"
                                      aria-label={`Move ${s} down`}
                                      onClick={() => reorderSection(s, 1)}
                                    >
                                      <ArrowDown size={11} />
                                    </button>
                                    <button
                                      className="icon-button"
                                      aria-label={`Regenerate ${s}`}
                                      onClick={() => regenerateSection(s)}
                                    >
                                      <RefreshCw size={11} />
                                    </button>
                                  </div>
                                ))}
                            </div>
                          </div>
                          <div>
                            <h4>Useful badges, no fluff</h4>
                            <p>Only badges supported by repository evidence.</p>
                            <div className="badge-options">
                              {badgeOptions(analysis)
                                .filter((b) => b.available)
                                .map((b) => (
                                  <label key={b.id}>
                                    <input
                                      type="checkbox"
                                      checked={badges.includes(b.id)}
                                      onChange={() => {
                                        const active = badges.includes(b.id);
                                        setBadges((prev) =>
                                          active
                                            ? prev.filter((id) => id !== b.id)
                                            : [...prev, b.id],
                                        );
                                        const syntax = `![${b.label}](${b.url})`;
                                        setMarkdown((m) =>
                                          active
                                            ? m.replace(syntax, '')
                                            : m.replace(/^(# .+\n)/, `$1\n${syntax}\n`),
                                        );
                                      }}
                                    />
                                    <span className="readme-badge">
                                      <span>{b.id}</span>
                                      <strong>{b.label}</strong>
                                    </span>
                                  </label>
                                ))}
                            </div>
                            <p className="local-provider-note">
                              <ShieldCheck size={13} />
                              {session.ai?.configured
                                ? `${aiProviderLabels[session.ai.provider!]} · ${session.ai.model}`
                                : session.generationProvider === 'http'
                                  ? 'Workspace AI provider'
                                  : 'Product-aware local generation'}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="editor-topline">
                        <div>
                          <FileText size={14} />
                          <span>README.md</span>
                          {lastWriter && (
                            <span
                              className="writer-label"
                              title="Writer used for the last full generation"
                            >
                              {lastWriter}
                            </span>
                          )}
                          <span className="unsaved-dot" />
                        </div>
                        <div className="view-toggle">
                          {['source', 'split', 'preview'].map((m) => (
                            <button
                              key={m}
                              onClick={() => setEditorMode(m)}
                              className={editorMode === m ? 'active' : ''}
                            >
                              {m === 'source' ? (
                                <Code2 size={13} />
                              ) : m === 'preview' ? (
                                <Eye size={13} />
                              ) : (
                                <PanelLeftClose size={13} />
                              )}
                              <span>{m}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="markdown-toolbar">
                        <button onClick={() => toolbar('**', '**')} title="Bold">
                          <b>B</b>
                        </button>
                        <button onClick={() => toolbar('_', '_')} title="Italic">
                          <i>I</i>
                        </button>
                        <button onClick={() => toolbar('## ')} title="Heading">
                          H₂
                        </button>
                        <span />
                        <button onClick={() => toolbar('[', '](https://)')} title="Link">
                          <ExternalLink size={13} />
                        </button>
                        <button onClick={() => toolbar('`', '`')} title="Inline code">
                          <Code2 size={15} />
                        </button>
                        <button onClick={() => toolbar('- ')} title="List">
                          <List size={14} />
                        </button>
                        <span />
                        <select
                          aria-label="Rewrite selected text"
                          value=""
                          onChange={(e) => rewrite(e.target.value)}
                        >
                          <option value="" disabled>
                            Refine selection…
                          </option>
                          {[
                            'Shorten',
                            'Expand',
                            'Make more technical',
                            'Make more casual',
                            'Fix grammar',
                          ].map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                        <span className="toolbar-hint">{busy || 'Markdown, made yours.'}</span>
                      </div>
                      <div className={`editor-panes mode-${editorMode}`}>
                        {editorMode !== 'preview' && (
                          <div className="source-pane">
                            <div className="line-numbers" aria-hidden="true">
                              {markdown.split('\n').map((_, i) => (
                                <span key={i}>{i + 1}</span>
                              ))}
                            </div>
                            <MarkdownSource text={markdown} />
                            <textarea
                              style={{
                                height: Math.max(590, markdown.split('\n').length * 22 + 44),
                              }}
                              ref={editorRef}
                              aria-label="README Markdown source"
                              spellCheck={false}
                              value={markdown}
                              onChange={(e) => setMarkdown(e.target.value)}
                            />
                          </div>
                        )}
                        {editorMode !== 'source' && (
                          <div className="preview-pane">
                            <Markdown text={markdown} />
                          </div>
                        )}
                      </div>
                      <div className="editor-status">
                        <span>
                          <span className="small-dot green-dot" />
                          Draft saved in this browser
                        </span>
                        <span>
                          {markdown.split(/\s+/).filter(Boolean).length} words <span>·</span>{' '}
                          Markdown <span>·</span> UTF-8
                        </span>
                      </div>
                    </div>
                  )}
                  {tab === 'portfolio' && (
                    <>
                      <div className="section-heading portfolio-heading">
                        <div>
                          <h2>Your project. The right words.</h2>
                          <p>
                            Copy for your portfolio, resume, and everywhere your work deserves to be
                            seen.
                          </p>
                        </div>
                        <span className="status-badge neutral">
                          Grounded in repository evidence
                        </span>
                      </div>
                      <div className="portfolio-grid">
                        {Object.entries(portfolio).map(([title, text], i) => (
                          <div className={`portfolio-card ${i === 2 ? 'wide' : ''}`} key={title}>
                            <div>
                              <span className="eyebrow">0{i + 1}</span>
                              <button
                                className="icon-button"
                                aria-label={`Copy ${title}`}
                                onClick={() => copy(text)}
                              >
                                <Copy size={15} />
                              </button>
                            </div>
                            <h3>{title}</h3>
                            <p>{text}</p>
                            <span className="copy-meta">
                              {text.length} characters
                              {title === 'GitHub description' ? ' / 350' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {tab === 'screenshots' && (
                    <>
                      <div className="section-heading portfolio-heading">
                        <div>
                          <h2>Show what words can’t.</h2>
                          <p>A few thoughtful screenshots can bring your project to life.</p>
                        </div>
                        <span className="status-badge green">
                          {Object.values(tasks).filter(Boolean).length} / 6 completed
                        </span>
                      </div>
                      <div className="screenshot-layout">
                        <div className="screenshot-list">
                          {[
                            'Main dashboard',
                            'Primary workflow',
                            'Repository analysis or results',
                            'Mobile layout',
                            'Error state',
                            'Settings and configuration',
                          ].map((task, i) => (
                            <div
                              className={`screenshot-task ${tasks[task] ? 'done' : ''}`}
                              key={task}
                            >
                              <button
                                className="task-check"
                                aria-label={`Mark ${task} ${tasks[task] ? 'incomplete' : 'complete'}`}
                                onClick={async () => {
                                  const next = { ...tasks, [task]: !tasks[task] };
                                  setTasks(next);
                                  localStorage.setItem(
                                    `rr:tasks:${repo.fullName}`,
                                    JSON.stringify(next),
                                  );
                                  try {
                                    await api('screenshots', { repo: repo.fullName, tasks: next });
                                  } catch (e) {
                                    notify((e as Error).message);
                                  }
                                }}
                              >
                                {tasks[task] ? <CheckCircle2 size={21} /> : <Circle size={21} />}
                              </button>
                              <div>
                                <strong>{task}</strong>
                                <p>
                                  {
                                    [
                                      'Give visitors a feel for the primary experience.',
                                      'Show the project doing what it does best.',
                                      'Make the value of your output visible.',
                                      'Show how the experience adapts to a smaller screen.',
                                      'Demonstrate a thoughtful recovery experience.',
                                      'Capture the controls that make the project useful.',
                                    ][i]
                                  }
                                </p>
                              </div>
                              <button
                                className="icon-button"
                                aria-label={`Insert ${task} screenshot placeholder`}
                                onClick={() => {
                                  setMarkdown(
                                    (m) =>
                                      m +
                                      `\n### ${task}\n\n![${task}](docs/screenshots/${task.toLowerCase().replaceAll(' ', '-')}.png)\n`,
                                  );
                                  notify(
                                    'Image Markdown inserted. Add the matching image file to your repository.',
                                  );
                                }}
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="screenshot-guide">
                          <Camera size={28} />
                          <h3>Give your project a face.</h3>
                          <p>
                            Use consistent dimensions, real content, and a clean browser window.
                            Focus each image on one thing.
                          </p>
                          <div>
                            <span>Recommended format</span>
                            <strong>PNG or WebP · 1600 × 1000</strong>
                          </div>
                          <p className="muted">
                            The + button inserts an image path into your README. Add the matching
                            file to your repository before publishing.
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === 'diff' ? 'diff-modal' : ''} ${modal === 'command' ? 'command-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'connect'
                ? 'Connect GitHub'
                : modal === 'diff'
                  ? 'Review README changes'
                  : modal === 'history'
                    ? 'Version history'
                    : 'Jump to repository'
            }
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={18} />
            </button>
            {modal === 'connect' && (
              <>
                <span className="modal-emblem">
                  <Github size={30} />
                </span>
                <h2>Your code. Your next chapter.</h2>
                <p>Connect GitHub to find the potential hiding in your repositories.</p>
                {!session.configured ? (
                  <>
                    <div className="setup-note">
                      <Terminal size={17} />
                      <div>
                        <strong>A little setup, then you’re in.</strong>
                        <p>
                          Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and SESSION_SECRET in your
                          server’s .env.local file, then restart.
                        </p>
                        <code>Callback: /api/auth/callback</code>
                      </div>
                    </div>
                    <button className="button primary full-width" onClick={() => setModal(null)}>
                      Keep exploring the demo <ArrowRight size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <a className="button primary full-width" href="/api/auth/github">
                      <Github size={16} />
                      Connect GitHub
                    </a>
                    <a className="button full-width" href="/api/auth/github?scope=private">
                      <Lock size={14} />
                      Include private repositories
                    </a>
                    <a
                      className="text-button permission-link"
                      href="/api/auth/github?scope=publish"
                    >
                      Enable publishing to public repositories <ArrowUpRight size={13} />
                    </a>
                  </>
                )}
                <div className="connection-explainer">
                  <ShieldCheck size={15} />
                  <p>
                    Sign-in requests public profile access. Private repository access and publishing
                    request additional GitHub permissions. Tokens stay on the server.
                  </p>
                </div>
              </>
            )}
            {modal === 'command' && (
              <>
                <div className="command-input">
                  <Search size={20} />
                  <input
                    autoFocus
                    placeholder="Jump to a repository…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <kbd>ESC</kbd>
                </div>
                <span className="nav-label">REPOSITORIES</span>
                <div className="command-results">
                  {repos
                    .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
                    .map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setModal(null);
                          setQuery('');
                          openRepo(r);
                        }}
                      >
                        <FolderGit2 size={17} />
                        <span>
                          {r.name}
                          <small>{r.language}</small>
                        </span>
                        <Score score={r.score} />
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                </div>
              </>
            )}
            {modal === 'history' && (
              <>
                <h2>A little peace of mind.</h2>
                <p>Saved README versions. Restore any version to your editor.</p>
                <div className="version-list">
                  {versions.length ? (
                    versions.map((v) => (
                      <div key={v.id}>
                        <History size={17} />
                        <div>
                          <strong>Version {v.id}</strong>
                          <small>
                            {new Date(v.created_at).toLocaleString()} · {v.markdown.length}{' '}
                            characters
                          </small>
                        </div>
                        <button
                          className="button small"
                          onClick={() => {
                            setMarkdown(v.markdown);
                            setModal(null);
                            notify('Version restored to the editor');
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">
                      <History size={28} />
                      <p>No versions yet. Use “Save version” in the editor to keep a checkpoint.</p>
                    </div>
                  )}
                </div>
              </>
            )}
            {modal === 'diff' && analysis && (
              <>
                <div className="diff-heading">
                  <span className="modal-emblem small">
                    <GitPullRequest size={22} />
                  </span>
                  <div>
                    <h2>A better README starts here.</h2>
                    <p>Review the exact changes before they leave your workspace.</p>
                  </div>
                </div>
                <div className="diff-file-heading">
                  <FileText size={14} />
                  {analysis.readmePath}
                  <span className="green-text">
                    +
                    {diffLines(analysis.readme, markdown)
                      .filter((p) => p.added)
                      .reduce((n, p) => n + (p.count || 0), 0)}
                  </span>
                  <span className="red-text">
                    −
                    {diffLines(analysis.readme, markdown)
                      .filter((p) => p.removed)
                      .reduce((n, p) => n + (p.count || 0), 0)}
                  </span>
                </div>
                <div className="diff-content">
                  {diffLines(analysis.readme, markdown).map((part, i) => (
                    <pre
                      key={i}
                      className={
                        part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-unchanged'
                      }
                    >
                      {part.value
                        .split('\n')
                        .filter((l, j, arr) => j < arr.length - 1 || l)
                        .map((line, j) => (
                          <span key={j}>
                            <b>{part.added ? '+' : part.removed ? '−' : ' '}</b>
                            {line || ' '}
                          </span>
                        ))}
                    </pre>
                  ))}
                </div>
                <details className="accept-sections">
                  <summary>Choose sections to accept</summary>
                  <div>
                    {markdown
                      .split(/(?=^## )/m)
                      .filter((s) => s.startsWith('## '))
                      .map((s) => {
                        const title = s.split('\n')[0].slice(3);
                        return (
                          <button
                            key={title}
                            className="button small"
                            onClick={() => {
                              const old = analysis.readme
                                .split(/(?=^## )/m)
                                .find((p) => p.startsWith(`## ${title}\n`));
                              setMarkdown((m) => m.replace(s, old || ''));
                              notify(`${title} reverted to the existing README`);
                            }}
                          >
                            Revert {title}
                          </button>
                        );
                      })}
                  </div>
                </details>
                <div className="publish-options">
                  <div className="filter-select">
                    <GitBranch size={15} />
                    <select
                      aria-label="Publish mode"
                      value={publishMode}
                      onChange={(e) => setPublishMode(e.target.value)}
                    >
                      <option value="pr">Create branch & pull request</option>
                      <option value="branch">Create a new branch</option>
                      <option value="commit">Commit to default branch</option>
                    </select>
                    <ChevronDown size={12} />
                  </div>
                  <span className="muted">
                    {repo?.defaultBranch} →{' '}
                    {publishMode === 'commit' ? repo?.defaultBranch : 'readme-roulette/…'}
                  </span>
                </div>
                <label className="review-checkbox">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed this diff and approve these exact changes.
                </label>
                <div className="modal-actions">
                  <button className="button" onClick={download}>
                    <Download size={15} />
                    Download instead
                  </button>
                  {session.demo ? (
                    <button className="button primary" onClick={() => setModal('connect')}>
                      <Github size={15} />
                      Connect GitHub to publish
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={publish}
                      disabled={!reviewed || !!busy}
                    >
                      <GitPullRequest size={15} />
                      {busy || 'Publish README'}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
