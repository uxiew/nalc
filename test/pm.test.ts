import * as fs from 'fs-extra';
import { strictEqual } from 'assert';
import { join } from 'path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { getPm } from '../src/pm';

const tmpDir = join(__dirname, 'pm-tmp');

describe('Package manager detection', () => {
  beforeEach(() => {
    fs.removeSync(tmpDir);
    fs.ensureDirSync(tmpDir);
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('falls back to the recorded package manager when lockfiles are absent', () => {
    strictEqual(getPm(tmpDir, 'pnpm'), 'pnpm');
  });

  it('prefers an actual lockfile over the recorded package manager', () => {
    fs.writeFileSync(join(tmpDir, 'package-lock.json'), '');
    strictEqual(getPm(tmpDir, 'pnpm'), 'npm');
  });
});
