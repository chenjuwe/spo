const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 完全禁用沙盒模式 - 在應用初始化最早階段
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-gpu-process-sandbox');

// 完全關閉 Chromium 安全功能 (僅用於測試，生產環境應謹慎使用)
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-web-security');

// 顯示命令行提示
console.log('========================================================');
console.log('如果應用程式無法正確訪問檔案，請嘗試從終端機以以下命令啟動:');
console.log('  open -a "Smart Photo Organizer"');
console.log('========================================================');

const isDev = process.env.NODE_ENV === 'development';

// 全局保存主窗口引用，避免 JavaScript 的垃圾回收機制回收
let mainWindow;

// 獲取預載腳本的絕對路徑
function getPreloadPath() {
  // 嘗試不同可能的預載腳本路徑
  const possiblePaths = [
    // 開發環境路徑
    path.join(__dirname, 'preload.js'),
    
    // 生產環境可能的路徑
    path.join(app.getAppPath(), 'electron', 'preload.js'),
    path.join(process.resourcesPath, 'electron', 'preload.js'),
    path.join(process.resourcesPath, 'app', 'electron', 'preload.js'),
    
    // 針對 Electron-forge 的路徑
    path.join(app.getAppPath(), 'preload.js'),
    path.join(process.resourcesPath, 'app.asar', 'electron', 'preload.js'),
    path.join(process.resourcesPath, 'preload.js'),
    
    // 如果預載腳本被複製到應用程式包中
    path.join(__dirname, '..', 'preload.js'),
    path.join(__dirname, '..', 'electron', 'preload.js'),
  ];
  
  // 打印測試信息
  console.log('應用路徑:', app.getAppPath());
  console.log('資源路徑:', process.resourcesPath);
  console.log('當前目錄:', __dirname);
  
  // 查找存在的預載腳本路徑
  for (const potentialPath of possiblePaths) {
    try {
      if (fs.existsSync(potentialPath)) {
        console.log('找到預載腳本:', potentialPath);
        return potentialPath;
      }
    } catch (err) {
      console.log(`檢查路徑錯誤 ${potentialPath}:`, err.message);
    }
  }
  
  console.error('無法找到預載腳本! 將嘗試使用內嵌版本');
  
  // 如果找不到預載腳本文件，直接創建一個內嵌的最小版本
  const embeddedPreloadPath = path.join(app.getPath('temp'), 'embedded-preload.js');
  const minimalPreload = `
    const { contextBridge, ipcRenderer } = require('electron');
    
    // 基本的 API 映射
    contextBridge.exposeInMainWorld('electronAPI', {
      openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
      readFile: (path) => ipcRenderer.invoke('read-file', path),
      saveFile: (options) => ipcRenderer.invoke('save-file', options),
      setTitle: (title) => ipcRenderer.send('set-title', title),
      getSystemInfo: () => ({
        platform: process.platform,
        arch: process.arch,
        version: process.getSystemVersion()
      }),
      checkPermissions: () => Promise.resolve({ hasAccess: true }),
      relaunchApp: () => ipcRenderer.send('relaunch-app')
    });
    
    console.log('使用內嵌的最小預載腳本');
  `;
  
  try {
    fs.writeFileSync(embeddedPreloadPath, minimalPreload);
    console.log('已創建內嵌預載腳本:', embeddedPreloadPath);
    return embeddedPreloadPath;
  } catch (err) {
    console.error('創建內嵌預載腳本失敗:', err);
    return null;
  }
}

function createWindow() {
  // 獲取預載腳本路徑
  const preloadPath = getPreloadPath();
  console.log('最終預載腳本路徑:', preloadPath);
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,  // 允許Node.js整合
      contextIsolation: true, // 保持上下文隔離但允許特定API
      webSecurity: false,     // 關閉網頁安全限制
      allowRunningInsecureContent: true, // 允許運行不安全內容
      sandbox: false,         // 完全關閉沙盒
      preload: preloadPath
    }
  });

  // 顯示啟動提示
  dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: '檔案存取提示',
    message: '應用程式需要存取您的照片和檔案',
    detail: '如果您遇到權限問題，請:\n\n1. 前往系統偏好設定 > 安全性與隱私權 > 檔案和資料夾\n2. 找到並啟用對本應用程式的檔案存取權限\n3. 如仍有問題，請嘗試從終端機輸入: open -a "Smart Photo Organizer"\n\n點擊「好的」繼續。',
    buttons: ['好的'],
    defaultId: 0
  });

  // 根據環境加載不同的資源
  if (isDev) {
    // 開發環境下，加載 Vite 開發伺服器
    mainWindow.loadURL('http://localhost:8080');
    // 打開開發者工具
    mainWindow.webContents.openDevTools();
  } else {
    // 生產環境下，加載打包後的 index.html
    try {
      // 嘗試多種可能的 index.html 路徑
      const possiblePaths = [
        path.join(__dirname, '..', 'dist', 'index.html'),
        path.join(app.getAppPath(), 'dist', 'index.html'),
        path.join(process.resourcesPath, 'dist', 'index.html'),
        path.join(process.resourcesPath, 'app', 'dist', 'index.html'),
        path.join(app.getAppPath(), 'index.html'),
        path.join(__dirname, '..', 'index.html')
      ];
      
      let indexPath = '';
      for (const testPath of possiblePaths) {
        console.log('測試路徑:', testPath);
        if (fs.existsSync(testPath)) {
          indexPath = testPath;
          console.log('找到 index.html:', indexPath);
          break;
        }
      }
      
      if (indexPath) {
        mainWindow.loadFile(indexPath);
      } else {
        // 如果找不到 index.html，顯示錯誤頁面
        console.error('無法找到 index.html 檔案!');
        mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
          <html>
            <body>
              <h1>無法載入應用程式</h1>
              <p>找不到 index.html 檔案。</p>
              <p>請嘗試重新安裝應用程式或從開發環境中運行。</p>
            </body>
          </html>
        `));
      }
    } catch (err) {
      console.error('載入應用程式時出錯:', err);
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html>
          <body>
            <h1>載入應用程式時發生錯誤</h1>
            <p>${err.message}</p>
          </body>
        </html>
      `));
    }
    
    // 在生產環境中也開啟開發者工具以便於查看錯誤
    mainWindow.webContents.openDevTools();
  }

  // 監聽網頁載入錯誤
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('載入失敗:', errorCode, errorDescription);
    
    // 嘗試載入錯誤頁面
    const errorHtml = `
    <html>
      <head>
        <title>載入錯誤</title>
        <style>
          body {
            font-family: sans-serif;
            padding: 20px;
            text-align: center;
          }
          .error-container {
            margin-top: 50px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h2>載入應用程式失敗</h2>
          <p>錯誤代碼: ${errorCode}</p>
          <p>錯誤描述: ${errorDescription}</p>
          <p>請檢查主控台以獲取更多資訊</p>
          <button onclick="window.location.reload()">重新嘗試</button>
        </div>
      </body>
    </html>
    `;
    
    mainWindow.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
  });

  // 監聽網頁載入完成
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('網頁載入完成');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 當 Electron 完成初始化時創建窗口
app.whenReady().then(() => {
  try {
    // 禁用沙盒模式 (增加對檔案系統的訪問權限)
    app.enableSandbox(false);
  } catch (err) {
    console.warn('無法設置 enableSandbox(false):', err.message);
  }

  try {
    // 在 macOS 上要求完全檔案存取權限
    if (process.platform === 'darwin') {
      app.getPath('home'); // 觸發對家目錄的存取
      app.getPath('desktop');
      app.getPath('documents');
      app.getPath('downloads');
      app.getPath('pictures');
      
      // 明確嘗試訪問照片庫，這會觸發系統權限對話框
      try {
        const { systemPreferences } = require('electron');
        if (systemPreferences.askForMediaAccess) {
          console.log('請求照片庫存取權限...');
          systemPreferences.askForMediaAccess('camera')
            .then((granted) => {
              console.log('相機存取權限:', granted ? '已授權' : '已拒絕');
            })
            .catch(err => {
              console.error('請求相機權限出錯:', err);
            });
            
          // 嘗試請求照片庫存取權限 (如果支持)
          if (systemPreferences.getMediaAccessStatus) {
            const photoStatus = systemPreferences.getMediaAccessStatus('photos');
            console.log('照片庫存取狀態:', photoStatus);
          }
        }
      } catch (err) {
        console.error('請求媒體權限時出錯:', err);
      }
    }
  } catch (err) {
    console.warn('無法獲取系統路徑:', err);
  }
  
  // 請求檔案系統權限 (macOS)
  requestMacOSPermissions();
  
  // 檢查並創建書籤
  createBookmarksIfNeeded();

  // 然後創建窗口
  createWindow();

  // 在 macOS 上，點擊 dock 圖標時重新創建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 當所有窗口都被關閉時退出應用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 針對 macOS 的權限請求處理函數
function requestMacOSPermissions() {
  if (process.platform !== 'darwin') return;
  
  try {
    console.log('正在初始化權限檢查...');
    
    // 定義需要存取的目錄和對應的說明
    const pathsToCheck = [
      { path: app.getPath('downloads'), name: '下載', key: 'NSDownloadsFolderUsageDescription' },
      { path: app.getPath('pictures'), name: '圖片', key: 'NSPicturesFolderUsageDescription' },
      { path: app.getPath('desktop'), name: '桌面', key: 'NSDesktopFolderUsageDescription' },
      { path: app.getPath('documents'), name: '文件', key: 'NSDocumentsFolderUsageDescription' },
      { path: app.getPath('home'), name: '主目錄', key: null }
    ];
    
    // 檢查各路徑權限
    let permissionErrors = [];
    
    // 檢查常用路徑的讀取權限
    const checkPathPermission = (pathInfo) => {
      const { path: pathToCheck, name: pathName } = pathInfo;
      console.log(`檢查${pathName}路徑權限:`, pathToCheck);
      
      if (!fs.existsSync(pathToCheck)) {
        console.log(`${pathName}路徑不存在:`, pathToCheck);
        return;
      }
      
      try {
        // 嘗試讀取目錄
        fs.readdirSync(pathToCheck, { withFileTypes: true });
        console.log(`已獲得${pathName}讀取權限`);
        return true;
      } catch (err) {
        console.warn(`${pathName}讀取權限檢查失敗:`, err.message);
        permissionErrors.push({ path: pathToCheck, name: pathName, error: err });
        return false;
      }
    };
    
    // 檢查每個路徑
    pathsToCheck.forEach(checkPathPermission);
    
    // 如果有任何權限錯誤，顯示提示訊息
    if (permissionErrors.length > 0) {
      console.warn(`有 ${permissionErrors.length} 個路徑需要權限`);
      
      // 等待應用程式完全啟動後再顯示提示
      setTimeout(() => {
        if (mainWindow) {
          const buttonIndex = dialog.showMessageBoxSync(mainWindow, {
            type: 'info',
            title: '需要檔案存取權限',
            message: '請授予必要的檔案存取權限',
            detail: `應用程式需要存取您的照片和檔案。您可能需要到系統設定 > 隱私權與安全性 > 檔案和資料夾，授予「Smart Photo Organizer」應用程式適當的權限。\n\n未授權的資料夾: ${permissionErrors.map(e => e.name).join(', ')}`,
            buttons: ['開啟系統設定', '稍後再說'],
            defaultId: 0
          });
          
          if (buttonIndex === 0) {
            // 開啟系統隱私設定
            if (process.platform === 'darwin') {
              require('child_process').exec('open x-apple.systempreferences:com.apple.preference.security?Privacy');
            }
          }
        }
      }, 1000);
    }
  } catch (err) {
    console.error('權限檢查過程中發生錯誤:', err);
  }
}

// 創建文件訪問書籤 (macOS)
async function createBookmarksIfNeeded() {
  if (process.platform !== 'darwin') return;

  try {
    // 獲取常用目錄
    const userDirectories = [
      { path: app.getPath('downloads'), name: '下載' },
      { path: app.getPath('pictures'), name: '圖片' },
      { path: app.getPath('desktop'), name: '桌面' },
      { path: app.getPath('documents'), name: '文件' },
      { path: app.getPath('home'), name: '主目錄' }
    ];

    // 創建書籤來記住這些目錄的訪問權限
    for (const dir of userDirectories) {
      try {
        console.log(`嘗試創建 ${dir.name} 目錄的書籤:`, dir.path);
        
        // 檢查目錄是否存在
        if (!fs.existsSync(dir.path)) {
          console.log(`${dir.name} 目錄不存在，跳過:`, dir.path);
          continue;
        }
        
        // 使用原生對話框讓用戶選擇目錄，這會觸發系統權限請求
        const result = await dialog.showOpenDialog({
          title: `選擇您的${dir.name}資料夾`,
          defaultPath: dir.path,
          buttonLabel: '授予存取權限',
          properties: ['openDirectory', 'createDirectory'],
          message: `請選擇您的${dir.name}資料夾，以授予應用程式存取權限`
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
          console.log(`用戶選擇了 ${dir.name} 目錄:`, result.filePaths[0]);
          
          // 可以在這裡存儲書籤，但實際上系統已經授予了權限
          // app.getFileIcon(result.filePaths[0]); // 嘗試讀取目錄，以確保權限
          try {
            fs.readdirSync(result.filePaths[0]);
            console.log(`確認可以讀取 ${dir.name} 目錄`);
          } catch (err) {
            console.warn(`讀取 ${dir.name} 目錄失敗:`, err);
          }
        } else {
          console.log(`用戶取消了選擇 ${dir.name} 目錄`);
        }
      } catch (error) {
        console.error(`為 ${dir.name} 目錄創建書籤時出錯:`, error);
      }
    }
  } catch (error) {
    console.error('創建書籤時發生錯誤:', error);
  }
}

// 處理文件權限錯誤並顯示友好提示
function handleFilePermissionError(filePath, error) {
  console.error(`檔案權限錯誤: ${filePath}`, error);
  
  // 如果是權限錯誤，提示用戶
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '權限被拒絕',
      message: '無法存取檔案或資料夾',
      detail: `應用程式無法存取 "${path.basename(filePath)}"。請前往系統設定 > 隱私權與安全性 > 檔案和資料夾，確保已授予 "Smart Photo Organizer" 應用程式適當的權限。`,
      buttons: ['開啟系統設定', '好的'],
      defaultId: 0
    }).then(({ response }) => {
      // 如果用戶選擇打開系統設定
      if (response === 0) {
        // 嘗試打開系統隱私權設定
        if (process.platform === 'darwin') {
          require('child_process').exec('open x-apple.systempreferences:com.apple.preference.security?Privacy');
        }
      }
    });
    return true;
  }
  return false;
}

// 處理選擇本地照片
ipcMain.handle('open-file-dialog', async () => {
  try {
    console.log('正在開啟檔案選擇對話框');
    
    // 使用系統對話框選擇檔案 (不需要額外權限)
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] }],
      title: '選擇照片',
      message: '請選擇您想要整理的照片',
      buttonLabel: '選擇照片'
    });
    
    if (result.canceled) {
      console.log('用戶取消選擇');
      return [];
    }
    
    const filePaths = result.filePaths;
    console.log(`用戶選擇了 ${filePaths.length} 個檔案`);
    
    return filePaths;
  } catch (error) {
    console.error('開啟檔案對話框時發生錯誤:', error);
    dialog.showErrorBox('開啟檔案失敗', '無法開啟檔案選擇對話框，請確認應用程式具有必要的權限。');
    return [];
  }
});

// 添加照片庫處理功能
ipcMain.handle('check-photos-permission', async () => {
  if (process.platform !== 'darwin') {
    return { status: 'not-darwin' };
  }

  try {
    const { systemPreferences } = require('electron');
    if (systemPreferences.getMediaAccessStatus) {
      const status = systemPreferences.getMediaAccessStatus('photos');
      return { status };
    } else {
      return { status: 'not-supported' };
    }
  } catch (err) {
    console.error('檢查照片庫權限時出錯:', err);
    return { status: 'error', message: err.message };
  }
});

ipcMain.handle('request-photos-permission', async () => {
  if (process.platform !== 'darwin') {
    return { granted: true };
  }

  try {
    const { systemPreferences } = require('electron');
    if (systemPreferences.askForMediaAccess) {
      const granted = await systemPreferences.askForMediaAccess('photos');
      return { granted };
    } else {
      return { granted: false, reason: 'not-supported' };
    }
  } catch (err) {
    console.error('請求照片庫權限時出錯:', err);
    return { granted: false, error: err.message };
  }
});

// 添加打開系統照片庫的功能
ipcMain.handle('open-photos-library', async () => {
  try {
    if (process.platform === 'darwin') {
      // macOS 上打開照片應用
      require('child_process').exec('open -a Photos');
      return { success: true };
    } else {
      return { success: false, reason: 'not-supported' };
    }
  } catch (err) {
    console.error('打開照片應用時出錯:', err);
    return { success: false, error: err.message };
  }
});

// 修改檔案讀取邏輯，嘗試檢測是否為照片庫中的檔案
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { error: 'FILE_NOT_EXIST', message: '檔案不存在' };
    }
    
    // 檢測是否為照片庫中的檔案
    const isPhotoLibraryPath = filePath.includes('Pictures') && 
                             (filePath.includes('Photos Library') || 
                              filePath.includes('PhotosLibrary'));
                              
    if (isPhotoLibraryPath) {
      console.log('嘗試讀取照片庫中的檔案:', filePath);
      // 提示用戶這是照片庫中的檔案，需要特殊權限
      if (mainWindow) {
        const buttonIndex = dialog.showMessageBoxSync(mainWindow, {
          type: 'info',
          title: '需要照片庫存取權限',
          message: '您嘗試開啟的是照片庫中的檔案',
          detail: '「Smart Photo Organizer」需要獲得照片庫存取權限。請前往「系統偏好設定」>「安全性與隱私權」>「照片」，確保已允許「Smart Photo Organizer」存取您的照片。',
          buttons: ['開啟系統設定', '取消'],
          defaultId: 0
        });
        if (buttonIndex === 0) {
          if (process.platform === 'darwin') {
            require('child_process').exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Photos"');
          }
        }
      }
    }
    
    try {
      const data = fs.readFileSync(filePath);
      return data.toString('base64');
    } catch (err) {
      console.error('檔案讀取失敗:', filePath, err);
      
      // 如果是照片庫路徑，給出更明確的錯誤提示
      if (isPhotoLibraryPath) {
        return {
          error: 'PHOTOS_LIBRARY_PERMISSION',
          message: '無法讀取照片庫中的檔案。請確保已在系統偏好設定中允許應用程式存取照片庫。'
        };
      }
      
      const result = await dialog.showOpenDialog({
        title: '無法存取檔案',
        message: '應用程式無法存取此檔案，請再次選擇檔案以授予權限',
        defaultPath: filePath,
        properties: ['openFile'],
        buttonLabel: '授予存取權限'
      });
      if (!result.canceled && result.filePaths.length > 0) {
        try {
          const confirmedData = fs.readFileSync(result.filePaths[0]);
          return confirmedData.toString('base64');
        } catch (secondError) {
          console.error('再次讀取失敗:', secondError);
          return {
            error: 'PERSISTENT_PERMISSION_ERROR',
            message: '即使重新選擇檔案，仍然無法讀取。請重新啟動應用程式或檢查系統權限設定。'
          };
        }
      } else {
        return { error: 'USER_CANCELED', message: '用戶取消了檔案讀取' };
      }
    }
  } catch (error) {
    console.error('讀取文件時出錯:', error);
    return {
      error: error.code || 'UNKNOWN_ERROR',
      message: error.message || '未知錯誤'
    };
  }
});

// 處理照片保存
ipcMain.handle('save-file', async (event, { buffer, suggestedName }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: [
        { name: 'Images', extensions: ['jpg', 'png'] }
      ]
    });
    
    if (canceled) {
      return { success: false };
    }
    
    try {
      // 轉換 base64 為 Buffer
      const data = Buffer.from(buffer, 'base64');
      await fs.promises.writeFile(filePath, data);
      return { success: true, path: filePath };
    } catch (error) {
      console.error('儲存檔案失敗:', error);
      
      // 處理可能的權限錯誤
      if (handleFilePermissionError(filePath, error)) {
        return { success: false, error: 'PERMISSION_ERROR', message: '權限被拒絕，無法儲存檔案' };
      }
      
      return { success: false, error: error.code || 'UNKNOWN_ERROR', message: error.message };
    }
  } catch (error) {
    console.error('顯示儲存對話框失敗:', error);
    return { success: false, error: 'DIALOG_ERROR', message: '無法開啟儲存對話框' };
  }
}); 

// 添加 'check-permissions' 處理程序
// 檢查檔案或資料夾的存取權限
ipcMain.handle('check-permissions', async (event, folderPath) => {
  try {
    if (!folderPath) {
      return { hasAccess: false, error: '未提供路徑' };
    }

    // 檢查路徑是否存在
    if (!fs.existsSync(folderPath)) {
      return { 
        hasAccess: false, 
        error: 'PATH_NOT_EXIST',
        message: '路徑不存在'
      };
    }

    // 檢查讀取權限
    try {
      fs.accessSync(folderPath, fs.constants.R_OK);
    } catch (err) {
      return { 
        hasAccess: false, 
        error: 'READ_PERMISSION_DENIED',
        message: '無讀取權限',
        details: err.message
      };
    }

    // 如果要檢查寫入權限
    try {
      fs.accessSync(folderPath, fs.constants.W_OK);
      return { hasAccess: true, canWrite: true };
    } catch (err) {
      // 只有讀取權限，沒有寫入權限
      return { 
        hasAccess: true, 
        canWrite: false,
        error: 'WRITE_PERMISSION_DENIED',
        message: '無寫入權限' 
      };
    }
  } catch (error) {
    console.error('檢查權限時發生錯誤:', error);
    return { 
      hasAccess: false, 
      error: 'PERMISSION_CHECK_ERROR',
      message: error.message 
    };
  }
});

// 監聽預載腳本錯誤
ipcMain.on('preload-error', (event, errorData) => {
  console.error('預載腳本報告錯誤:', errorData.message);
  console.error(errorData.stack);
  
  // 顯示錯誤給用戶
  dialog.showErrorBox(
    '應用程式初始化錯誤',
    `初始化時發生錯誤：${errorData.message}\n\n請重新啟動應用程式或聯絡支援團隊。`
  );
});

// 監聽打開系統隱私設定的請求
ipcMain.on('set-title', (event, title) => {
  if (title === 'open-privacy-settings') {
    // 打開系統隱私權設定
    if (process.platform === 'darwin') {
      require('child_process').exec('open x-apple.systempreferences:com.apple.preference.security?Privacy');
    }
  } else {
    // 設定窗口標題
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) window.setTitle(title);
  }
}); 

// 重啟應用程式
ipcMain.on('relaunch-app', () => {
  console.log('收到重啟應用程式請求');
  app.relaunch();
  app.exit(0);
}); 