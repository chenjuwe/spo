import { useEffect, useState } from 'react';
import { setupGlobalErrorHandler, errorHandler, ErrorType, ErrorSeverity } from '@/lib/errorHandlingService';
import { getRecommendedWorkerCount } from '@/lib/compatibilityChecker';
import { preloadFeatureExtractor } from '@/lib/deepFeatureExtractor';
import { initializeOptimizations } from '@/lib';
import { featureManager } from '@/lib/featureManager';

// 設置工作者池大小
const MAX_WORKERS = getRecommendedWorkerCount();

// 應用初始化配置
interface AppInitConfig {
  locale: string;
  enableErrorReporting: boolean;
  enableDetailedLogs: boolean;
  memoryThresholds: {
    low: number;  // MB
    critical: number; // MB
  };
}

// 默認配置
const DEFAULT_CONFIG: AppInitConfig = {
  locale: 'zh-TW',
  enableErrorReporting: true,
  enableDetailedLogs: process.env.NODE_ENV === 'development',
  memoryThresholds: {
    low: 200,
    critical: 100
  }
};

const AppInitializer = () => {
  const [initialized, setInitialized] = useState(false);
  
  useEffect(() => {
    // 初始化應用
    initializeApp()
      .then(() => setInitialized(true))
      .catch(error => {
        console.error('初始化失敗:', error);
        // 使用新的錯誤處理機制
        errorHandler.handleError(
          error instanceof Error ? error : new Error(String(error)),
          ErrorType.SYSTEM_ERROR,
          '應用程序初始化失敗',
          true,
          () => {
            // 恢復操作 - 嘗試重新初始化
            initializeApp()
              .then(() => setInitialized(true))
              .catch(e => console.error('重新初始化失敗:', e));
          },
          ErrorSeverity.HIGH
        );
      });
      
    // 清理函數
    return () => {
      // 卸載時清理資源
      cleanupResources();
    };
  }, []);
  
  return null;
};

/**
 * 初始化應用程序
 * 執行所有必要的初始化和優化設定
 */
async function initializeApp(config: Partial<AppInitConfig> = {}) {
  // 合併配置
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // 設置全局錯誤處理
  setupGlobalErrorHandler();
  
  // 設置錯誤處理器配置
  configureErrorHandler(finalConfig);
  
  // 初始化記憶體優化
  initializeMemoryOptimizations(finalConfig.memoryThresholds);
  
  try {
    // 初始化特徵管理器
    await featureManager.initialize();
    
    // 預加載深度特徵提取器
    await preloadFeatureExtractor();
    
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
    throw new Error(`初始化優化失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 配置錯誤處理器
 */
function configureErrorHandler(config: AppInitConfig) {
  // 設置本地語言
  errorHandler.setLocale(config.locale);
  
  // 設置重試配置
  errorHandler.setRetryConfig({
    maxRetries: 3,
    initialDelay: 1000,
    backoffFactor: 1.5,
    retryableErrorTypes: [
      ErrorType.NETWORK_ERROR,
      ErrorType.PHOTO_PROCESSING_ERROR,
      ErrorType.PHOTO_EXTRACTION_ERROR
    ]
  });
  
  // 設置報告配置
  errorHandler.setReportConfig({
    reportErrors: config.enableErrorReporting,
    includeStack: config.enableDetailedLogs,
    includeUserInfo: false
  });
}

/**
 * 記憶體使用優化
 */
const initializeMemoryOptimizations = (thresholds = DEFAULT_CONFIG.memoryThresholds) => {
  // 檢查 featureManager 是否有設置記憶體閾值的方法
  // 這裡使用可選鏈，這樣即使方法不存在也不會報錯
  if (typeof featureManager.setCacheConfig === 'function') {
    // 透過設置緩存配置間接設置記憶體閾值
    featureManager.setCacheConfig({
      maxEntries: 1000,
      expirationTime: 24 * 60 * 60 * 1000, // 24小時
      cleanupInterval: 10 * 60 * 1000 // 10分鐘
    });
  }
  
  // 定期檢查並清理未使用的資源
  const intervalId = setInterval(() => {
    // 觸發垃圾回收（僅在支持的瀏覽器上有效）
    if (window.gc) {
      try {
        window.gc();
      } catch (e) {
        // 忽略錯誤
      }
    }
  }, 60000); // 每分鐘檢查一次
  
  // 存儲計時器 ID，以便於清理
  (window as any).__memoryCleanupInterval = intervalId;
};

/**
 * 清理應用資源
 */
function cleanupResources() {
  // 清理記憶體檢查計時器
  if ((window as any).__memoryCleanupInterval) {
    clearInterval((window as any).__memoryCleanupInterval);
  }
  
  // 釋放特徵管理器資源
  featureManager.dispose?.().catch(e => 
    console.error('特徵管理器釋放資源失敗:', e)
  );
}

export default AppInitializer; 