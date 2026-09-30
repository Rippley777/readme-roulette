"""Deployment flow tests with no cloud changes, account access or real credentials."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import deploy
import azure_deploy


class DeploymentTests(unittest.TestCase):
    def test_dry_run_never_calls_cloud_or_processes(self):
        with patch.object(deploy, 'preflight') as preflight, patch.object(deploy.subprocess, 'run') as run, patch.object(deploy, 'probe') as probe:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                deploy.main(['--dry-run'])
            preflight.assert_not_called()
            run.assert_not_called()
            probe.assert_not_called()
            self.assertIn('no commands or network requests', out.getvalue())

    def test_routine_deploy_does_not_provision_or_switch_url_before_proxy_readiness(self):
        steps = deploy.plan('deploy')
        commands = [s.command for s in steps if s.command]
        self.assertFalse(any('--provision-only' in c for c in commands))
        proxy = next(i for i, s in enumerate(steps) if s.command and 'wrangler' in s.command and 'deploy' in s.command)
        configure = next(i for i, s in enumerate(steps) if s.command and '--configure-only' in s.command)
        self.assertLess(proxy, configure)
        self.assertIsNotNone(steps[configure - 1].url)
        self.assertTrue(steps[-1].writes)

    def test_app_only_needs_no_cloudflare_and_preserves_origin(self):
        steps = deploy.plan('deploy', app_only=True)
        commands = [s.command for s in steps if s.command]
        self.assertFalse(any('wrangler' in c or '--public-url' in c for c in commands))
        self.assertTrue(any('--deploy-only' in c for c in commands))

    def test_configure_does_not_build_or_publish_proxy(self):
        commands = [s.command for s in deploy.plan('configure') if s.command]
        self.assertEqual(len(commands), 1)
        self.assertIn('--configure-only', commands[0])
        self.assertIn('https://readmeroulette.oddware.dev', commands[0])

    def test_proxy_failure_stops_before_public_url_switch(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if 'wrangler' in command:
                raise subprocess.CalledProcessError(1, command)
        with patch.object(deploy, 'preflight'), patch.object(deploy, 'wait_ready'), patch.object(deploy.subprocess, 'run', side_effect=run):
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(subprocess.CalledProcessError):
                deploy.main(['--proxy-only'])
        self.assertFalse(any('--configure-only' in c for c in calls))

    def test_missing_state_never_regenerates_secrets_for_existing_group(self):
        with tempfile.TemporaryDirectory() as folder:
            def az(*args):
                if args[:2] == ('account', 'show'):
                    return {'id': 'subscription'}
                if args[:2] == ('group', 'list'):
                    return ['rg-' + azure_deploy.DEFAULT_NAME]
                self.fail(f'Unexpected mutation: {args[:3]}')
            with patch.object(azure_deploy, 'ROOT', Path(folder)), patch.object(azure_deploy, 'az', side_effect=az), patch.object(azure_deploy, 'load_env', return_value={}), patch.object(azure_deploy.os, 'chdir'), patch.object(azure_deploy, 'private_json') as save:
                with self.assertRaisesRegex(RuntimeError, 'refusing to regenerate'):
                    azure_deploy.main(['--provision-only'])
                save.assert_not_called()

    def test_existing_app_url_is_kept_and_unchanged_settings_are_not_written(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / '.azure' / (azure_deploy.DEFAULT_NAME + '.json')
            path.parent.mkdir()
            path.write_text(json.dumps({'subscription': 's', 'publicUrl': 'https://old.example', 'sessionSecret': 'unchanged', 'sqlPassword': 'unchanged'}))
            mutations = []
            def az(*args):
                if args[:2] == ('account', 'show'): return {'id': 's'}
                if args[:2] == ('webapp', 'show'): return {'defaultHostName': 'origin.azurewebsites.net'}
                if args[:4] == ('webapp', 'config', 'appsettings', 'list'):
                    if '--query' in args: return 'https://new.example'
                    return [{'name': 'APP_URL', 'value': 'https://new.example'}, {'name':'GITHUB_CLIENT_ID', 'value':'existing'}, {'name':'GITHUB_CLIENT_SECRET', 'value':'existing'}]
                mutations.append(args)
            with patch.object(azure_deploy, 'ROOT', root), patch.object(azure_deploy, 'az', side_effect=az), patch.object(azure_deploy, 'load_env', return_value={'GITHUB_CLIENT_ID':'', 'GITHUB_CLIENT_SECRET':''}), patch.object(azure_deploy, 'verify_free_tiers'), patch.object(azure_deploy.os, 'chdir'), contextlib.redirect_stdout(io.StringIO()):
                azure_deploy.main(['--configure-only'])
            self.assertEqual(mutations, [])
            state = json.loads(path.read_text())
            self.assertEqual(state['publicUrl'], 'https://new.example')
            self.assertEqual(state['sessionSecret'], 'unchanged')

    def test_cloudflare_authentication_failure_stops_before_deploy_steps(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = root / '.azure' / (deploy.DEFAULT_NAME + '.json')
            state.parent.mkdir(parents=True)
            state.write_text(json.dumps({'subscription': 's'}))
            (root / 'node_modules' / '@next' / 'env').mkdir(parents=True)
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 1, '', 'not authenticated')
            def az(*args):
                if args[:2] == ('account', 'show'): return {'id': 's'}
                if args[:2] == ('webapp', 'show'): return {'defaultHostName': 'origin.azurewebsites.net'}
                self.fail(f'Unexpected cloud operation: {args}')
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'target', return_value=('https://public.example', 'https://origin.azurewebsites.net')), patch.object(deploy, 'az', side_effect=az), patch.object(deploy, 'verify_free_tiers'), patch.object(deploy.shutil, 'which', return_value='/bin/tool'), patch.object(deploy.subprocess, 'run', side_effect=run):
                with self.assertRaisesRegex(RuntimeError, 'No deployment changes'):
                    deploy.preflight('deploy', False, True)
            self.assertEqual(len(calls), 1)
            self.assertIn('whoami', calls[0])

    def test_paid_hosting_or_sql_overages_are_rejected(self):
        for plan, db in [({'sku': {'name': 'B1'}}, {'useFreeLimit':True,'freeLimitExhaustionBehavior':'AutoPause'}), ({'sku':{'name':'F1'}}, {'useFreeLimit':True,'freeLimitExhaustionBehavior':'BillOverUsage'})]:
            with patch.object(azure_deploy, 'az', side_effect=[plan, db]), self.assertRaisesRegex(RuntimeError, 'Free-tier safeguards'):
                azure_deploy.verify_free_tiers('name', 'group')

    def test_public_origin_must_be_https_without_credentials_or_paths(self):
        for url in ['http://example.com', 'https://user:secret@example.com', 'https://example.com/callback', 'https://example.com?query=1']:
            with self.assertRaises(RuntimeError): azure_deploy.validate_origin(url)
        self.assertEqual(azure_deploy.validate_origin('https://example.com/'), 'https://example.com')


if __name__ == '__main__':
    unittest.main()
