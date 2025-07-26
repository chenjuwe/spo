import { Suspense, lazy, useState, useEffect, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Image, Settings, HelpCircle, KeyboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { downloadManager } from "@/lib/downloadManager";
import { PhotoFile, SimilarityGroup, ProcessingOptions } from "@/lib/types";
import PhotoUploader from "./PhotoUploader";
import { PhotoProcessor } from "./PhotoProcessor";
import { checkBrowserCompatibility, showCompatibilityWarnings } from "@/lib/compatibilityChecker";
import { useKeyboardShortcuts, KeyboardShortcut } from "@/hooks/useKeyboardShortcuts";

// 擴展 Performance 介面添加 Chrome 特有的 memory 屬性
declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
    };
  }
}

// 動態載入大型元件
const PhotoGrid = lazy(() => import("./PhotoGrid"));
const SettingsPanel = lazy(() => import("./SettingsPanel"));
const ResultsView = lazy(() => import("./ResultsView"));
const KeyboardShortcutHelp = lazy(() => import("./KeyboardShortcutHelp"));

// 下載進度組件
const DownloadProgress = lazy(() => import("./DownloadProgress"));

const PhotoOrganizer = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [similarityThreshold, setSimilarityThreshold] = useState(90);
  const [similarityGroups, setSimilarityGroups] = useState<SimilarityGroup[]>([]);
  const [settings, setSettings] = useState<ProcessingOptions>({
    autoRename: true,
    preserveOriginal: true,
    optimizeQuality: false,
    maxDimension: 1920
  });

  // 定義需要在 useMemo 中使用的函數
  const clearPhotos = useCallback(() => {
    photos.forEach(photo => {
      try {
        URL.revokeObjectURL(photo.preview);
      } catch (error) {
        console.warn('釋放資源失敗:', error);
      }
    });
    setPhotos([]);
    setSimilarityGroups([]);
    setShowResults(false);
    toast.success("已清除所有照片");
  }, [photos]);

  const handleDownload = useCallback(async () => {
    try {
      await downloadManager.downloadOrganizedFiles(photos, similarityGroups, settings);
    } catch (error) {
      console.error("下載檔案時發生錯誤:", error);
    }
  }, [photos, similarityGroups, settings]);

  // 使用 useMemo 避免每次渲染都重新創建 shortcuts 對象
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
        // 處理各種彈出窗口的關閉
        if (showSettings) setShowSettings(false);
        if (showShortcuts) setShowShortcuts(false);
      },
      description: "關閉當前彈出窗口"
    },
    upload: {
      key: "o",
      ctrlKey: true,
      action: () => document.querySelector<HTMLElement>('input[type="file"]')?.click(),
      description: "開啟檔案選擇器"
    },
    download: {
      key: "d",
      ctrlKey: true,
      action: () => {
        if (showResults && similarityGroups.length > 0) {
          handleDownload();
        }
      },
      description: "下載處理結果"
    },
    cancel: {
      key: "c",
      ctrlKey: true,
      action: () => downloadManager.cancelDownload(),
      description: "取消下載"
    }
  }), [photos.length, showSettings, showShortcuts, showResults, similarityGroups.length, clearPhotos, handleDownload]);

  // 快捷鍵分類設置
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
        upload: shortcuts.upload,
        clear: shortcuts.clear
      }
    },
    download: {
      title: "下載操作",
      shortcuts: {
        download: shortcuts.download,
        cancel: shortcuts.cancel
      }
    }
  }), [shortcuts]);

  // 使用鍵盤快捷鍵
  useKeyboardShortcuts(shortcuts);

  // 初始化時檢查瀏覽器相容性
  useEffect(() => {
    const compatibility = checkBrowserCompatibility();
    if (!compatibility.isCompatible || compatibility.warnings.length > 0) {
      showCompatibilityWarnings();
    }
  }, []);

  const handlePhotosAdded = (newPhotos: PhotoFile[]) => {
    setPhotos(prev => [...prev, ...newPhotos]);
  };

  const handleProcessingComplete = (processedPhotos: PhotoFile[], groups: SimilarityGroup[]) => {
    setPhotos(processedPhotos);
    setSimilarityGroups(groups);
    setShowResults(true);
  };

  const handleBackToEdit = () => {
    setShowResults(false);
  };

  // 元件卸載時釋放所有 preview URL
  useEffect(() => {
    return () => {
      photos.forEach(photo => {
        if (photo.preview && !photo.preview.startsWith('data:')) {
          try {
            URL.revokeObjectURL(photo.preview);
          } catch (error) {
            console.warn('釋放資源失敗:', error);
          }
        }
      });
    };
  }, [photos]);
  
  // 監控記憶體使用，並在需要時釋放資源
  useEffect(() => {
    if (photos.length > 30) { // 當照片數量較多時啟用記憶體監控
      // 定期檢查並釋放未顯示照片的預覽
      const intervalId = setInterval(() => {
        // 只在非處理過程中執行
        if (!showResults) {
          console.info('執行記憶體優化...');
          
          // 幫助觸發垃圾回收
          const largeArray = new Array(1000).fill(0);
          largeArray.length = 0;
          
          // 使用類型斷言來處理 Chrome 特有的 memory API
          const performance = window.performance as Performance & { 
            memory?: { 
              usedJSHeapSize: number; 
              jsHeapSizeLimit: number; 
            }
          };
          
          if (performance && performance.memory) {
            const memUsage = performance.memory;
            console.info(`記憶體使用情況: ${Math.round(memUsage.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(memUsage.jsHeapSizeLimit / 1024 / 1024)}MB`);
            
            // 如果記憶體使用超過閾值，釋放更多資源
            if (memUsage.usedJSHeapSize > memUsage.jsHeapSizeLimit * 0.7) {
              console.warn('記憶體使用較高，執行額外清理...');
              // 在極端情況下清理緩存
              import('@/lib/hashCacheService').then(({ hashCache }) => {
                hashCache.pruneOldEntries(3 * 24 * 60 * 60 * 1000); // 清理三天前的緩存
              }).catch(e => console.error('清理緩存失敗:', e));
            }
          }
        }
      }, 30000); // 每30秒檢查一次
      
      return () => clearInterval(intervalId);
    }
    
    return undefined;
  }, [photos.length, showResults]);

  // 如果顯示結果頁面
  if (showResults) {
    return (
      <div className="min-h-screen bg-gradient-subtle p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Smart Photo Organizer
            </h1>
            <p className="text-muted-foreground text-lg">
              照片整理結果
            </p>
          </div>
          <Suspense fallback={<div>載入中...</div>}>
            <ResultsView 
              photos={photos}
              groups={similarityGroups}
              onDownload={handleDownload}
              onBack={handleBackToEdit}
            />
          </Suspense>
          
          {/* 下載進度顯示 */}
          <Suspense fallback={null}>
            <DownloadProgress />
          </Suspense>
          
          {/* 鍵盤快捷鍵幫助 */}
          <div className="fixed bottom-4 right-4 z-50">
            <Suspense fallback={null}>
              <KeyboardShortcutHelp shortcuts={shortcutCategories} />
            </Suspense>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-subtle p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Smart Photo Organizer
          </h1>
          <p className="text-muted-foreground text-lg">
            智能照片整理工具 - 自動找出重複照片並挑選最佳版本
          </p>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="px-3 py-1">
              <Image className="w-4 h-4 mr-1" />
              {photos.length} 張照片
            </Badge>
            <Badge variant="outline" className="px-3 py-1">
              相似度門檻: {similarityThreshold}%
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Suspense fallback={null}>
              <KeyboardShortcutHelp shortcuts={shortcutCategories} />
            </Suspense>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings className="w-4 h-4 mr-2" />
              設定
            </Button>
            
            {photos.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearPhotos}
              >
                清除全部
              </Button>
            )}
          </div>
        </div>

        {/* Settings Panel */}
        <Suspense fallback={null}>
          {showSettings && (
            <SettingsPanel
              similarityThreshold={similarityThreshold}
              onSimilarityThresholdChange={setSimilarityThreshold}
              onClose={() => setShowSettings(false)}
              settings={settings}
              onSettingsChange={setSettings}
            />
          )}
        </Suspense>

        {/* Drop Zone */}
        {photos.length === 0 && (
          <PhotoUploader onPhotosAdded={handlePhotosAdded} />
        )}

        {/* Photo Grid */}
        <Suspense fallback={null}>
          {photos.length > 0 && (
            <>
              <PhotoGrid photos={photos} onPhotosChange={setPhotos} />
              
              {/* Action Bar */}
              <PhotoProcessor 
                photos={photos}
                similarityThreshold={similarityThreshold}
                onProcessingComplete={handleProcessingComplete}
              />
            </>
          )}
        </Suspense>
        
        {/* Accessibility Badge */}
        <div className="text-center text-xs text-muted-foreground mt-10">
          <p>
            按 <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+H</kbd> 查看所有鍵盤快捷鍵
          </p>
        </div>
      </div>
    </div>
  );
};

export default PhotoOrganizer;