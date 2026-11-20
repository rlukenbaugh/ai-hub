'use strict';
// The only bridge between the hub page and the app. Every call is a fixed, named operation;
// the page never passes a program location or runs anything itself.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('hub', {
  init: invoke('app:init'),
  saveSettings: invoke('settings:save'),
  openTile: invoke('tiles:open'),
  tileMenu: invoke('tiles:menu'),
  rescan: invoke('tiles:rescan'),
  addWeb: invoke('tiles:addWeb'),
  chooseProgram: invoke('tiles:chooseProgram'),
  removeTile: invoke('tiles:remove'),
  restoreTile: invoke('tiles:restore'),
  hiddenTiles: invoke('tiles:hidden'),
  renameTile: invoke('tiles:rename'),
  reorderTiles: invoke('tiles:reorder'),
  activateTab: invoke('tabs:activate'),
  closeTab: invoke('tabs:close'),
  navTab: invoke('tabs:nav'),
  zoomTab: invoke('tabs:zoom'),
  nextTab: invoke('tabs:next'),
  closeActiveTab: invoke('tabs:closeActive'),
  setTabBounds: invoke('tabs:bounds'),
  setTabsCovered: invoke('tabs:covered'),
  signOutAll: invoke('tabs:signOutAll'),
  openDataFolder: invoke('app:openDataFolder'),
  quit: invoke('app:quit'),
  updateStatus: invoke('update:status'),
  checkUpdate: invoke('update:check'),
  installUpdate: invoke('update:install'),
  onTiles: listen('tiles:changed'),
  onScanning: listen('tiles:scanning'),
  onTileAction: listen('tiles:action'),
  onTabs: listen('tabs:changed'),
  onKey: listen('key'),
  onToast: listen('toast'),
  onSettings: listen('settings:changed'),
  onUpdate: listen('update:status'),
});
