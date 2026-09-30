#!/usr/bin/env python3
"""One entry point for deploying, configuring and inspecting README Roulette."""
import argparse
from dataclasses import dataclass
import json
import shlex
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from azure_deploy import ROOT, DEFAULT_NAME, DEFAULT_LOCATION, az, validate_origin, verify_free_tiers

WORKER_CONFIG = 'deploy/cloudflare/wrangler.jsonc'
WRANGLER = ['npx', '--yes', '--package=node@22', '--package=wrangler@4.143.0', 'wrangler']
AZURE = [sys.executable, 'scripts/azure-deploy.py', '--name', DEFAULT_NAME]
GROUP = 'rg-' + DEFAULT_NAME

@dataclass
class Step:
    title: str
    command: list | None = None
    url: str | None = None
    writes: bool = False


def target():
    # Keep this JSONC file valid JSON: both Wrangler and this script read the same target.
    config = json.loads((ROOT / WORKER_CONFIG).read_text())
    public = validate_origin(config['vars']['PUBLIC_URL'])
    origin = validate_origin(config['vars']['AZURE_ORIGIN'])
    from urllib.parse import urlsplit
    if not any(r.get('custom_domain') and r['pattern'] == urlsplit(public).hostname for r in config['routes']):
        raise RuntimeError('Worker Custom Domain must match PUBLIC_URL.')
    return public, origin


def plan(command, app_only=False, proxy_only=False):
    public, origin = target()
    steps = []
    if command == 'configure':
        return [Step('Verify the public domain serves the app', url=public),
                Step('Apply credentials and the public URL', AZURE + ['--configure-only', '--public-url', public]),
                Step('Verify the API and browser write origin', url=public, writes=True)]
    if not proxy_only:
        steps += [Step('Run application tests', ['npm', 'test']),
                  Step('Test deployment safeguards', ['npm', 'run', 'test:deploy']),
                  Step('Type-check the application', ['npm', 'run', 'typecheck'])]
    if command == 'setup':
        steps.append(Step('Provision free Azure resources', AZURE + ['--provision-only', '--location', DEFAULT_LOCATION]))
    if not proxy_only:
        steps += [Step('Build Linux x64 and deploy the app', AZURE + ['--deploy-only']),
                  Step('Verify the Azure origin responds', url=origin)]
    if not app_only:
        steps += [Step('Publish the Cloudflare proxy and Custom Domain', WRANGLER + ['deploy', '--config', WORKER_CONFIG]),
                  Step('Wait for public DNS, TLS and app readiness', url=public),
                  Step('Switch Azure to the public URL', AZURE + ['--configure-only', '--public-url', public]),
                  Step('Verify the public API and browser write origin', url=public, writes=True)]
    return steps


def probe(url, writes=False):
    request = Request(url + '/api/session', headers={'User-Agent': 'README-Roulette-Deploy'})
    with urlopen(request, timeout=15) as response:
        data = json.load(response)
    if not isinstance(data.get('demo'), bool) or not isinstance(data.get('configured'), bool):
        raise RuntimeError('The hostname is not serving the README Roulette session API.')
    if writes:
        # An invalid repository is rejected before any database write. A 403 means APP_URL/WAF mismatch.
        request = Request(url + '/api/analyze', data=b'{"repo":"invalid"}', headers={
            'Content-Type': 'application/json', 'Origin': url, 'User-Agent': 'README-Roulette-Deploy'}, method='POST')
        try:
            with urlopen(request, timeout=15) as response:
                raise RuntimeError('Expected validation to reject the smoke-test repository.')
        except HTTPError as error:
            if error.code != 400:
                raise RuntimeError(f'Browser-origin check returned HTTP {error.code}; check APP_URL and Cloudflare rules.') from error
            payload = json.load(error)
            if not isinstance(payload.get('error'), str):
                raise RuntimeError('Unexpected validation response from the public API.')
    return data


def wait_ready(url, writes=False, timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        try:
            data = probe(url, writes)
            print(f'  Healthy: {url} (GitHub configured: {data["configured"]})', flush=True)
            return
        except (OSError, ValueError, RuntimeError) as error:
            if time.monotonic() >= deadline:
                raise RuntimeError(f'{url} is not ready: {error}. Earlier steps may have completed; run npm run deploy:status.') from error
            print(f'  Waiting for {url}: {type(error).__name__}; retrying in 5 seconds...', flush=True)
            time.sleep(5)


def preflight(command, app_only, proxy_only):
    for executable in ['az', 'node', 'npm'] + ([] if app_only or command == 'configure' else ['npx']):
        if not shutil.which(executable):
            raise RuntimeError(f'Missing {executable}; see docs/deployment.md prerequisites.')
    if not (ROOT / 'node_modules' / '@next' / 'env').exists():
        raise RuntimeError('Run npm ci before deployment.')
    account = az('account', 'show')
    state_path = ROOT / '.azure' / (DEFAULT_NAME + '.json')
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state['subscription'] != account['id']:
            raise RuntimeError('Select the Azure subscription recorded in .azure deployment state.')
    elif command != 'setup':
        raise RuntimeError('Restore .azure deployment state from backup, or use npm run deploy:setup for a new installation.')
    if command == 'setup':
        groups = az('group', 'list', '--query', '[].name')
        if GROUP in groups:
            raise RuntimeError('The resource group already exists. Use npm run deploy (restore .azure state if missing); setup never replaces an existing installation.')
    else:
        verify_free_tiers(DEFAULT_NAME, GROUP)
        app = az('webapp', 'show', '-g', GROUP, '-n', DEFAULT_NAME)
        if 'https://' + app['defaultHostName'] != target()[1]:
            raise RuntimeError('AZURE_ORIGIN in the Worker config does not match the Azure app hostname.')
    if command != 'configure' and not proxy_only:
        subprocess.run(['docker', 'info', '--format', '{{.OSType}}'], cwd=ROOT, check=True, capture_output=True)
    if command != 'configure' and not app_only:
        result = subprocess.run(WRANGLER + ['whoami', '--json'], cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Cloudflare authentication check failed. Run npm run deploy:login, then retry. No deployment changes were made.')


def status():
    public, origin = target()
    print(f'Azure app: {DEFAULT_NAME}\nResource group: {GROUP}\nPublic URL: {public}\nAzure origin: {origin}')
    plan_info, database = verify_free_tiers(DEFAULT_NAME, GROUP)
    print(f'Hosting: {plan_info["sku"]["name"]}; SQL free allowance: {database["useFreeLimit"]}; limit behavior: {database["freeLimitExhaustionBehavior"]}')
    configured_url = az('webapp', 'config', 'appsettings', 'list', '-g', GROUP, '-n', DEFAULT_NAME,
                        '--query', "[?name=='APP_URL'].value | [0]")
    print(f'Azure APP_URL: {configured_url}')
    problems = []
    if configured_url != public:
        problems.append('APP_URL does not match the public URL. Once the domain is serving the app, run npm run deploy:configure.')
    for url in [origin, public]:
        try:
            data = probe(url, writes=url == public)
            print(f'Healthy: {url}; GitHub configured: {data["configured"]}')
        except (OSError, ValueError, RuntimeError) as error:
            problems.append(f'{url}: {error}')
    if problems:
        raise RuntimeError('\n'.join(problems))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', nargs='?', choices=['deploy', 'setup', 'configure', 'status', 'login'], default='deploy')
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument('--app-only', action='store_true', help='Update Azure only, preserving its current public URL.')
    scope.add_argument('--proxy-only', action='store_true', help='Publish the proxy and configure the public URL without rebuilding Azure.')
    parser.add_argument('--dry-run', action='store_true', help='Print the plan without cloud calls, builds, authentication or changes.')
    args = parser.parse_args(argv)
    if (args.app_only or args.proxy_only) and args.command != 'deploy':
        parser.error('--app-only and --proxy-only apply only to deploy.')
    if args.command in ['status', 'login']:
        if args.dry_run:
            print('Read-only deployment inspection.' if args.command == 'status' else shlex.join(WRANGLER + ['login']))
        elif args.command == 'status':
            status()
        else:
            subprocess.run(WRANGLER + ['login'], cwd=ROOT, check=True)
        return
    steps = plan(args.command, args.app_only, args.proxy_only)
    print('Deployment plan:', flush=True)
    for index, step in enumerate(steps, 1):
        print(f'{index}. {step.title}: {shlex.join(step.command) if step.command else step.url}', flush=True)
    if args.dry_run:
        print('Dry run: no commands or network requests were executed.')
        return
    preflight(args.command, args.app_only, args.proxy_only)
    for step in steps:
        print(f'\n{step.title}...', flush=True)
        if step.command:
            subprocess.run(step.command, cwd=ROOT, check=True)
        else:
            wait_ready(step.url, step.writes)
    if args.app_only:
        print('Azure update complete. Public URL was preserved; npm run deploy:status checks routing.')
    else:
        public, _ = target()
        print(f'\nDeployment complete: {public}\nGitHub callback: {public}/api/auth/callback')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError, KeyboardInterrupt) as error:
        raise SystemExit(f'Deployment stopped: {error or "interrupted"}')
