import React, { Suspense, lazy, useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { PhotoProvider, usePhotos, useResults } from "@/context/PhotoContext";
import { SimilarityGroup, ProcessingOptions } from "@/lib/types";
import { checkBrowserCompatibility, showCompatibilityWarnings } from "@/lib/compatibilityChecker";
import { useKeyboardShortcuts, KeyboardShortcut } from "@/hooks/useKeyboardShortcuts";
import { setupGlobalErrorHandler } from "@/lib/errorHandlingService";
import { hashCache } from "@/lib/hashCacheService";

// 動態載入大型元件以減少初始載入時間
const PhotoGrid = lazy(() => import("./PhotoGrid"));
const SettingsPanel = lazy(() => import("./SettingsPanel"));
const ResultsView = lazy(() => import("./ResultsView"));
const KeyboardShortcutHelp = lazy(() => import("./KeyboardShortcutHelp"));
const DownloadProgress = lazy(() => import("./DownloadProgress"));
const PhotoUploader = lazy(() => import("./PhotoUploader"));
const PhotoProcessor = lazy(() => import("./PhotoProcessor"));
const Header = lazy(() => import("./Header"));

// 懶加載外殼組件
const LazyComponent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="p-4 text-center">載入中...</div>}>
    {children}
  </Suspense>
);

// 應用初始化組件
const AppInitializer: React.FC = () => {
  useEffect(() => {
    // 檢查瀏覽器相容性
    const compatibility = checkBrowserCompatibility();
    if (!compatibility.isCompatible) {
      showCompatibilityWarnings();
    }
    
    // 設置全局錯誤處理
    setupGlobalErrorHandler();
    
    // 預熱緩存
    hashCache.preloadCache().catch(e => 
      console.warn("緩存預熱失敗:", e)
    );
  }, []);
  
  return null;
};

// 主應用組件
const PhotoOrganizerApp: React.FC = () => {
  // 狀態
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [similarityThreshold, setSimilarityThreshold] = useState(90);
  const [similarityGroups, setSimilarityGroups] = useState<SimilarityGroup[]>([]);
  const [settings, setSettings] = useState<ProcessingOptions>({
    autoRename: true,
    preserveOriginal: true,
    optimizeQuality: false,
    maxDimension: 1920
  });

  // 獲取 Context 數據
  const { photos, clearPhotos } = usePhotos();
  const { showResults, setShowResults } = useResults();

  // 定義鍵盤快捷鍵
  const shortcuts = useMemo<Record<string, KeyboardShortcut>>(() => ({
    help: {
      key: "h",
      ctrlKey: true,
      action: () => setShowShortcuts(true),
      description: "顯示鍵盤快捷鍵說明"
    },
    settings: {
      key: "s",
      ctrlKey: true,
      action: () => setShowSettings(!showSettings),
      description: "開啟/關閉設定面板"
    },
    clear: {
      key: "Delete",
      ctrlKey: true,
      action: () => photos.length > 0 && clearPhotos(),
      description: "清除所有照片"
    },
    escape: {
      key: "Escape",
      action: () => {
        if (showSettings) setShowSettings(false);
        if (showShortcuts) setShowShortcuts(false);
      },
      description: "關閉當前彈出窗口"
    }
  }), [photos.length, clearPhotos, showSettings, setShowSettings, showShortcuts, setShowShortcuts]);

  // 啟用鍵盤快捷鍵
  useKeyboardShortcuts(shortcuts);

  // 處理完成處理
  const handleProcessingComplete = (processedGroups: SimilarityGroup[]) => {
    setSimilarityGroups(processedGroups);
    setShowResults(true);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* 頭部區域 */}
      <LazyComponent>
        <Header
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          setShowShortcuts={setShowShortcuts}
          settings={settings}
          similarityGroups={similarityGroups}
        />
      </LazyComponent>

      {/* 設定面板 */}
      {showSettings && (
        <LazyComponent>
          <SettingsPanel
            settings={settings}
            onSettingsChange={setSettings}
            similarityThreshold={similarityThreshold}
            onSimilarityChange={setSimilarityThreshold}
          />
        </LazyComponent>
      )}

      {/* 主區域 */}
      <Card className="p-6">
        {!showResults ? (
          <div className="space-y-6">
            {/* 上傳區域 */}
            <LazyComponent>
              <PhotoUploader />
            </LazyComponent>

            {/* 當有照片時顯示照片網格和處理選項 */}
            {photos.length > 0 && (
              <>
                <LazyComponent>
                  <PhotoGrid photos={photos} onPhotosChange={() => {}} />
                </LazyComponent>
                
                <LazyComponent>
                  <PhotoProcessor
                    threshold={similarityThreshold}
                    onComplete={handleProcessingComplete}
                  />
                </LazyComponent>
              </>
            )}
          </div>
        ) : (
          /* 結果顯示區域 */
          <LazyComponent>
            <ResultsView
              similarityGroups={similarityGroups}
              threshold={similarityThreshold}
            />
          </LazyComponent>
        )}
      </Card>

      {/* 鍵盤快捷鍵幫助 */}
      {showShortcuts && (
        <LazyComponent>
          <KeyboardShortcutHelp
            shortcuts={Object.values(shortcuts)}
            onClose={() => setShowShortcuts(false)}
          />
        </LazyComponent>
      )}
    </div>
  );
};

// 包裹主應用組件與 Provider
const PhotoOrganizerNew: React.FC = () => {
  return (
    <PhotoProvider>
      <AppInitializer />
      <PhotoOrganizerApp />
    </PhotoProvider>
  );
};

export default PhotoOrganizerNew; 