export { WorkspaceService } from './workspace'
export { VaultService } from './vaults'
export { VaultMetaService } from './vaultMeta'
export { FsTreeService } from './fsTree'
export { TrashService } from './trash'
export { FavoritesService, RecentsService } from './favorites'
export { TagsService } from './tags'
export { ThemeService } from './themes'
export { SettingsService } from './settings'
export { AccountService } from './account'
export { GithubService } from './github'
export { GitService } from './gitService'
export {
  bundledGitCandidates,
  parseGitVersion,
  pickGitBinary,
  readGitVersion,
  resolveBundledGitPath
} from './bundledGit'
export type { GitSourcePreference } from './bundledGit'
export { WatcherService } from './watcher'
export { PluginHost, type RuntimeHandle, type RuntimeSpawner, type PluginHostDeps } from './pluginHost'
export { spawnUtilityRuntime } from './pluginRuntime'
export { dispatchCapabilityCall, type GatewayServices } from './pluginGateway'
export type { PluginManifest } from './pluginManifest'
export { AutoSyncService } from './autoSync'
export { ExportService, sanitizeFileName } from './exportPdf'
export { applyWindowGlassEffect } from './windowEffect'
export { SearchService } from './search'
export { WikilinkService } from './wikilink'
export type { PluginInfo } from '@shared/types'
