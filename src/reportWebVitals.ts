import { type Metric, getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

// 擴展 Navigator 類型
declare global {
  interface Navigator {
    connection?: {
      effectiveType?: string;
    };
  }
}

/**
 * 效能指標報告函數
 * @param onPerfEntry 可選的自訂處理函數
 */
export function reportWebVitals(onPerfEntry?: (metric: Metric) => void): void {
  // 只在生產環境或明確開啟指標收集時執行
  if (import.meta.env.PROD || (window as any).__COLLECT_METRICS__) {
    // 確保是在瀏覽器環境
    if (typeof window !== 'undefined') {
      // 使用 requestAnimationFrame 來延遲指標收集，不影響頁面初始載入性能
      requestAnimationFrame(() => {
        setTimeout(() => {
          getCLS(onPerfEntry || sendToAnalytics); // 累積佈局偏移
          getFID(onPerfEntry || sendToAnalytics); // 首次輸入延遲
          getFCP(onPerfEntry || sendToAnalytics); // 首次內容繪製
          getLCP(onPerfEntry || sendToAnalytics); // 最大內容繪製
          getTTFB(onPerfEntry || sendToAnalytics); // 首位元組時間
        }, 1000);
      });
      
      console.info('Performance metrics collection enabled');
    }
  }
}

/**
 * 將效能指標發送到分析服務
 * @param metric 效能指標
 */
function sendToAnalytics(metric: Metric): void {
  // 獲取當前頁面信息
  const page = window.location.pathname;
  const connection = navigator.connection?.effectiveType || 'unknown';
  
  // 構建指標數據
  const data = {
    // 應用相關數據
    page,
    connection,
    deviceType: getDeviceType(),
    
    // 指標數據
    name: metric.name,
    value: metric.value.toFixed(2),
    rating: metric.rating, // good, needs-improvement, poor
    id: metric.id,
    timestamp: new Date().toISOString(),
  };
  
  // 輸出到控制台
  console.debug(`[Performance Metrics] ${metric.name}: ${metric.value.toFixed(2)}ms (${metric.rating})`);
  
  // TODO: 實際應用中，將下面的程式碼替換為發送到您的分析服務
  if (import.meta.env.PROD) {
    // 這裡實現將數據發送到分析服務的邏輯
    // 例如 Google Analytics、自定義後端 API 等
    try {
      // 模擬發送數據
      // fetch('/api/performance-metrics', {
      //   method: 'POST',
      //   body: JSON.stringify(data),
      //   headers: { 'Content-Type': 'application/json' }
      // });
      
      // 存儲到本地 localStorage 以便後續分析
      const storedMetrics = JSON.parse(localStorage.getItem('performance_metrics') || '[]');
      storedMetrics.push(data);
      localStorage.setItem('performance_metrics', JSON.stringify(storedMetrics.slice(-20))); // 只保留最近 20 條
      
    } catch (error) {
      console.error('Failed to send performance metrics:', error);
    }
  }
}

/**
 * 獲取設備類型
 * @returns 設備類型
 */
function getDeviceType(): string {
  const userAgent = navigator.userAgent;
  
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
    return 'tablet';
  }
  
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(userAgent)) {
    return 'mobile';
  }
  
  return 'desktop';
} 