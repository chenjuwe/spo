import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

// 檢查是否支持 Service Worker
const isServiceWorkerSupported = 'serviceWorker' in navigator;

// 用於記錄應用程式離線狀態
let isAppOffline = false;

/**
 * 註冊 Service Worker 並處理更新
 */
export function registerServiceWorker() {
  if (!isServiceWorkerSupported) {
    console.warn('此瀏覽器不支援 Service Worker，部分功能可能受限');
    return;
  }

  // 監聽線上/離線狀態
  window.addEventListener('online', handleOnlineStatusChange);
  window.addEventListener('offline', handleOnlineStatusChange);
  
  // 初始檢查並顯示離線通知
  handleOnlineStatusChange();

  // 註冊 Service Worker 
  const updateSW = registerSW({
    onNeedRefresh() {
      toast.info('有可用更新', {
        description: '新版本已準備就緒',
        action: {
          label: '立即更新',
          onClick: () => {
            updateSW(true);
          },
        },
        duration: 10000,
      });
    },
    onOfflineReady() {
      toast.success('應用已準備好離線使用', {
        description: '已快取必要資源，您可以在離線狀態下使用本應用',
        duration: 5000,
      });
    },
    onRegisteredSW(swUrl, registration) {
      // Service Worker 註冊成功
      console.info(`Service Worker 已註冊: ${swUrl}`);
      
      if (registration) {
        // 每小時檢查一次更新
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('Service Worker 註冊失敗:', error);
    }
  });
}

/**
 * 處理線上/離線狀態變更
 */
function handleOnlineStatusChange() {
  const isOnline = navigator.onLine;
  
  if (!isOnline && !isAppOffline) {
    // 從在線變為離線
    isAppOffline = true;
    toast.warning('您已離線', {
      description: '將使用本地快取資料，部分功能可能受限',
      duration: 5000,
    });
  } else if (isOnline && isAppOffline) {
    // 從離線變為在線
    isAppOffline = false;
    toast.success('已重新連線', {
      description: '您的連線已恢復',
      duration: 5000,
    });
  }
}

/**
 * 檢查應用是否處於離線狀態
 */
export function isOffline(): boolean {
  return !navigator.onLine;
}

/**
 * 檢查是否支援完整的離線功能
 */
export function supportsOfflineMode(): boolean {
  return isServiceWorkerSupported && 'caches' in window;
}

/**
 * 主動預緩存指定資源
 */
export async function precacheResources(urls: string[]): Promise<void> {
  if (!supportsOfflineMode()) return;

  try {
    const cache = await caches.open('user-requested-cache');
    await cache.addAll(urls);
  } catch (error) {
    console.error('預緩存資源失敗:', error);
  }
} 