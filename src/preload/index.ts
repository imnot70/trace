import { contextBridge, ipcRenderer } from 'electron'
import type { TraceApi } from '@shared/api'
import type { FsChangedPayload, GitEventPayload } from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: TraceApi = {
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  setWorkspace: (root) => ipcRenderer.invoke('workspace:set', root),
  chooseDirectory: (current) => ipcRenderer.invoke('workspace:choose', current),
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  listVaults: () => ipcRenderer.invoke('vault:list'),
  createVault: (name, description) => ipcRenderer.invoke('vault:create', name, description),
  renameVault: (oldName, newName) => ipcRenderer.invoke('vault:rename', oldName, newName),
  deleteVault: (name) => ipcRenderer.invoke('vault:delete', name),

  listTree: (vault) => ipcRenderer.invoke('tree:list', vault),
  createDir: (vault, parentPath, name) => ipcRenderer.invoke('dir:create', vault, parentPath, name),
  createNote: (vault, parentPath, name) => ipcRenderer.invoke('note:create', vault, parentPath, name),
  renameNode: (vault, path, kind, newName) => ipcRenderer.invoke('node:rename', vault, path, kind, newName),
  deleteNode: (vault, path, kind) => ipcRenderer.invoke('node:delete', vault, path, kind),
  readNote: (vault, path) => ipcRenderer.invoke('note:read', vault, path),
  writeNote: (vault, path, content, expectedHash) =>
    ipcRenderer.invoke('note:write', vault, path, content, expectedHash),
  saveImage: (vault, notePath, fileName, base64) =>
    ipcRenderer.invoke('note:saveImage', vault, notePath, fileName, base64),

  listFavorites: () => ipcRenderer.invoke('favorite:list'),
  addFavorite: (vault, path, name) => ipcRenderer.invoke('favorite:add', vault, path, name),
  removeFavorite: (vault, path) => ipcRenderer.invoke('favorite:remove', vault, path),
  listRecents: () => ipcRenderer.invoke('recent:list'),
  addRecent: (vault, path, name) => ipcRenderer.invoke('recent:add', vault, path, name),
  removeRecent: (vault, path) => ipcRenderer.invoke('recent:remove', vault, path),

  listTrash: () => ipcRenderer.invoke('trash:list'),
  restoreTrash: (id) => ipcRenderer.invoke('trash:restore', id),
  purgeTrash: (id) => ipcRenderer.invoke('trash:purge', id),
  emptyTrash: () => ipcRenderer.invoke('trash:empty'),

  getAccount: () => ipcRenderer.invoke('account:get'),
  login: (token) => ipcRenderer.invoke('account:login', token),
  logout: () => ipcRenderer.invoke('account:logout'),
  listRemoteRepos: () => ipcRenderer.invoke('account:listRepos'),
  createRemoteRepo: (name, isPrivate) => ipcRenderer.invoke('account:createRepo', name, isPrivate),

  getGitStatus: (vault) => ipcRenderer.invoke('git:status', vault),
  associateVault: (vault, repoFullName) => ipcRenderer.invoke('git:associate', vault, repoFullName),
  disconnectVault: (vault) => ipcRenderer.invoke('git:disconnect', vault),
  syncVault: (vault) => ipcRenderer.invoke('git:sync', vault),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  listPlugins: () => ipcRenderer.invoke('plugin:list'),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugin:setEnabled', id, enabled),

  onFsChanged: (cb) => subscribe<FsChangedPayload>('fs:changed', cb),
  onGitEvent: (cb) => subscribe<GitEventPayload>('git:event', cb),
  onPluginNotify: (cb) => subscribe<string>('plugin:notify', cb)
}

contextBridge.exposeInMainWorld('trace', api)
