import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { 
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { showCompatibilityWarnings } from "@/lib/compatibilityChecker";
import { downloadManager } from "@/lib/downloadManager";
import { getRecommendedWorkerCount } from "@/lib/compatibilityChecker";

// 設置工作者池大小
const MAX_WORKERS = getRecommendedWorkerCount();
console.info(`系統設置：使用 ${MAX_WORKERS} 個工作者線程`);

const queryClient = new QueryClient();

// 將頁面元件改為動態載入
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));

// 應用啟動時檢查
const AppInitializer = () => {
  useEffect(() => {
    // 檢查瀏覽器相容性
    showCompatibilityWarnings();
  }, []);
  
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner richColors />
      <AppInitializer />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<div>載入中...</div>}>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
