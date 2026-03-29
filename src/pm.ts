import { execSync, ExecSyncOptions } from 'node:child_process'
import path from 'node:path'
import fs from 'fs-extra'

import { execLoudOptions } from './utils'

export type PackageManagerName = 'yarn' | 'npm' | 'pnpm' | 'bun'

export const pmMarkFiles: { [P in PackageManagerName]: string[] } = {
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  npm: ['package-lock.json'],
  bun: ['bun.lockb', 'bun.lock'],
}

export const pmInstallCmd: { [P in PackageManagerName]: string } = {
  pnpm: 'pnpm install',
  yarn: 'yarn',
  npm: 'npm install',
  bun: 'bun install',
}

export const pmUpdateCmd: { [P in PackageManagerName]: string } = {
  pnpm: 'pnpm update',
  yarn: 'yarn upgrade',
  npm: 'npm update',
  bun: 'bun update',
}

export const pmRunScriptCmd: { [P in PackageManagerName]: string } = {
  pnpm: 'pnpm',
  yarn: 'yarn',
  npm: 'npm run',
  bun: 'bun run',
}

const defaultPm: PackageManagerName = 'npm'

const detectPmFromFiles = (cwd: string): PackageManagerName | false => {
  const pms = Object.keys(pmMarkFiles) as PackageManagerName[]
  return pms.reduce<PackageManagerName | false>((found, pm) => {
    return (
      found ||
      (pmMarkFiles[pm].reduce<PackageManagerName | false>(
        (resolved, file) => resolved || (fs.existsSync(path.join(cwd, file)) && pm),
        false
      ) &&
        pm)
    )
  }, false)
}

export const getPm = (
  cwd: string,
  fallbackPm?: PackageManagerName
): PackageManagerName => detectPmFromFiles(cwd) || fallbackPm || defaultPm

export const getRunScriptCmd = (cwd: string) =>
  pmInstallCmd[getPm(cwd)]

export const getPmInstallCmd = (cwd: string, fallbackPm?: PackageManagerName) =>
  pmInstallCmd[getPm(cwd, fallbackPm)]

export const getPmUpdateCmd = (cwd: string, fallbackPm?: PackageManagerName) =>
  pmUpdateCmd[getPm(cwd, fallbackPm)]

export const isYarn = (cwd: string, fallbackPm?: PackageManagerName) =>
  getPm(cwd, fallbackPm) === 'yarn'

export const runPmUpdate = (workingDir: string, packages: string[]) => {
  const pkgMgrCmd = [getPmUpdateCmd(workingDir), ...packages].join(' ')

  console.log(`Running ${pkgMgrCmd} in ${workingDir}`)
  execSync(pkgMgrCmd, { cwd: workingDir, ...execLoudOptions })
}

export const runPmInstall = (
  workingDir: string,
  fallbackPm?: PackageManagerName,
  options: ExecSyncOptions = {},
) => {
  const pkgMgrCmd = getPmInstallCmd(workingDir, fallbackPm)
  console.log(`Running ${pkgMgrCmd} in ${workingDir}`)
  execSync(pkgMgrCmd, { cwd: workingDir, ...execLoudOptions, ...options })
}
