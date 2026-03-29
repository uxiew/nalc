import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import fs from 'fs-extra'
import {
  readCatalogConfig,
  resolveCatalogDependency,
  isCatalogDependency,
  catalogCacheManager,
} from '../src/catalog'

// 临时测试目录
const TEST_DIR = path.join('test', 'catalog-test-' + Date.now())

describe('Catalog Support', () => {
  beforeAll(() => {
    fs.ensureDirSync(TEST_DIR)
  })

  afterAll(() => {
    fs.removeSync(TEST_DIR)
  })

  beforeEach(() => {
    // 每次测试前清理缓存
    catalogCacheManager.clearCache()
  })

  describe('isCatalogDependency', () => {
    it('should identify catalog dependencies', () => {
      expect(isCatalogDependency('catalog:')).toBe(true)
      expect(isCatalogDependency('catalog:default')).toBe(true)
      expect(isCatalogDependency('catalog:named')).toBe(true)
    })

    it('should reject non-catalog dependencies', () => {
      expect(isCatalogDependency('^1.0.0')).toBe(false)
      expect(isCatalogDependency('file:../foo')).toBe(false)
      expect(isCatalogDependency('workspace:*')).toBe(false)
    })
  })

  describe('readCatalogConfig with pnpm-workspace.yaml', () => {
    it('should parse simple catalog', () => {
      const workspaceYaml = `
packages:
  - 'packages/*'

catalog:
  react: ^18.0.0
  lodash: ^4.17.21
`
      const workspaceDir = path.join(TEST_DIR, 'simple')
      fs.ensureDirSync(workspaceDir)
      fs.writeFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), workspaceYaml)

      const config = readCatalogConfig(workspaceDir)
      expect(config.default).toEqual({
        react: '^18.0.0',
        lodash: '^4.17.21'
      })
    })

    it('should parse named catalogs', () => {
      const workspaceYaml = `
catalogs:
  react17:
    react: ^17.0.0
  react18:
    react: ^18.0.0
`
      const workspaceDir = path.join(TEST_DIR, 'named')
      fs.ensureDirSync(workspaceDir)
      fs.writeFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), workspaceYaml)

      const config = readCatalogConfig(workspaceDir)
      expect(config.named).toHaveProperty('react17')
      expect(config.named?.react17).toEqual({ react: '^17.0.0' })
      expect(config.named?.react18).toEqual({ react: '^18.0.0' })
    })
  })

  describe('resolveCatalogDependency', () => {
    const mockConfig = {
      default: {
        'react': '^18.2.0',
        'foo': '1.0.0'
      },
      named: {
        'legacy': {
          'react': '^16.8.0'
        }
      }
    }

    it('should resolve from default catalog', () => {
      const resolved = resolveCatalogDependency('catalog:', 'react', mockConfig)
      expect(resolved).toBe('^18.2.0')
    })

    it('should resolve from named catalog', () => {
      const resolved = resolveCatalogDependency('catalog:legacy', 'react', mockConfig)
      expect(resolved).toBe('^16.8.0')
    })

    it('should fallback to original if not found', () => {
      const resolved = resolveCatalogDependency('catalog:', 'not-exist', mockConfig)
      expect(resolved).toBe('catalog:')
    })
  })
})
