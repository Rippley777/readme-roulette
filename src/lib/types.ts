export type Profile =
  'Professional' | 'Open Source' | 'Portfolio' | 'Minimal' | 'Developer' | 'Chaotic Good';
export type Repository = {
  id: number;
  name: string;
  fullName: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  updatedAt: string;
  private: boolean;
  defaultBranch: string;
  score: number;
  readmeStatus: 'complete' | 'outdated' | 'missing' | 'unknown';
  topics: string[];
  license: string | null;
  demo?: boolean;
};
export type Evidence = { name: string; value: string; source: string; category: string };
export type RepoFile = { path: string; sha: string; content?: string; size?: number };
export type Analysis = {
  product?: ProductModel;
  repo: Repository;
  files: string[];
  evidence: Evidence[];
  scripts: Record<string, string>;
  env: string[];
  readme: string;
  readmeSha?: string;
  readmePath: string;
  headSha: string;
  analyzedAt: string;
  inspected: number;
  limitations: string[];
};
export type ScoreCriterion = {
  label: string;
  points: number;
  earned: number;
  recommendation: string;
};
export type Session = {
  id: string;
  userId: string;
  login: string;
  avatar: string;
  token: string;
  expires: number;
};
export interface RepositoryProvider {
  list(): Promise<Repository[]>;
  files(repo: Repository): Promise<{ files: RepoFile[]; headSha: string }>;
  read(repo: Repository, file: RepoFile): Promise<string>;
}
export interface AIProvider {
  rewrite(text: string, instruction: string, analysis: Analysis): Promise<string>;
}

export type Tone = 'Professional' | 'Developer' | 'Personality' | 'Unhinged';
export type SourceReference = { path: string; line?: number; excerpt?: string };
export type ProductFact = {
  id: string;
  text: string;
  sources: SourceReference[];
  confidence: 'implemented' | 'documented' | 'inferred';
};
export type ProductFeature = ProductFact & {
  label: string;
  action: string;
  detail: string;
  priority: number;
  role: 'core' | 'workflow' | 'convenience';
};
export type ProductModel = {
  version: 2;
  name: string;
  kind: 'web app' | 'desktop app' | 'CLI' | 'library' | 'server' | 'game' | 'project';
  summary: ProductFact | null;
  problem: ProductFact | null;
  audience: ProductFact | null;
  workflow: string[];
  features: ProductFeature[];
  differentiators: ProductFact[];
  technical: (ProductFact & { name: string; version?: string })[];
  motivation: ProductFact | null;
  terminology: string[];
  theme: 'navigation' | 'archaeology' | 'gaming' | 'garden' | 'neutral';
  screenshots: { path: string; alt: string; hero: boolean; source: string }[];
  documentedSections: Record<string, ProductFact>;
  cli: { invocation: string; description: string; sources: SourceReference[] }[];
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  unknowns: string[];
};
export type DraftSection = { id: string; title: string; body: string; claimIds: string[] };
export type ReadmeDraft = {
  title: string;
  tagline: string;
  introduction: string;
  aside: string;
  sections: DraftSection[];
  openingClaimIds: string[];
  badges: string;
  screenshotComment: string;
};
export type GenerationInspection = { section: string; claims: ProductFact[] }[];
