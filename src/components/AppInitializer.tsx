import { useEffect } from 'react';
import { setupGlobalErrorHandler } from '@/lib/errorHandlingService';
import { getRecommendedWorkerCount } from '@/lib/compatibilityChecker';
import { preloadFeatureExtractor } from '@/lib/deepFeatureExtractor';
import { initializeOptimizations } from '@/lib';

// 設置工作者池大小
const MAX_WORKERS = getRecommendedWorkerCount();

const AppInitializer = () => {
  useEffect(() => {
    // 初始化應用
    initializeApp();
  }, []);
  
  return null;
};

/**
 * 初始化應用程序
 * 執行所有必要的初始化和優化設定
 */
async function initializeApp() {
  try {
    // 設置全局錯誤處理
    setupGlobalErrorHandler();
    
    // 初始化記憶體優化
    initializeMemoryOptimizations();
    
    // 初始化所有優化功能
    await initializeOptimizations({
      enableWebGPU: true,
      enableDeepFeatures: true,
      enableEnhancedLSH: true,
      enableAdaptiveSampling: true,
      enableIntelligentBatch: true
    });
    
    console.info(`應用程序初始化完成，使用 ${MAX_WORKERS} 個工作者線程`);
  } catch (error) {
    console.error('應用程序初始化失敗:', error);
  }
}

// 記憶體使用優化
const initializeMemoryOptimizations = () => {
  // 定期檢查並清理未使用的資源
  setInterval(() => {
    // 觸發垃圾回收（僅在支持的瀏覽器上有效）
    if (window.gc) {
      try {
        window.gc();
      } catch (e) {
        // 忽略錯誤
      }
    }
  }, 60000); // 每分鐘檢查一次
};

export default AppInitializer; 