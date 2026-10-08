#!/usr/bin/env node
/** EAS runs this after npm install. Preview can compile for QA; store builds cannot waive audit. */
const { spawnSync } = require('node:child_process');
const profile = process.env.EAS_BUILD_PROFILE;
const variant = process.env.APP_VARIANT;
if (profile === 'production' || profile === 'preview' || profile === 'simulator') {
  const expected = profile === 'production' ? 'production' : 'preview';
  if (variant !== expected) {
    process.stderr.write(`Build profile ${profile} requires APP_VARIANT=${expected}.\n`);
    process.exit(1);
  }
  const policy = spawnSync(process.execPath, [require.resolve('./verify-release.cjs')], {
    stdio: 'inherit', env: { ...process.env, APP_VARIANT: 'production' },
  });
  if (policy.error || policy.status !== 0) process.exit(1);
  if (profile === 'production') {
    const audit = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--audit-level=high'], { stdio: 'inherit' });
    if (audit.error || audit.status !== 0) {
      process.stderr.write('Store build blocked by dependency audit. Resolve or review the documented release blocker; this hook has no automatic waiver.\n');
      process.exit(1);
    }
  }
}
