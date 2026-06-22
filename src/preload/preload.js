const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("catcake", {
  getState: () => ipcRenderer.invoke("state:get"),
  setMode: mode => ipcRenderer.invoke("mode:set", mode),
  setPet: petId => ipcRenderer.invoke("pet:set", petId),
  setPetSize: petSize => ipcRenderer.invoke("size:set", petSize),
  sendEvent: event => ipcRenderer.invoke("event:send", event),
  moveWindowBy: (dx, dy) => ipcRenderer.invoke("window:move-by", { dx, dy }),
  showMenu: () => ipcRenderer.invoke("menu:show"),
  quit: () => ipcRenderer.invoke("app:quit"),
  onStateChanged: listener => subscribe("state:changed", listener),
  onCustomSizeRequested: listener => subscribe("size:custom-requested", listener),
  onAgentAction: listener => subscribe("agent:action", listener)
});
