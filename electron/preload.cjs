const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('chartshift', {
  openFile: call('file:open'),
  openAudio: call('audio:open'),
  saveFile: call('file:save'),
  print: call('print'),
  setDirty: (dirty) => ipcRenderer.send('dirty', dirty),
  setTitle: (title) => ipcRenderer.send('title', title),
  library: {
    info: call('library:info'),
    list: call('library:list'),
    read: call('library:read'),
    exists: call('library:exists'),
    write: call('library:write'),
    remove: call('library:remove'),
    rename: call('library:rename'),
    saveSetlist: call('library:saveSetlist'),
    removeSetlist: call('library:removeSetlist'),
    reveal: call('library:reveal'),
    exportAll: call('library:export'),
    importAll: call('library:import'),
    setFolder: call('library:setFolder'),
  },
  update: {
    check: call('update:check'),
    download: call('update:download'),
    install: call('update:install'),
    // Calls back with { received, total } while the installer downloads; returns a function that stops listening.
    onProgress: (listener) => {
      const wrapped = (_event, progress) => listener(progress);
      ipcRenderer.on('update:progress', wrapped);
      return () => ipcRenderer.removeListener('update:progress', wrapped);
    },
  },
  recovery: {
    save: call('recovery:save'),
    load: call('recovery:load'),
    clear: call('recovery:clear'),
  },
});
