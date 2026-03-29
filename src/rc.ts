import fs from 'fs'
import ini from 'ini'

import { VALUES, VALID_FLAGS } from './constant'

const { rcFile } = VALUES

/**
 * Read ini file
 * @returns ini file content
 */
const readIniFile = (): Record<string, string | boolean> | null => {
  if (fs.existsSync(rcFile)) {
    return ini.parse(fs.readFileSync(rcFile, 'utf-8'))
  }
  return null
}

/**
 * 读取配置文件
 * @returns 配置项
 */
export const readRcConfig = (): Record<string, string | boolean> => {
  const rcOptions = readIniFile()
  if (!rcOptions) return {}

  const unknown = Object.keys(rcOptions).filter(
    (key) => !VALID_FLAGS.includes(key)
  )

  if (unknown.length) {
    console.warn(`Unknown option in ${rcFile}: ${unknown[0]}`)
    process.exit()
  }


  // Handle ignore/excluded specially to support array from rc
  const parsedConfig: Record<string, any> = {
    ignore: {}
  }

  // default to support top-level ignore entry if user just does ignore = a,b (older behavior or different style)
  if (typeof rcOptions?.ignore === 'string') {
    parsedConfig.ignore.files = rcOptions.ignore.split(',').map(s => s.trim())
  }

  // Handle ignore/excluded specially to support array from rc
  // [ignore]
  // packages = a,b,c
  // files = .DS_Store, *.log
  if (typeof rcOptions?.ignore === 'object') {
    const ignoreSection = rcOptions.ignore as Record<string, string>
    if (ignoreSection.files) {
      parsedConfig.ignore.files = (ignoreSection.files as string).split(',').map(s => s.trim())
    }
    if (ignoreSection.packages) {
      if (typeof ignoreSection.packages === 'string') {
        parsedConfig.ignore.packages = ignoreSection.packages.split(',').map(s => s.trim())
      } else if (Array.isArray(ignoreSection.packages)) {
        parsedConfig.ignore.packages = ignoreSection.packages
      }
    }
  }

  return Object.keys(rcOptions).reduce((prev, flag) => {
    if (flag === 'ignore') return prev // We processed it above
    if (!VALID_FLAGS.includes(flag)) return prev

    let value = rcOptions[flag]
    return { ...prev, [flag]: value }
  }, parsedConfig)
}
