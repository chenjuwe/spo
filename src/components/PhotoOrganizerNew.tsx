import React, { Suspense, lazy, useState, useMemo } from "react";
import { PhotoProvider, usePhotos, useResults } from "@/context/PhotoContext";
import { SimilarityGroup, ProcessingOptions } from "@/lib/types";
import { useKeyboardShortcuts, KeyboardShortcut } from "@/hooks/useKeyboardShortcuts";

// 動態載入元件
import AppInitializer from "./AppInitializer";
const MainContent = lazy(() => import("./MainContent"));
const SettingsPanel = lazy(() => import("./SettingsPanel"));
const KeyboardShortcutHelp = lazy(() => import("./KeyboardShortcutHelp"));
const AppHeader = lazy(() => import("./AppHeader"));

// 懶加載外殼組件
const LazyComponent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="p-4 text-center">載入中...</div>}>
    {children}
  </Suspense>
);

// 主應用組件
const PhotoOrganizerApp: React.FC = () => {
  // 狀態管理
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showClassifier, setShowClassifier] = useState(false);
  const [similarityThreshold, setSimilarityThreshold] = useState(90);
  const [similarityGroups, setSimilarityGroups] = useState<SimilarityGroup[]>([]);
  const [settings, setSettings] = useState<ProcessingOptions>({
    autoRename: true,
    preserveOriginal: true,
    optimizeQuality: false,
    maxDimension: 1920
  });

  // 獲取 Context 數據
  const { photos, setPhotos, clearPhotos } = usePhotos();
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
    classifier: {
      key: "t",
      ctrlKey: true,
      action: () => setShowClassifier(!showClassifier),
      description: "開啟/關閉分類和標籤面板"
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
        if (showClassifier) setShowClassifier(false);
      },
      description: "關閉當前彈出窗口"
    }
  }), [photos.length, clearPhotos, showSettings, setShowSettings, showShortcuts, setShowShortcuts, showClassifier, setShowClassifier]);

  // 啟用鍵盤快捷鍵
  useKeyboardShortcuts(shortcuts);

  // 處理完成處理
  const handleProcessingComplete = (groups: SimilarityGroup[]) => {
    setSimilarityGroups(groups);
    setShowResults(true);
  };

  // 創建鍵盤快捷鍵分類
  const shortcutCategories = useMemo(() => ({
    general: {
      title: "一般操作",
      shortcuts: {
        help: shortcuts.help,
        settings: shortcuts.settings,
        escape: shortcuts.escape
      }
    },
    photos: {
      title: "照片操作",
      shortcuts: {
        classifier: shortcuts.classifier,
        clear: shortcuts.clear
      }
    }
  }), [shortcuts]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* 頭部區域 */}
      <LazyComponent>
        <AppHeader
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          setShowShortcuts={setShowShortcuts}
          setShowClassifier={setShowClassifier}
          settings={settings}
          similarityGroups={similarityGroups}
          photosCount={photos.length}
          shortcuts={shortcuts}
          photos={photos}
        />
      </LazyComponent>

      {/* 設定面板 */}
      {showSettings && (
        <LazyComponent>
          <SettingsPanel
            settings={settings}
            onSettingsChange={setSettings}
            similarityThreshold={similarityThreshold}
            onSimilarityThresholdChange={setSimilarityThreshold}
            onClose={() => setShowSettings(false)}
          />
        </LazyComponent>
      )}
      
      {/* 主要內容區域 */}
      <LazyComponent>
        <MainContent
          showResults={showResults}
          photos={photos}
          setPhotos={setPhotos}
          similarityGroups={similarityGroups}
          similarityThreshold={similarityThreshold}
          setShowResults={setShowResults}
          onProcessingComplete={handleProcessingComplete}
        />
      </LazyComponent>

      {/* 鍵盤快捷鍵幫助 */}
      {showShortcuts && (
        <LazyComponent>
          <KeyboardShortcutHelp
            shortcuts={shortcutCategories}
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