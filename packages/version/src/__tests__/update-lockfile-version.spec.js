'use strict';

jest.mock('@lerna-lite/core', () => ({
  ...jest.requireActual('@lerna-lite/core'), // return the other real methods, below we'll mock only 2 of the methods
}));

const path = require('path');
const fs = require('fs-extra');
const core = require('@lerna-lite/core');
const nodeFs = require('node:fs');
const npmlog = require('npmlog');

// mocked or stubbed modules
const loadJsonFile = require('load-json-file');

// helpers
const { getPackages } = require('../../../core/src/project');
const initFixture = require('@lerna-test/init-fixture')(__dirname);

const {
  loadPackageLockFileWhenExists,
  updateClassicLockfileVersion,
  updateTempModernLockfileVersion,
  saveUpdatedLockJsonFile,
  runInstallLockFileOnly,
  validateFileExists,
} = require('../lib/update-lockfile-version');

describe('npm classic lock file', () => {
  test('updateLockfileVersion with lockfile v1', async () => {
    const cwd = await initFixture('lockfile-leaf');
    const [pkg] = await getPackages(cwd);

    pkg.version = '2.0.0';

    const returnedLockfilePath = await updateClassicLockfileVersion(pkg);

    expect(returnedLockfilePath).toBe(path.join(pkg.location, 'package-lock.json'));
    expect(Array.from(loadJsonFile.registry.keys())).toStrictEqual(['/packages/package-1']);
    expect(fs.readJSONSync(returnedLockfilePath)).toHaveProperty('version', '2.0.0');
  });

  test('updateClassicLockfileVersion with lockfile v2', async () => {
    const cwd = await initFixture('lockfile-leaf-v2');
    const [pkg] = await getPackages(cwd);

    pkg.version = '2.0.0';

    const returnedLockfilePath = await updateClassicLockfileVersion(pkg);

    expect(returnedLockfilePath).toBe(path.join(pkg.location, 'package-lock.json'));
    expect(Array.from(loadJsonFile.registry.keys())).toStrictEqual(['/packages/package-1']);
    const updatedLockfile = fs.readJSONSync(returnedLockfilePath);
    expect(updatedLockfile).toHaveProperty('version', '2.0.0');
    expect(updatedLockfile).toHaveProperty(['packages', '', 'version'], '2.0.0');
  });

  test('updateClassicLockfileVersion without sibling lockfile', async () => {
    const cwd = await initFixture('lifecycle', false);
    const [pkg] = await getPackages(cwd);

    pkg.version = '1.1.0';

    loadJsonFile.mockImplementationOnce(() => Promise.reject(new Error('file not found')));

    const returnedLockfilePath = await updateClassicLockfileVersion(pkg);

    expect(returnedLockfilePath).toBeUndefined();
    expect(fs.pathExistsSync(path.join(pkg.location, 'package-lock.json'))).toBe(false);
  });
});

describe('npm modern lock file', () => {
  test('updateModernLockfileVersion v2 in project root', async () => {
    const mockVersion = '2.4.0';
    const cwd = await initFixture('lockfile-version2');
    const rootLockFilePath = path.join(cwd, 'package-lock.json');
    const packages = await getPackages(cwd);

    const lockFileOutput = await loadPackageLockFileWhenExists(cwd);
    if (lockFileOutput.json) {
      for (const pkg of packages) {
        pkg.version = mockVersion;
        await updateTempModernLockfileVersion(pkg, lockFileOutput.json);
      }
      await saveUpdatedLockJsonFile(lockFileOutput.path, lockFileOutput.json);
    }

    expect(Array.from(loadJsonFile.registry.keys())).toStrictEqual([
      '/packages/package-1',
      '/packages/package-2',
      '/',
    ]);
    expect(fs.readJSONSync(rootLockFilePath)).toMatchSnapshot();
  });
});

describe('validateFileExists() method', () => {
  it(`should return true when file exist`, async () => {
    const cwd = await initFixture('lockfile-version2');
    const exists = await validateFileExists(path.join(cwd, 'package-lock.json'));

    expect(exists).toBe(true);
  });

  it(`should return false when file does not exist`, async () => {
    const cwd = await initFixture('lockfile-version2');
    const exists = await validateFileExists(path.join(cwd, 'wrong-file.json'));

    expect(exists).toBe(false);
  });
});

describe('run install lockfile-only', () => {
  describe('npm client', () => {
    it(`should update project root lockfile by calling npm script "npm install --package-lock-only" when npm version is >= 8.5.0`, async () => {
      const execSpy = jest.spyOn(core, 'exec');
      const execSyncSpy = jest.spyOn(core, 'execSync').mockReturnValue('8.5.0');
      const cwd = await initFixture('lockfile-version2');

      const lockFileOutput = await runInstallLockFileOnly('npm', cwd);

      expect(execSyncSpy).toHaveBeenCalled();
      expect(execSpy).toHaveBeenCalledWith('npm', ['install', '--package-lock-only'], { cwd });
      expect(lockFileOutput).toBe('package-lock.json');
    });

    it(`should update project root lockfile by calling npm script "npm shrinkwrap --package-lock-only" when npm version is below 8.5.0`, async () => {
      const renameSpy = jest.spyOn(nodeFs, 'renameSync');
      const execSpy = jest.spyOn(core, 'exec');
      const execSyncSpy = jest.spyOn(core, 'execSync').mockReturnValue('8.4.0');
      const cwd = await initFixture('lockfile-version2');

      const lockFileOutput = await runInstallLockFileOnly('npm', cwd);

      expect(execSyncSpy).toHaveBeenCalled();
      expect(execSpy).toHaveBeenCalledWith('npm', ['shrinkwrap', '--package-lock-only'], { cwd });
      expect(renameSpy).toHaveBeenCalledWith('npm-shrinkwrap.json', 'package-lock.json');
      expect(lockFileOutput).toBe('package-lock.json');
    });
  });

  describe('pnpm client', () => {
    it('should log an error when lockfile is not located under project root', async () => {
      const logSpy = jest.spyOn(npmlog, 'error');
      const cwd = await initFixture('lockfile-version2');

      const lockFileOutput = await runInstallLockFileOnly('pnpm', cwd);

      expect(logSpy).toHaveBeenCalledWith(
        'lock',
        expect.stringContaining(
          `we could not sync or locate "pnpm-lock.yaml" by using "pnpm" client at location ${cwd}`
        )
      );
      expect(lockFileOutput).toBe(undefined);
    });

    it(`should update project root lockfile by calling client script "pnpm install --package-lock-only"`, async () => {
      jest.spyOn(nodeFs.promises, 'access').mockResolvedValue(true);
      nodeFs.renameSync.mockImplementation(() => true);
      core.exec.mockImplementation(() => true);
      const execSpy = jest.spyOn(core, 'exec');
      const cwd = await initFixture('lockfile-version2');

      const lockFileOutput = await runInstallLockFileOnly('pnpm', cwd);

      expect(execSpy).toHaveBeenCalledWith('pnpm', ['install', '--lockfile-only', '--fix-lockfile'], { cwd });
      expect(lockFileOutput).toBe('pnpm-lock.yaml');
    });
  });

  describe('yarn client', () => {
    it(`should update project root lockfile by calling client script "yarn install --package-lock-only"`, async () => {
      jest.spyOn(nodeFs.promises, 'access').mockResolvedValue(true);
      nodeFs.renameSync.mockImplementation(() => true);
      core.exec.mockImplementation(() => true);
      const execSpy = jest.spyOn(core, 'exec');
      const cwd = await initFixture('lockfile-version2');

      const lockFileOutput = await runInstallLockFileOnly('yarn', cwd);

      expect(execSpy).toHaveBeenCalledWith('yarn', ['install', '--mode', 'update-lockfile'], { cwd });
      expect(lockFileOutput).toBe('yarn.lock');
    });
  });
});
