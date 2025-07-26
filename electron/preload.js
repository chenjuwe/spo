// 使用嚴格模式以避免常見錯誤
'use strict';

// 嘗試以更安全的方式加載模塊
let os, path, fs;
try {
  os = require('os');
  path = require('path');
  fs = require('fs');
} catch (error) {
  console.error('預加載腳本無法加載必要模塊:', error);
  
  // 嘗試向主進程報告錯誤
  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('preload-error', { error: error.message });
  } catch (innerError) {
    console.error('無法向主進程報告錯誤:', innerError);
  }
}

// 在窗口載入之前執行的脚本
window.addEventListener('DOMContentLoaded', () => {
  // DOM 元素完全加載，可以修改頁面或設置事件監聽器
  console.log('DOMContentLoaded 事件觸發，預加載腳本執行中');
});

// 使用預加載腳本安全地暴露 Electron 和 Node.js API
// 使用上下文隔離設置 contextBridge
const { contextBridge, ipcRenderer } = require('electron');

// 檢查 contextBridge 是否存在並且可用
if (contextBridge && contextBridge.exposeInMainWorld) {
  try {
    console.log('正在設置 Electron API 橋接器...');
    
    // 暴露安全的 API 給渲染進程
    contextBridge.exposeInMainWorld('electronAPI', {
      // 系統相關 API
      getSystemInfo: () => {
        try {
          return {
            platform: os.platform(),
            arch: os.arch(),
            cpuCores: os.cpus().length,
            osVersion: os.release(),
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            homeDir: os.homedir()
          };
        } catch (err) {
          console.error('獲取系統信息時出錯:', err);
          return { error: err.message };
        }
      },
      
      // 檔案對話框和操作 API
      openFileDialog: async (options) => {
        try {
          return await ipcRenderer.invoke('open-file-dialog', options);
        } catch (error) {
          console.error('開啟檔案對話框錯誤:', error);
          throw error;
        }
      },
      
      saveFile: async (options) => {
        try {
          return await ipcRenderer.invoke('save-file', options);
        } catch (error) {
          console.error('保存檔案錯誤:', error);
          return { error: error.message, canceled: true };
        }
      },
      
      readFile: async (path) => {
        try {
          const result = await ipcRenderer.invoke('read-file', path);
          if (typeof result === 'object' && 'error' in result) {
            console.error('讀取文件錯誤:', result.error, result.message);
            return result;
          }
          return result;
        } catch (error) {
          console.error('讀取文件處理錯誤:', error);
          throw error;
        }
      },
      
      // 視窗控制 API
      setTitle: (title) => {
        try {
          ipcRenderer.send('set-title', title);
        } catch (error) {
          console.error('設置標題錯誤:', error);
        }
      },
      
      // 權限檢查 API
      checkPermissions: async (targetPath) => {
        try {
          return await ipcRenderer.invoke('check-permissions', targetPath);
        } catch (error) {
          console.error('檢查權限錯誤:', error);
          return { hasPermission: false, error: error.message };
        }
      },
      
      // 應用程式控制 API
      relaunchApp: () => {
        try {
          ipcRenderer.send('relaunch-app');
        } catch (error) {
          console.error('重啟應用程式錯誤:', error);
        }
      },

      // 照片庫權限 API
      checkPhotosPermission: async () => {
        try {
          return await ipcRenderer.invoke('check-photos-permission');
        } catch (error) {
          console.error('檢查照片庫權限錯誤:', error);
          return { status: 'error', error: error.message };
        }
      },
      
      requestPhotosPermission: async () => {
        try {
          return await ipcRenderer.invoke('request-photos-permission');
        } catch (error) {
          console.error('請求照片庫權限錯誤:', error);
          return { granted: false, error: error.message };
        }
      },
      
      openPhotosLibrary: async () => {
        try {
          return await ipcRenderer.invoke('open-photos-library');
        } catch (error) {
          console.error('打開照片應用錯誤:', error);
          return { success: false, error: error.message };
        }
      }
    });
    
    console.log('Electron API 橋接器設置完成');
  } catch (error) {
    console.error('設置 contextBridge 時出錯:', error);
  }
} else {
  console.error('contextBridge 不可用，無法設置 API 橋接器');
} 