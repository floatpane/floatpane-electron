const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  shell, // shell is already here, which is great
} = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs"); // Use sync version for setup
const { exec } = require("child_process");
const os = require("os");

let mainWindow = null;
let settingsWindow = null;

// --- App Setup: Create Thumbnail Cache Directory ---
const cacheDir = path.join(app.getPath("userData"), "thumbnails");
if (!fsSync.existsSync(cacheDir)) {
  fsSync.mkdirSync(cacheDir, { recursive: true });
}

// --- Settings File Setup ---
const settingsPath = path.join(app.getPath("userData"), "settings.json");

async function getSettings() {
  try {
    await fs.access(settingsPath);
    const settingsFile = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(settingsFile);
  } catch (error) {
    // If the file doesn't exist or there's an error, return default settings
    const defaultSettings = {
      theme: "tokyo-night-blue",
      openCommand: "CommandOrControl+Shift+P",
    };
    await saveSettings(defaultSettings);
    return defaultSettings;
  }
}

async function saveSettings(settings) {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

const run = (cmd) =>
  new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(new Error(stderr));
      resolve(stdout.trim());
    });
  });

async function setWallpaper(imagePath) {
  const script = `osascript -e 'tell application "System Events" to tell every desktop to set picture to (POSIX file "${imagePath}")'`;
  return run(script);
}

function createWindow() {
  const currentDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  const { width, height } = currentDisplay.workAreaSize;

  const windowWidth = 1920;
  const windowHeight = 1080;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(currentDisplay.bounds.x + (width - windowWidth) / 2),
    y: Math.round(currentDisplay.bounds.y + (height - windowHeight) / 2),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    transparent: true,
    show: false,
    vibrancy: "light",
    alwaysOnTop: true,
    level: "floating",
    visibleOnAllWorkspaces: true,
    resizable: false,
    focusable: true,
  });

  console.log("Main window created.");

  if (process.platform === "darwin") {
    app.dock.hide();
  }

  mainWindow.loadFile(path.join(__dirname, "dist/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("toggle-settings", () => {
  if (mainWindow) {
    mainWindow.webContents.send("toggle-settings");
  }
});

app.whenReady().then(async () => {
  console.log("App is ready.");
  const settings = await getSettings();
  console.log("Settings loaded:", settings);
  globalShortcut.register(settings.openCommand, () => {
    console.log("Global shortcut triggered.");
    if (mainWindow) {
      mainWindow.close();
    } else {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// --- IPC Handlers ---

ipcMain.handle("get-settings", async () => {
  return await getSettings();
});

ipcMain.handle("save-settings", async (event, settings) => {
  await saveSettings(settings);
  // You might want to re-register the shortcut if it changed
  globalShortcut.unregisterAll();
  const newSettings = await getSettings();
  globalShortcut.register(newSettings.openCommand, () => {
    if (mainWindow) {
      mainWindow.close();
    } else {
      createWindow();
    }
  });
  if (mainWindow) {
    mainWindow.webContents.send("theme-updated", newSettings.theme);
  }
});

ipcMain.handle("get-themes", async () => {
  const themeDir = path.join(__dirname, "dist/themes");
  try {
    const files = await fs.readdir(themeDir);
    const themes = await Promise.all(
      files.map(async (file) => {
        if (file.endsWith(".json")) {
          const filePath = path.join(themeDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          return JSON.parse(content);
        }
        return null;
      }),
    );
    return themes.filter((theme) => theme !== null);
  } catch (error) {
    console.error(`Error reading theme directory: ${themeDir}`, error);
    return [];
  }
});

// **FIXED**: Handler to open external links securely in the user's default browser.
ipcMain.handle("open-external-link", async (event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("get-wallpapers", async () => {
  const wallpaperDir = path.join(os.homedir(), "wallpapers");
  try {
    if (!fsSync.existsSync(wallpaperDir)) {
      fsSync.mkdirSync(wallpaperDir, { recursive: true });
    }
    const files = await fs.readdir(wallpaperDir);
    return files.filter((file) => /\.(jpg|jpeg|png|heic|webp)$/i.test(file));
  } catch (error) {
    console.error(`Error reading wallpaper directory: ${wallpaperDir}`, error);
    throw new Error(`Could not read wallpapers from: ~/wallpapers.`);
  }
});

ipcMain.handle("open-wallpapers-folder", async () => {
  const wallpaperDir = path.join(os.homedir(), "wallpapers");
  try {
    if (!fsSync.existsSync(wallpaperDir)) {
      fsSync.mkdirSync(wallpaperDir, { recursive: true });
    }
    await shell.openPath(wallpaperDir);
  } catch (error) {
    console.error(`Failed to open wallpaper directory: ${wallpaperDir}`, error);
    throw error;
  }
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("set-wallpaper", async (event, imageName) => {
  const imagePath = path.join(os.homedir(), "wallpapers", imageName);
  try {
    await setWallpaper(imagePath);
    return imagePath;
  } catch (error) {
    console.error(`Failed to set wallpaper: ${imageName}`, error);
    throw error;
  }
});

ipcMain.handle("get-current-wallpaper", async () => {
  try {
    return await run(
      `osascript -e 'tell application "System Events" to tell every desktop to get picture'`,
    );
  } catch (error) {
    console.error("Failed to get current wallpaper", error);
    throw error;
  }
});

ipcMain.handle("get-image-as-base64", async (event, fullPath) => {
  try {
    const data = await fs.readFile(fullPath);
    return data.toString("base64");
  } catch (error) {
    console.error(`Failed to read file: ${fullPath}`, error);
    throw error;
  }
});

ipcMain.handle("get-thumbnail", async (event, imageName) => {
  const sourcePath = path.join(os.homedir(), "wallpapers", imageName);
  const thumbPath = path.join(cacheDir, imageName);

  try {
    await fs.access(thumbPath);
    const data = await fs.readFile(thumbPath);
    return data.toString("base64");
  } catch {
    try {
      const sipsCommand = `sips -Z 400 "${sourcePath}" --out "${thumbPath}"`;
      await run(sipsCommand);
      const data = await fs.readFile(thumbPath);
      return data.toString("base64");
    } catch (generationError) {
      console.error(
        `Failed to generate thumbnail for ${imageName}:`,
        generationError,
      );
      throw generationError;
    }
  }
});

ipcMain.on("hide-window", () => {
  if (mainWindow) {
    mainWindow.close();
  }
});
