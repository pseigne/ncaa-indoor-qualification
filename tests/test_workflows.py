import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]


def workflow(name):
    # BaseLoader keeps YAML's `on` key intact instead of treating it as a boolean.
    return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)


def allowed(expression, event, ref='refs/heads/main', branch='main',
            conclusion='success', source_event='schedule', repository='pseigne/ncaa-indoor-qualification'):
    github = SimpleNamespace(
        event_name=event, ref=ref, repository='pseigne/ncaa-indoor-qualification',
        event=SimpleNamespace(workflow_run=SimpleNamespace(
            conclusion=conclusion, head_branch=branch, event=source_event,
            head_repository=SimpleNamespace(full_name=repository))),
    )
    expression = expression.replace('&&', ' and ').replace('||', ' or ')
    return eval('(' + expression + ')', {'__builtins__': {}}, {'github': github})


class WorkflowTests(unittest.TestCase):
    def test_only_main_scheduled_or_manual_runs_scrape(self):
        action = workflow('daily_scrape.yml')
        self.assertEqual(action['on']['schedule'][0]['cron'], '0 6 * * *')
        job = action['jobs']['scrape-and-update']
        self.assertEqual(job['needs'], 'test')
        self.assertEqual(job['concurrency']['cancel-in-progress'], 'false')
        for event in ['schedule', 'workflow_dispatch']:
            self.assertTrue(allowed(job['if'], event))
            self.assertFalse(allowed(job['if'], event, ref='refs/heads/feat/data-organization'))
        for event in ['pull_request', 'push']:
            self.assertFalse(allowed(job['if'], event))

    def test_notification_blocks_failed_feature_and_fork_workflows(self):
        action = workflow('portfolio.yml')
        self.assertEqual(set(action['on']), {'workflow_run'})
        condition = action['jobs']['notify']['if']
        self.assertTrue(allowed(condition, 'workflow_run'))
        self.assertTrue(allowed(condition, 'workflow_run', source_event='workflow_dispatch'))
        self.assertTrue(allowed(condition, 'workflow_run', source_event='push'))
        for conclusion in ['failure', 'cancelled', 'skipped', 'timed_out']:
            self.assertFalse(allowed(condition, 'workflow_run', conclusion=conclusion))
        self.assertFalse(allowed(condition, 'workflow_run', branch='feature'))
        self.assertFalse(allowed(condition, 'workflow_run', repository='someone/fork'))
        self.assertFalse(allowed(condition, 'workflow_run', source_event='pull_request'))

    def test_commit_step_distinguishes_noop_commit_failure_and_push_failure(self):
        steps = workflow('daily_scrape.yml')['jobs']['scrape-and-update']['steps']
        script = next(step['run'] for step in steps if step.get('name') == 'Commit validated data changes')
        self.assertIn('git add -- data/ scrape_config.json', script)
        collect_index = next(i for i, step in enumerate(steps) if step.get('run') == 'python tfrrs-scraper.py')
        self.assertEqual(steps[collect_index + 1]['run'], 'python validate_data.py')
        with tempfile.TemporaryDirectory() as tmp:
            mock_git = Path(tmp) / 'git'
            log = Path(tmp) / 'calls'
            mock_git.write_text('''#!/bin/sh
echo "$*" >> "$CALL_LOG"
case "$1" in
  diff) exit "$DIFF_STATUS" ;;
  commit) exit "$COMMIT_STATUS" ;;
  push) exit "$PUSH_STATUS" ;;
esac
''')
            mock_git.chmod(0o755)
            for diff, commit, push, expected, should_commit, should_push in [
                (0, 0, 0, 0, False, False), (1, 0, 0, 0, True, True),
                (1, 17, 0, 17, True, False), (1, 0, 19, 19, True, True),
                (2, 0, 0, 2, False, False),
            ]:
                log.write_text('')
                env = dict(os.environ, PATH=tmp + os.pathsep + os.environ['PATH'],
                           CALL_LOG=str(log), DIFF_STATUS=str(diff), COMMIT_STATUS=str(commit), PUSH_STATUS=str(push))
                result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
                calls = log.read_text().splitlines()
                self.assertEqual(result.returncode, expected)
                self.assertEqual(any(c.startswith('commit ') for c in calls), should_commit)
                self.assertEqual(any(c.startswith('push ') for c in calls), should_push)


if __name__ == '__main__':
    unittest.main()
