import { publishPackageToRegistry } from './registry/publish'

export interface PublishPackageOptions {
  workingDir: string
  mode?: 'registry'
  changed?: boolean
  push?: boolean
  update?: boolean
  content?: boolean
  private?: boolean
  scripts?: boolean
  devMod?: boolean
  workspaceResolve?: boolean
  ignore?: {
    files?: string[]
    packages?: string[]
  }
}

/**
 * Publish a package through the nalc registry pipeline.
 */
export const publishPackage = async (options: PublishPackageOptions) =>
  publishPackageToRegistry({
    ...options,
    mode: 'registry',
  })
