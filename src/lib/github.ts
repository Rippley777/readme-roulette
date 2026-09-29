import { RepoFile, Repository, RepositoryProvider } from './types';
import { demoFiles, demoRepos } from './demo';
import { safePath, redact } from './analyzer';
const cache = new Map<string, string>();
export class GitHubProvider implements RepositoryProvider {
  constructor(private token: string) {}
  async request(path: string, options: RequestInit = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status === 404) throw new Error('GitHub resource not found.');
      if (res.status === 403) throw new Error('GitHub access denied or API rate limit reached.');
      throw new Error(`GitHub request failed (${res.status}).`);
    }
    return res.status === 204 ? null : res.json();
  }
  async list() {
    const repositories: Repository[] = [];
    for (let page = 1; page <= 20; page++) {
      const items = await this.request(`/user/repos?per_page=100&sort=updated&page=${page}`);
      repositories.push(...items.map(normalize));
      if (items.length < 100) break;
    }
    return repositories;
  }
  async repository(fullName: string) {
    return normalize(await this.request(`/repos/${fullName}`));
  }
  async files(repo: Repository) {
    const ref = await this.request(
      `/repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`,
    );
    const tree = await this.request(
      `/repos/${repo.fullName}/git/trees/${ref.object.sha}?recursive=1`,
    );
    if (tree.truncated)
      throw new Error('This repository exceeds the tree API limit. Analyze a smaller repository.');
    return {
      files: tree.tree.filter(
        (f: { type: string; path: string }) => f.type === 'blob' && safePath(f.path),
      ) as RepoFile[],
      headSha: ref.object.sha,
    };
  }
  async read(repo: Repository, file: RepoFile) {
    if (!safePath(file.path)) throw new Error('Sensitive file excluded.');
    const key = `${repo.fullName}:${file.sha}`;
    if (cache.has(key)) return cache.get(key)!;
    const blob = await this.request(`/repos/${repo.fullName}/git/blobs/${file.sha}`);
    if (blob.size > 100000) throw new Error('File exceeds analysis size limit.');
    const raw = Buffer.from(blob.content, 'base64').toString('utf8');
    const text = /\.env\.(example|sample|template)$/.test(file.path)
      ? raw
          .split('\n')
          .map((line) => line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)?.[1])
          .filter(Boolean)
          .map((name) => `${name}=`)
          .join('\n')
      : redact(raw);
    if (cache.size > 500) cache.clear();
    cache.set(key, text);
    return text;
  }
  async publish(
    repo: Repository,
    markdown: string,
    mode: 'pr' | 'branch' | 'commit',
    expectedSha: string | undefined,
    path: string,
  ) {
    let existing: { sha: string } | undefined;
    try {
      existing = await this.request(
        `/repos/${repo.fullName}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(repo.defaultBranch)}`,
      );
    } catch (error) {
      if (!(error instanceof Error && error.message === 'GitHub resource not found.')) throw error;
    }
    if (existing?.sha !== expectedSha)
      throw new Error(
        'README changed on GitHub. Analyze again and review the updated diff before publishing.',
      );
    let branch = repo.defaultBranch;
    if (mode !== 'commit') {
      const ref = await this.request(
        `/repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`,
      );
      branch = `readme-roulette/${Date.now()}`;
      await this.request(`/repos/${repo.fullName}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
      });
    }
    await this.request(`/repos/${repo.fullName}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'docs: refresh README with README Roulette',
        content: Buffer.from(markdown).toString('base64'),
        sha: existing?.sha,
        branch,
      }),
    });
    if (mode === 'pr') {
      const pr = await this.request(`/repos/${repo.fullName}/pulls`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'docs: give this README a makeover',
          head: branch,
          base: repo.defaultBranch,
          body: 'Documentation generated from repository evidence and reviewed in README Roulette.',
        }),
      });
      return { url: pr.html_url, branch };
    }
    return { url: `https://github.com/${repo.fullName}/blob/${branch}/${path}`, branch };
  }
}
function normalize(r: any): Repository {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    description: r.description || '',
    language: r.language || 'Unknown',
    stars: r.stargazers_count,
    forks: r.forks_count,
    updatedAt: r.pushed_at || r.updated_at,
    private: r.private,
    defaultBranch: r.default_branch,
    score: -1,
    readmeStatus: 'unknown',
    topics: r.topics || [],
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null,
  };
}
export class DemoProvider implements RepositoryProvider {
  async list() {
    return demoRepos;
  }
  async files(repo: Repository) {
    return { files: demoFiles(repo), headSha: `demo-${repo.id}` };
  }
  async read(_repo: Repository, file: RepoFile) {
    return file.content || '';
  }
}
