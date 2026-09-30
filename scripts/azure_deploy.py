#!/usr/bin/env python3
"""Deploy only to F1 + Azure SQL free allowance, with billing overage disabled."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import zipfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NAME = "readme-roulette-daac2bd8"
DEFAULT_LOCATION = "centralus"

def az(*args):
    result = subprocess.run(['az', *args, '--only-show-errors', '-o', 'json'], capture_output=True, text=True)
    if result.returncode:
        # Never print command arguments: some Azure operations carry credentials.
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None

def load_env():
    script = "require('@next/env').loadEnvConfig(process.cwd()); console.log(JSON.stringify(Object.fromEntries(['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','AI_ENDPOINT','AI_API_KEY'].map(k=>[k,process.env[k]||'']))))"
    output = subprocess.check_output(['node', '-e', script], text=True)
    return json.loads(output.strip().splitlines()[-1])

def private_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as handle:
        json.dump(data, handle)
        temporary = Path(handle.name)
    temporary.chmod(0o600)
    os.replace(temporary, path)

def validate_origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise RuntimeError('Public URL must be an HTTPS origin without a path, credentials, query or fragment.')
    return value.rstrip('/')

def verify_free_tiers(name, group):
    plan = az('appservice', 'plan', 'show', '-g', group, '-n', name + '-free')
    database = az('sql', 'db', 'show', '-g', group, '-s', name + '-sql', '-n', 'roulette')
    if plan['sku']['name'] != 'F1' or database.get('useFreeLimit') is not True or database.get('freeLimitExhaustionBehavior') != 'AutoPause':
        raise RuntimeError('Free-tier safeguards do not match; stopping deployment.')
    return plan, database

def main(argv=None):
    os.chdir(ROOT)
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default=DEFAULT_NAME)
    parser.add_argument('--location', default=DEFAULT_LOCATION)
    parser.add_argument('--public-url', help='HTTPS public origin, persisted for future deployments (e.g. a Cloudflare domain).')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--configure-only', action='store_true')
    mode.add_argument('--provision-only', action='store_true')
    mode.add_argument('--deploy-only', action='store_true')
    args = parser.parse_args(argv)
    name, group = args.name, 'rg-' + args.name
    state_path = ROOT / '.azure' / (name + '.json')
    account = az('account', 'show')
    env = load_env()
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state['subscription'] != account['id']:
            raise RuntimeError('Select the original Azure subscription before redeploying.')
    else:
        if args.configure_only or args.deploy_only:
            raise RuntimeError('Provision this application first.')
        groups = az('group', 'list', '--query', '[].name')
        if group in groups:
            raise RuntimeError('Deployment state is missing for an existing resource group. Restore .azure/' + name + '.json from backup; refusing to regenerate encryption/database secrets.')
        state = {'subscription': account['id'], 'sqlPassword': secrets.token_urlsafe(36) + 'aA7!', 'sessionSecret': secrets.token_hex(32)}
        private_json(state_path, state)

    public_url = args.public_url if args.public_url is not None else state.get('publicUrl', '')
    if public_url:
        public_url = validate_origin(public_url)

    if not args.configure_only and not args.deploy_only:
        print('Provisioning F1 hosting and a free SQL database with AutoPause...', flush=True)
        az('group', 'create', '--name', group, '--location', args.location)
        values = { 'name': name, 'location': args.location, 'publicUrl': public_url, 'sqlPassword': state['sqlPassword'], 'sessionSecret': state['sessionSecret'], 'githubClientId': env['GITHUB_CLIENT_ID'], 'githubClientSecret': env['GITHUB_CLIENT_SECRET'] }
        with tempfile.TemporaryDirectory() as tmp:
            params = Path(tmp) / 'parameters.json'
            private_json(params, {'parameters': {k: {'value': v} for k, v in values.items()}})
            az('deployment', 'group', 'create', '--resource-group', group, '--name', 'free-hosting', '--template-file', 'deploy/azure.json', '--parameters', '@' + str(params))

    verify_free_tiers(name, group)
    app = az('webapp', 'show', '-g', group, '-n', name)
    origin_url = 'https://' + app['defaultHostName']
    remote_settings = az('webapp', 'config', 'appsettings', 'list', '-g', group, '-n', name, '--query', "[?name=='APP_URL'].value | [0]")
    url = (public_url if args.public_url is not None else remote_settings) or public_url or origin_url
    url = validate_origin(url)
    state['originUrl'] = origin_url
    state['publicUrl'] = url if url != origin_url else ''
    state['url'] = url
    # Only this web app's outbound IPs can connect to its dedicated SQL server.
    if not args.configure_only:
        existing_rules = az('sql', 'server', 'firewall-rule', 'list', '-g', group, '-s', name + '-sql')
        allowed = {(r['startIpAddress'], r['endIpAddress']) for r in existing_rules}
        for index, ip in enumerate(sorted(set(app['possibleOutboundIpAddresses'].split(',')))):
            if (ip, ip) in allowed:
                continue
            az('sql', 'server', 'firewall-rule', 'create', '-g', group, '-s', name + '-sql', '-n', 'webapp-' + str(index), '--start-ip-address', ip, '--end-ip-address', ip)
    if not args.configure_only and not args.provision_only:
        print('Building Linux x64 deployment package...', flush=True)
        shutil.rmtree(ROOT / '.deploy' / 'app', ignore_errors=True)
        subprocess.run(['docker', 'build', '--platform', 'linux/amd64', '-f', 'deploy/Dockerfile.azure', '--target', 'artifact', '--output', 'type=local,dest=.deploy/app', '.'], check=True)
        bundle = ROOT / '.deploy' / 'app.zip'
        with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in (ROOT / '.deploy' / 'app').rglob('*'):
                if file.is_file():
                    archive.write(file, file.relative_to(ROOT / '.deploy' / 'app'))

    settings = {'APP_URL': url}
    for key, value in env.items():
        if value:
            settings[key] = value
    remote_values = {s['name']: s['value'] for s in az('webapp', 'config', 'appsettings', 'list', '-g', group, '-n', name)}
    changed = {k: v for k, v in settings.items() if remote_values.get(k) != v}
    if changed:
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'settings.json'
            private_json(config, changed)
            az('webapp', 'config', 'appsettings', 'set', '-g', group, '-n', name, '--settings', '@' + str(config))
    private_json(state_path, state)
    if not args.configure_only and not args.provision_only:
        print('Uploading application...', flush=True)
        az('webapp', 'deploy', '-g', group, '-n', name, '--src-path', str(bundle), '--type', 'zip', '--clean', 'true', '--timeout', '600000')
    print('Website: ' + url)
    print('GitHub homepage URL: ' + url)
    print('GitHub authorization callback URL: ' + url + '/api/auth/callback')
    effective = {**remote_values, **changed}
    if not effective.get('GITHUB_CLIENT_ID') or not effective.get('GITHUB_CLIENT_SECRET'):
        print('GitHub credentials are not configured. Add the OAuth app credentials to .env and run npm run deploy:configure.')

if __name__ == "__main__":
    main()
