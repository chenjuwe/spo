import React from "react";
import { SimilarityGroup, ProcessingOptions } from "@/lib/types";
import SettingsButton from "./SettingsButton";
import ClassifierButton from "./ClassifierButton";
import KeyboardShortcutsButton from "./KeyboardShortcutsButton";
import DownloadButton from "./DownloadButton";
import { KeyboardShortcut } from "@/hooks/useKeyboardShortcuts";

interface AppHeaderProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  setShowShortcuts: (show: boolean) => void;
  setShowClassifier: React.Dispatch<React.SetStateAction<boolean>>;
  settings: ProcessingOptions;
  similarityGroups: SimilarityGroup[];
  photosCount: number;
  shortcuts?: Record<string, KeyboardShortcut>;
  photos?: any[]; // 可使用 PhotoFile[] 替代
}

/**
 * 應用頭部組件
 * 負責顯示應用標題、功能按鈕和操作選項
 */
const AppHeader: React.FC<AppHeaderProps> = ({
  showSettings,
  setShowSettings,
  setShowShortcuts,
  setShowClassifier,
  settings,
  similarityGroups,
  photosCount,
  shortcuts = {},
  photos = [],
}) => {
  const handleSettingsClick = () => {
    setShowSettings(!showSettings);
  };

  const handleClassifierClick = () => {
    setShowClassifier(prev => !prev);
  };

  const handleShortcutsClick = () => {
    setShowShortcuts(true);
  };

  return (
    <header className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
      {/* 應用標題 */}
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold">Smart Photo Organizer</h1>
        <p className="text-sm text-muted-foreground">
          智能照片整理工具 - 已載入 {photosCount} 張照片
        </p>
      </div>

      {/* 功能按鈕 */}
      <div className="flex items-center gap-2">
        <SettingsButton 
          isActive={showSettings} 
          onClick={handleSettingsClick} 
        />

        <ClassifierButton 
          onClick={handleClassifierClick} 
        />

        <KeyboardShortcutsButton 
          onClick={handleShortcutsClick} 
          shortcuts={shortcuts}
        />

        <DownloadButton 
          similarityGroups={similarityGroups} 
          settings={settings}
          photos={photos}
        />
      </div>
    </header>
  );
};

export default AppHeader; 