// The floating brain's only link to the app: its gestures go out, its status comes in.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = ['widget:drag-start', 'widget:drag', 'widget:drag-end', 'widget:resize-start', 'widget:resize', 'widget:resize-end',
  'widget:open', 'widget:menu'];
contextBridge.exposeInMainWorld('alfred', {
  send: (channel) => { if (SEND.includes(channel)) ipcRenderer.send(channel); },
  onStatus: (fn) => ipcRenderer.on('widget:status', (_event, status) => fn(status)),
});
