import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import db, { createSession, deleteSession, getSession } from '@/lib/db';
import { DemoProvider, GitHubProvider } from '@/lib/github';
import { RepositoryAnalyzer } from '@/lib/analyzer';
import { DocumentationGenerator, profiles, tones } from '@/lib/generator';
import { demoRepos } from '@/lib/demo';
import { Analysis, Profile, Tone } from '@/lib/types';
import { scoreRepository } from '@/lib/score';
import { generationProviders } from '@/lib/ai-provider';
import { aiSettingsStore } from '@/lib/ai-settings';
import { aiProviders } from '@/lib/byok-types';
import { keySchema, modelSchema, listModels, verifyCredential } from '@/lib/byok-provider';
import { ProviderError } from '@/lib/provider-error';
import { generateReadme } from '@/lib/generation-service';
import { rewriteSelection } from '@/lib/rewrite-service';
export const runtime = 'nodejs';
const repoSchema = z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
async function context() {
  const jar = await cookies();
  const session = await getSession(jar.get('rr_session')?.value || '');
  let demoId = jar.get('rr_demo')?.value;
  if (!demoId || !/^[a-f0-9]{32}$/.test(demoId)) {
    demoId = randomBytes(16).toString('hex');
    jar.set('rr_demo', demoId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 604800,
    });
  }
  return {
    session,
    uid: session?.userId || `demo:${demoId}`,
    provider: session ? new GitHubProvider(session.token) : new DemoProvider(),
  };
}
function requestOrigin(req: NextRequest) {
  return (
    process.env.APP_URL || `${req.nextUrl.protocol}//${req.headers.get('host') || req.nextUrl.host}`
  );
}
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await params).path.join('/');
    const jar = await cookies();
    if (path === 'auth/github') {
      if (
        !process.env.GITHUB_CLIENT_ID ||
        !process.env.GITHUB_CLIENT_SECRET ||
        !process.env.SESSION_SECRET
      )
        return NextResponse.redirect(new URL('/?setup=required', requestOrigin(req)));
      const state = randomBytes(24).toString('hex');
      jar.set('rr_oauth_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 600,
      });
      const scope =
        req.nextUrl.searchParams.get('scope') === 'private'
          ? 'repo'
          : req.nextUrl.searchParams.get('scope') === 'publish'
            ? 'public_repo'
            : 'read:user';
      const target = new URL('https://github.com/login/oauth/authorize');
      target.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
      target.searchParams.set('redirect_uri', `${requestOrigin(req)}/api/auth/callback`);
      target.searchParams.set('state', state);
      target.searchParams.set('scope', scope);
      return NextResponse.redirect(target);
    }
    if (path === 'auth/callback') {
      const expected = jar.get('rr_oauth_state')?.value || '',
        actual = req.nextUrl.searchParams.get('state') || '';
      jar.delete('rr_oauth_state');
      if (
        !expected ||
        expected.length !== actual.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
      )
        return json({ error: 'Invalid OAuth state. Start sign-in again.' }, 400);
      const code = req.nextUrl.searchParams.get('code');
      if (!code) return NextResponse.redirect(new URL('/?auth=cancelled', requestOrigin(req)));
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${requestOrigin(req)}/api/auth/callback`,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (!data.access_token) throw new Error('GitHub did not grant access. Please try again.');
      const provider = new GitHubProvider(data.access_token);
      const user = await provider.request('/user');
      const sessionId = await createSession(user, data.access_token);
      jar.set('rr_session', sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 604800,
      });
      return NextResponse.redirect(new URL('/', requestOrigin(req)));
    }
    const ctx = await context();
    if (path === 'ai/settings') {
      if (!ctx.session) return json({ error: 'Connect GitHub to manage your AI key.' }, 401);
      return json(await aiSettingsStore.publicSettings(ctx.uid));
    }
    if (path === 'session') {
      const ai = ctx.session
        ? await aiSettingsStore.publicSettings(ctx.uid)
        : { configured: false };
      return json({
        user: ctx.session ? { login: ctx.session.login, avatar: ctx.session.avatar } : null,
        demo: !ctx.session,
        configured: Boolean(
          process.env.GITHUB_CLIENT_ID &&
          process.env.GITHUB_CLIENT_SECRET &&
          process.env.SESSION_SECRET,
        ),
        generationProvider: ai.configured ? 'byok' : process.env.AI_ENDPOINT ? 'http' : 'local',
        ai,
      });
    }
    if (path === 'repos') {
      const repos = await ctx.provider.list();
      if (ctx.session)
        for (const repo of repos) {
          const stored = (await db
            .prepare('SELECT data FROM analyses WHERE id=? AND user_id=?')
            .get(`${ctx.uid}:${repo.fullName}`, ctx.uid)) as { data: string } | undefined;
          if (stored) {
            const a: Analysis = JSON.parse(stored.data);
            repo.score = scoreRepository(repo, a.readme).total;
            repo.readmeStatus = !a.readme
              ? 'missing'
              : new Date(repo.updatedAt).getTime() > new Date(a.analyzedAt).getTime()
                ? 'outdated'
                : 'complete';
          }
        }
      return json(repos);
    }
    if (path === 'versions') {
      const repo = repoSchema.parse(req.nextUrl.searchParams.get('repo'));
      return json(
        await db
          .prepare(
            'SELECT id,markdown,created_at FROM readme_versions WHERE user_id=? AND repo=? ORDER BY id DESC LIMIT 30',
          )
          .all(ctx.uid, repo),
      );
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof ProviderError) return json({ error: e.message, code: e.code }, 400);
    return json({ error: e instanceof Error ? e.message : 'Request failed' }, 400);
  }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(requestOrigin(req)).origin)
      return json({ error: 'Cross-origin request rejected' }, 403);
    if (Number(req.headers.get('content-length') || 0) > 1_000_000)
      return json({ error: 'Request too large' }, 413);
    const path = (await params).path.join('/');
    const ctx = await context();
    if (path === 'auth/logout') {
      const jar = await cookies();
      await deleteSession(jar.get('rr_session')?.value || '');
      jar.delete('rr_session');
      return json({ ok: true });
    }
    const body = await req.json();
    if (path === 'ai/settings') {
      if (!ctx.session) return json({ error: 'Connect GitHub to manage your AI key.' }, 401);
      const operation = z.enum(['models', 'save', 'remove']).parse(body.operation);
      if (operation === 'remove') {
        await aiSettingsStore.remove(ctx.uid);
        return json({ configured: false });
      }
      const provider = z.enum(aiProviders).parse(body.provider);
      const providedKey = body.apiKey ? keySchema.parse(body.apiKey) : undefined;
      const saved = providedKey ? undefined : await aiSettingsStore.credential(ctx.uid);
      const apiKey = providedKey || (saved?.provider === provider ? saved.apiKey : undefined);
      if (!apiKey) return json({ error: 'Enter an API key for this provider.' }, 400);
      if (operation === 'models') return json({ models: await listModels(provider, apiKey) });
      const model = modelSchema.parse(body.model);
      const credential = { provider, model, apiKey };
      await verifyCredential(credential);
      return json(await aiSettingsStore.save(ctx.uid, credential));
    }
    const fullName = repoSchema.parse(body.repo);
    const id = `${ctx.uid}:${fullName}`;
    if (path === 'analyze') {
      const repo = ctx.session
        ? await (ctx.provider as GitHubProvider).repository(fullName)
        : demoRepos.find((r) => r.fullName === fullName);
      if (!repo) throw new Error('Repository not found.');
      const old = (await db
        .prepare('SELECT data,updated_at FROM analyses WHERE id=? AND user_id=?')
        .get(id, ctx.uid)) as { data: string; updated_at: number } | undefined;
      if (
        old &&
        !body.refresh &&
        Date.now() - old.updated_at < 300000 &&
        JSON.parse(old.data).product?.version === 2
      )
        return json(JSON.parse(old.data));
      const analysis = await new RepositoryAnalyzer(ctx.provider).analyze(repo);
      await db
        .prepare('INSERT OR REPLACE INTO analyses VALUES (?,?,?,?,?)')
        .run(id, ctx.uid, analysis.headSha, JSON.stringify(analysis), Date.now());
      await db
        .prepare('INSERT OR REPLACE INTO repositories VALUES (?,?,?)')
        .run(id, ctx.uid, JSON.stringify(repo));
      return json(analysis);
    }
    const stored = (await db
      .prepare('SELECT data FROM analyses WHERE id=? AND user_id=?')
      .get(id, ctx.uid)) as { data: string } | undefined;
    if (!stored) throw new Error('Analyze this repository first.');
    let analysis: Analysis = JSON.parse(stored.data);
    if (analysis.product?.version !== 2) {
      analysis = await new RepositoryAnalyzer(ctx.provider).analyze(analysis.repo);
      await db
        .prepare('INSERT OR REPLACE INTO analyses VALUES (?,?,?,?,?)')
        .run(id, ctx.uid, analysis.headSha, JSON.stringify(analysis), Date.now());
    }
    const generator = new DocumentationGenerator();
    if (path === 'generate') {
      const profile = z
        .enum(profiles as [Profile, ...Profile[]])
        .parse(body.profile || 'Professional');
      const sections = body.sections ? z.array(z.string()).max(30).parse(body.sections) : undefined;
      const badges = body.badges ? z.array(z.string()).max(20).parse(body.badges) : undefined;
      const tone = z.enum(tones as [Tone, ...Tone[]]).parse(body.tone || 'Personality');
      const providers = await generationProviders(ctx.session?.userId);
      const result = await generateReadme(
        analysis,
        { profile, tone, sections, badges },
        providers.writer,
      );
      // Editorial diagnostics stay internal; users see evidence, not an invented AI score.
      return json({
        markdown: result.markdown,
        sections: result.sections,
        inspection: result.inspection,
        provider: result.provider,
        writer: result.provider === 'http' ? providers.label : 'Local writer',
        tone,
        score: scoreRepository(analysis.repo, result.markdown),
      });
    }
    if (path === 'save') {
      const markdown = z.string().max(300000).parse(body.markdown);
      const score = scoreRepository(analysis.repo, markdown);
      await db.batch([
        {
          text: 'INSERT OR REPLACE INTO readmes VALUES (?,?,?,?,?)',
          values: [id, ctx.uid, fullName, markdown, Date.now()],
        },
        {
          text: 'INSERT INTO readme_versions (user_id,repo,markdown,created_at) VALUES (?,?,?,?)',
          values: [ctx.uid, fullName, markdown, Date.now()],
        },
        {
          text: 'INSERT OR REPLACE INTO repository_scores VALUES (?,?,?,?)',
          values: [id, ctx.uid, score.total, JSON.stringify(score.criteria)],
        },
      ]);
      return json({ ok: true });
    }
    if (path === 'portfolio') {
      const data = generator.portfolio(analysis);
      await db
        .prepare('INSERT OR REPLACE INTO portfolio_descriptions VALUES (?,?,?)')
        .run(id, ctx.uid, JSON.stringify(data));
      return json(data);
    }
    if (path === 'rewrite') {
      const text = z.string().max(50000).parse(body.text);
      const instruction = z
        .enum(['Shorten', 'Make more casual', 'Make more technical', 'Fix grammar', 'Expand'])
        .parse(body.instruction);
      const tone = z
        .enum(tones as [Tone, ...Tone[]])
        .default('Personality')
        .parse(body.tone);
      const providers = await generationProviders(ctx.session?.userId);
      return json(await rewriteSelection(text, instruction, analysis, tone, providers.rewriter));
    }
    if (path === 'screenshots') {
      const tasks = z.record(z.boolean()).parse(body.tasks);
      await db.batch(
        Object.entries(tasks).map(([task, completed]) => ({
          text: 'INSERT OR REPLACE INTO screenshot_tasks VALUES (?,?,?,?)',
          values: [`${id}:${task}`, ctx.uid, fullName, Number(completed)],
        })),
      );
      return json({ ok: true });
    }
    if (path === 'publish') {
      if (analysis.readme.includes('[REDACTED]'))
        throw new Error(
          'The existing README contains redacted sensitive text. Review and update it locally before publishing from this app.',
        );
      if (!ctx.session)
        return json(
          { error: 'Connect GitHub to publish. Demo repositories cannot be modified.' },
          401,
        );
      const markdown = z.string().min(1).max(300000).parse(body.markdown);
      const mode = z.enum(['pr', 'branch', 'commit']).parse(body.mode);
      if (body.reviewed !== true) throw new Error('Review the exact diff before publishing.');
      const repo = await (ctx.provider as GitHubProvider).repository(fullName);
      return json(
        await (ctx.provider as GitHubProvider).publish(
          repo,
          markdown,
          mode,
          analysis.readmeSha,
          analysis.readmePath,
        ),
      );
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof ProviderError) return json({ error: e.message, code: e.code }, 400);
    return json({ error: e instanceof Error ? e.message : 'Request failed' }, 400);
  }
}
