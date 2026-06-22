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

const DEFAULT_MODE = "quiet";
const SETTINGS_VERSION = 1;
const DEFAULT_PET_SIZE = 256;
const MIN_PET_SIZE = 160;
const MAX_PET_SIZE = 420;
const WINDOW_EXTRA_WIDTH = 64;
const WINDOW_EXTRA_HEIGHT = 104;
const SIZE_PRESETS = [
  { label: "80%", value: 205 },
  { label: "100%", value: 256 },
  { label: "125%", value: 320 },
  { label: "150%", value: 384 }
];
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

function clampPetSize(value) {
  const size = Math.round(Number(value) || DEFAULT_PET_SIZE);
  return Math.min(Math.max(size, MIN_PET_SIZE), MAX_PET_SIZE);
}

function getWindowSize(petSize = settings ? settings.petSize : DEFAULT_PET_SIZE) {
  const normalizedPetSize = clampPetSize(petSize);
  return {
    width: normalizedPetSize + WINDOW_EXTRA_WIDTH,
    height: normalizedPetSize + WINDOW_EXTRA_HEIGHT
  };
}

function normalizeSettings(raw = {}) {
  const petIds = new Set(manifest.pets.map(pet => pet.id));
  const canReuseStoredSettings = raw.settingsVersion === SETTINGS_VERSION;
  const mode = canReuseStoredSettings && raw.mode === "active" ? "active" : DEFAULT_MODE;
  const storedPetId = canReuseStoredSettings ? raw.petId : manifest.defaultPetId;
  const petId = petIds.has(storedPetId) ? storedPetId : manifest.defaultPetId;
  const petSize = canReuseStoredSettings ? clampPetSize(raw.petSize) : DEFAULT_PET_SIZE;

  return {
    settingsVersion: SETTINGS_VERSION,
    mode,
    petId: petIds.has(petId) ? petId : manifest.pets[0].id,
    petSize,
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
    size: {
      petSize: settings.petSize,
      min: MIN_PET_SIZE,
      max: MAX_PET_SIZE,
      presets: SIZE_PRESETS
    },
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

function clampWindowPosition(x, y, size = getWindowSize()) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  const maxX = Math.max(area.x, area.x + area.width - size.width);
  const maxY = Math.max(area.y, area.y + area.height - size.height);

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
  const size = getWindowSize();
  const x = area.x + area.width - size.width - 48;
  const y = area.y + area.height - size.height - 32;
  return clampWindowPosition(x, y, size);
}

function resizeWindowForPetSize() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  const nextSize = getWindowSize();
  const bounds = petWindow.getBounds();
  const centerX = bounds.x + bounds.width / 2;
  const bottom = bounds.y + bounds.height;
  const next = clampWindowPosition(
    Math.round(centerX - nextSize.width / 2),
    Math.round(bottom - nextSize.height),
    nextSize
  );

  petWindow.setBounds({
    x: next.x,
    y: next.y,
    width: nextSize.width,
    height: nextSize.height
  });
}

function createPetWindow() {
  const size = getWindowSize();
  const position = positionInitialWindow();

  petWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
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
  const sizeItems = SIZE_PRESETS.map(preset => ({
    label: `${preset.label} (${preset.value}px)`,
    type: "radio",
    checked: settings.petSize === preset.value,
    click: () => setPetSize(preset.value)
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
      label: "大小",
      submenu: [
        ...sizeItems,
        { type: "separator" },
        {
          label: `自定义... (${MIN_PET_SIZE}-${MAX_PET_SIZE}px)`,
          click: () => requestCustomSize()
        }
      ]
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

function setPetSize(value) {
  const nextSize = clampPetSize(value);

  if (settings.petSize === nextSize) {
    return;
  }

  settings.petSize = nextSize;
  resizeWindowForPetSize();
  emitState();
}

function requestCustomSize() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("size:custom-requested", {
      current: settings.petSize,
      min: MIN_PET_SIZE,
      max: MAX_PET_SIZE
    });
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
  ipcMain.handle("size:set", (_event, petSize) => {
    setPetSize(petSize);
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
