const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen
} = require("electron");
const { AgentServer } = require("../agent/server");

const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 360;
const DEFAULT_MODE = "quiet";
const SETTINGS_VERSION = 1;
const TRAY_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVR4AWP4//8/AyUYTFhYGJmBQsBEw4BhMGoYBoOGYTAaBoNRAwA3OAQQfEPFtwAAAABJRU5ErkJggg==";

let petWindow = null;
let tray = null;
let manifest = null;
let settings = null;
let agentServer = null;

function appPath(...segments) {
  return path.join(app.getAppPath(), ...segments);
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadManifest() {
  const manifestPath = appPath("assets", "pets", "manifest.json");
  const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (!Array.isArray(data.pets) || data.pets.length === 0) {
    throw new Error("assets/pets/manifest.json must contain pets.");
  }

  return data;
}

function normalizeSettings(raw = {}) {
  const petIds = new Set(manifest.pets.map(pet => pet.id));
  const canReuseStoredSettings = raw.settingsVersion === SETTINGS_VERSION;
  const mode = canReuseStoredSettings && raw.mode === "active" ? "active" : DEFAULT_MODE;
  const storedPetId = canReuseStoredSettings ? raw.petId : manifest.defaultPetId;
  const petId = petIds.has(storedPetId) ? storedPetId : manifest.defaultPetId;

  return {
    settingsVersion: SETTINGS_VERSION,
    mode,
    petId: petIds.has(petId) ? petId : manifest.pets[0].id,
    muted: canReuseStoredSettings ? Boolean(raw.muted) : false
  };
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"));
    return normalizeSettings(raw);
  } catch (_error) {
    return normalizeSettings();
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function getCurrentPet() {
  return manifest.pets.find(pet => pet.id === settings.petId) || manifest.pets[0];
}

function getPublicState() {
  return {
    appVersion: app.getVersion(),
    mode: settings.mode,
    muted: settings.muted,
    currentPet: getCurrentPet(),
    manifest,
    agent: {
      baseUrl: agentServer && agentServer.port ? `http://127.0.0.1:${agentServer.port}` : null
    }
  };
}

function emitState() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("state:changed", getPublicState());
  }
  refreshMenus();
  saveSettings();
}

function clampWindowPosition(x, y) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  const maxX = area.x + area.width - WINDOW_WIDTH;
  const maxY = area.y + area.height - WINDOW_HEIGHT;

  return {
    x: Math.min(Math.max(x, area.x), maxX),
    y: Math.min(Math.max(y, area.y), maxY)
  };
}

function moveWindowBy(dx, dy) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  const [x, y] = petWindow.getPosition();
  const next = clampWindowPosition(x + Math.round(dx), y + Math.round(dy));
  petWindow.setPosition(next.x, next.y);
}

function positionInitialWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const x = area.x + area.width - WINDOW_WIDTH - 48;
  const y = area.y + area.height - WINDOW_HEIGHT - 32;
  return clampWindowPosition(x, y);
}

function createPetWindow() {
  const position = positionInitialWindow();

  petWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: position.x,
    y: position.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    webPreferences: {
      preload: appPath("src", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.setAlwaysOnTop(true, "screen-saver");
  petWindow.loadFile(appPath("src", "renderer", "index.html"));

  petWindow.once("ready-to-show", () => {
    petWindow.showInactive();
    emitState();
  });

  petWindow.on("closed", () => {
    petWindow = null;
  });
}

function buildContextMenu() {
  const petItems = manifest.pets.map(pet => ({
    label: pet.name,
    type: "radio",
    checked: settings.petId === pet.id,
    click: () => setPet(pet.id)
  }));

  return Menu.buildFromTemplate([
    {
      label: "安静模式",
      type: "radio",
      checked: settings.mode === "quiet",
      click: () => setMode("quiet")
    },
    {
      label: "活泼模式",
      type: "radio",
      checked: settings.mode === "active",
      click: () => setMode("active")
    },
    { type: "separator" },
    {
      label: "切换猫猫糕",
      submenu: petItems
    },
    {
      label: settings.muted ? "取消静音" : "静音",
      type: "checkbox",
      checked: settings.muted,
      click: () => {
        settings.muted = !settings.muted;
        emitState();
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit()
    }
  ]);
}

function refreshMenus() {
  if (tray) {
    tray.setContextMenu(buildContextMenu());
    tray.setToolTip(`猫猫糕桌宠 - ${getCurrentPet().name}`);
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON));
  refreshMenus();
  tray.on("click", () => {
    if (petWindow) {
      petWindow.showInactive();
    }
  });
}

function setMode(mode) {
  settings.mode = mode === "active" ? "active" : "quiet";
  emitState();
  if (agentServer) {
    agentServer.handlePetEvent({ type: "modeChanged" });
  }
}

function setPet(petId) {
  if (!manifest.pets.some(pet => pet.id === petId)) {
    return;
  }

  settings.petId = petId;
  emitState();
  if (agentServer) {
    agentServer.handlePetEvent({ type: "petChanged" });
  }
}

function registerIpc() {
  ipcMain.handle("state:get", () => getPublicState());
  ipcMain.handle("mode:set", (_event, mode) => {
    setMode(mode);
    return getPublicState();
  });
  ipcMain.handle("pet:set", (_event, petId) => {
    setPet(petId);
    return getPublicState();
  });
  ipcMain.handle("event:send", (_event, petEvent) => {
    return agentServer.handlePetEvent({
      ...petEvent,
      petId: settings.petId,
      mode: settings.mode,
      timestamp: new Date().toISOString()
    }, { emit: false });
  });
  ipcMain.handle("window:move-by", (_event, delta) => {
    moveWindowBy(Number(delta.dx) || 0, Number(delta.dy) || 0);
  });
  ipcMain.handle("menu:show", () => {
    if (petWindow) {
      buildContextMenu().popup({ window: petWindow });
    }
  });
  ipcMain.handle("app:quit", () => app.quit());
}

async function bootstrap() {
  manifest = loadManifest();
  settings = loadSettings();
  registerIpc();

  agentServer = new AgentServer({
    getState: getPublicState,
    onAction: action => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("agent:action", action);
      }
    }
  });
  await agentServer.start();
  console.log(`Catcake agent listening on http://127.0.0.1:${agentServer.port}`);

  createPetWindow();
  createTray();
}

app.whenReady().then(bootstrap);

app.on("before-quit", async event => {
  if (agentServer && agentServer.server) {
    event.preventDefault();
    const server = agentServer;
    agentServer = null;
    await server.stop();
    app.quit();
  }
});

app.on("window-all-closed", event => {
  event.preventDefault();
});
