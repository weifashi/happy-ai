/**
 * Global configuration for happy CLI
 * 
 * Centralizes all configuration including environment variables and paths
 * Environment files should be loaded using Node's --env-file flag
 */

import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import packageJson from '../package.json'

class Configuration {
  public readonly serverUrl: string
  public readonly webappUrl: string
  public readonly isDaemonProcess: boolean

  // Directories and paths (from persistence)
  public readonly happyHomeDir: string
  public readonly logsDir: string
  public readonly settingsFile: string
  public readonly privateKeyFile: string
  public readonly daemonStateFile: string
  public readonly daemonLockFile: string
  public readonly sessionKeysDir: string
  public readonly currentCliVersion: string

  public readonly isExperimentalEnabled: boolean
  public readonly disableCaffeinate: boolean

  constructor() {
    // Server configuration - priority: parameter > environment > default
    this.serverUrl = process.env.HAPPY_SERVER_URL || 'https://api.happy.weifashi.cn'
    this.webappUrl = process.env.HAPPY_WEBAPP_URL || 'https://app.happy.weifashi.cn'

    // Check if we're running as daemon based on process args
    const args = process.argv.slice(2)
    this.isDaemonProcess = args.length >= 2 && args[0] === 'daemon' && (args[1] === 'start-sync')

    // Directory configuration - Priority: HAPPY_HOME_DIR env > default home dir
    if (process.env.HAPPY_HOME_DIR) {
      // Expand ~ to home directory if present
      const expandedPath = process.env.HAPPY_HOME_DIR.replace(/^~/, homedir())
      this.happyHomeDir = expandedPath
    } else {
      this.happyHomeDir = join(homedir(), '.happy-ai')
    }

    this.logsDir = join(this.happyHomeDir, 'logs')
    this.settingsFile = join(this.happyHomeDir, 'settings.json')
    this.privateKeyFile = join(this.happyHomeDir, 'access.key')
    this.daemonStateFile = join(this.happyHomeDir, 'daemon.state.json')
    this.daemonLockFile = join(this.happyHomeDir, 'daemon.state.json.lock')
    this.sessionKeysDir = join(this.happyHomeDir, 'session-keys')

    this.isExperimentalEnabled = ['true', '1', 'yes'].includes(process.env.HAPPY_EXPERIMENTAL?.toLowerCase() || '');
    this.disableCaffeinate = ['true', '1', 'yes'].includes(process.env.HAPPY_DISABLE_CAFFEINATE?.toLowerCase() || '');

    this.currentCliVersion = packageJson.version

    // Validate variant configuration
    const variant = process.env.HAPPY_VARIANT || 'stable'
    if (variant === 'dev' && !this.happyHomeDir.includes('dev')) {
      console.warn('⚠️  WARNING: HAPPY_VARIANT=dev but HAPPY_HOME_DIR does not contain "dev"')
      console.warn(`   Current: ${this.happyHomeDir}`)
      console.warn(`   Expected: Should contain "dev" (e.g., ~/.happy-ai-dev)`)
    }

    // Visual indicator on CLI startup (only if not daemon process to avoid log clutter)
    if (!this.isDaemonProcess && variant === 'dev') {
      console.log('\x1b[33m🔧 DEV MODE\x1b[0m - Data: ' + this.happyHomeDir)
    }

    // Migrate ~/.happy → ~/.happy-ai for existing happy-ai users
    if (!existsSync(this.happyHomeDir) && !process.env.HAPPY_HOME_DIR) {
      const legacyDir = join(homedir(), '.happy')
      if (existsSync(legacyDir) && this.isLegacyDirFromHappyNext(legacyDir)) {
        try {
          renameSync(legacyDir, this.happyHomeDir)
          console.log(`Migrated ${legacyDir} → ${this.happyHomeDir}`)
        } catch {
          // Another process may have already migrated or removed the directory
        }
      }
    }

    if (!existsSync(this.happyHomeDir)) {
      mkdirSync(this.happyHomeDir, { recursive: true })
    }
    // Ensure directories exist
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true })
    }
  }

  private isLegacyDirFromHappyNext(legacyDir: string): boolean {
    try {
      const logsDir = join(legacyDir, 'logs')
      if (!existsSync(logsDir)) return false
      const needle = Buffer.from('happy-ai-cli')
      const logFiles = readdirSync(logsDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ name: f, mtime: statSync(join(logsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 5)
      for (const { name } of logFiles) {
        const fd = openSync(join(logsDir, name), 'r')
        try {
          const buf = Buffer.alloc(4096)
          readSync(fd, buf, 0, 4096, 0)
          if (buf.includes(needle)) return true
        } finally {
          closeSync(fd)
        }
      }
    } catch {
      // ignore read errors
    }
    return false
  }
}

export const configuration: Configuration = new Configuration()
