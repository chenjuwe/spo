import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Route, Routes, BrowserRouter } from 'react-router-dom';
import { setupGlobalErrorHandler } from '@/lib/errorHandlingService';
import { PhotoProvider } from '@/context/PhotoContext';
import { getRecommendedWorkerCount } from '@/lib/compatibilityChecker';

// 擴展 Window 介面添加可選的 gc 方法
declare global {
  interface Window {
    gc?: () => void;
  }
}

// 設置工作者池大小和記憶體優化
const MAX_WORKERS = getRecommendedWorkerCount();
console.info(`系統設置：使用 ${MAX_WORKERS} 個工作者線程`);

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

// 懶加載頁面
const Index = lazy(() => import('@/pages/Index'));
const NotFound = lazy(() => import('@/pages/NotFound'));
// 使用新的優化後的 PhotoOrganizer
const PhotoOrganizerNew = lazy(() => import('@/components/PhotoOrganizerNew'));

// 創建查詢客戶端
const queryClient = new QueryClient();

// 應用程序初始化組件
const AppInitializer = () => {
  useEffect(() => {
    // 設置全局錯誤處理
    setupGlobalErrorHandler();
    
    // 初始化記憶體優化
    initializeMemoryOptimizations();
    
    console.info('應用程序初始化完成');
  }, []);
  
  return null;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PhotoProvider>
        <TooltipProvider>
          <Suspense fallback={<div className="p-8 text-center">載入應用程式...</div>}>
            <AppInitializer />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<PhotoOrganizerNew />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
            <Toaster />
          </Suspense>
        </TooltipProvider>
      </PhotoProvider>
    </QueryClientProvider>
  );
}

export default App;
