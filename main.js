const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- IPC Handlers ---

ipcMain.handle('list-dir', async (e, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map(entry => {
      const full = path.join(dirPath, entry.name);
      let size = 0, mtime = null;
      try {
        const stat = fs.statSync(full);
        size = stat.size;
        mtime = stat.mtime.toISOString();
      } catch (_) {}
      return { name: entry.name, isDir: entry.isDirectory(), size, mtime };
    });
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('list-drives', async () => {
  if (process.platform === 'win32') {
    const drives = [];
    for (let i = 65; i <= 90; i++) {
      const d = String.fromCharCode(i) + ':\\';
      try { fs.accessSync(d); drives.push(d); } catch (_) {}
    }
    return drives;
  }
  return ['/'];
});

ipcMain.handle('home-dir', () => os.homedir());

ipcMain.handle('copy-item', async (e, src, destDir) => {
  try {
    const dest = path.join(destDir, path.basename(src));
    copyRecursive(src, dest);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('move-item', async (e, src, destDir) => {
  try {
    const dest = path.join(destDir, path.basename(src));
    fs.renameSync(src, dest);
    return { ok: true };
  } catch (err) {
    // Cross-device: copy then delete
    try {
      const dest = path.join(destDir, path.basename(src));
      copyRecursive(src, dest);
      deleteRecursive(src);
      return { ok: true };
    } catch (err2) {
      return { ok: false, error: err2.message };
    }
  }
});

ipcMain.handle('delete-item', async (e, itemPath) => {
  try {
    deleteRecursive(itemPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rename-item', async (e, oldPath, newName) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName);
    fs.renameSync(oldPath, newPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('mkdir', async (e, parentPath, name) => {
  try {
    fs.mkdirSync(path.join(parentPath, name));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-file', async (e, filePath) => {
  const err = await shell.openPath(filePath);
  return err ? { ok: false, error: err } : { ok: true };
});

ipcMain.handle('show-error', async (e, msg) => {
  dialog.showErrorBox('Error', msg);
});

// Helpers
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function deleteRecursive(p) {
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(p)) deleteRecursive(path.join(p, child));
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}
