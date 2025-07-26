/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// 讀取文件錯誤結果的接口
interface FileErrorResult {
  error: string;
  message?: string;
}

// 權限檢查結果的接口
interface PermissionCheckResult {
  hasAccess: boolean;
  error?: string;
}

// 系統信息接口
interface SystemInfo {
  platform: string;
  arch: string;
  cpuCores: number;
  osVersion: string;
  totalMemory: number;
  freeMemory: number;
  homeDir?: string;
}

// 照片庫權限狀態接口
interface PhotosPermissionStatus {
  status: 'not-determined' | 'denied' | 'restricted' | 'authorized' | 'limited' | 'not-darwin' | 'not-supported' | 'error';
  message?: string;
}

// 照片庫權限請求結果接口
interface PhotosPermissionResult {
  granted: boolean;
  reason?: string;
  error?: string;
}

// 照片庫操作結果接口
interface PhotosOperationResult {
  success: boolean;
  reason?: string;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: (options?: any) => Promise<string[]>;
      readFile: (path: string) => Promise<string | FileErrorResult>;
      saveFile: (options: { buffer: string; suggestedName: string }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>;
      getSystemInfo: () => SystemInfo;
      setTitle: (title: string) => void;
      checkPermissions: (folderPath: string) => Promise<PermissionCheckResult>;
      relaunchApp: () => void;
      
      // 照片庫相關API
      checkPhotosPermission: () => Promise<PhotosPermissionStatus>;
      requestPhotosPermission: () => Promise<PhotosPermissionResult>;
      openPhotosLibrary: () => Promise<PhotosOperationResult>;
    };
  }
}

// 檢查是否在Electron環境中
export function isElectron(): boolean {
  return window.electronAPI !== undefined;
}

// 識別不同的平台
export enum Platform {
  Web = 'web',
  Electron = 'electron',
  Mobile = 'mobile',
}

// 取得當前平台
export function getPlatform(): Platform {
  if (isElectron()) {
    return Platform.Electron;
  }
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    return Platform.Mobile;
  }
  return Platform.Web;
}
