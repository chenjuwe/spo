import React from "react";
import { Settings, HelpCircle, Trash2, Download, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePhotos, useResults } from "@/context/PhotoContext";
import { ErrorType, errorHandler } from "@/lib/errorHandlingService";
import { downloadManager } from "@/lib/downloadManager";

interface HeaderProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  setShowShortcuts: (show: boolean) => void;
  settings: {
    autoRename: boolean;
    preserveOriginal: boolean;
    optimizeQuality: boolean;
    maxDimension: number;
  };
  similarityGroups: any[];
}

const Header: React.FC<HeaderProps> = ({
  showSettings,
  setShowSettings,
  setShowShortcuts,
  settings,
  similarityGroups
}) => {
  const { photos, clearPhotos } = usePhotos();
  const { showResults, setShowResults } = useResults();

  // 處理下載功能
  const handleDownload = async () => {
    try {
      await downloadManager.downloadOrganizedFiles(photos, similarityGroups, settings);
    } catch (error) {
      errorHandler.handleError(
        error as Error,
        ErrorType.PHOTO_SAVING_ERROR,
        '下載檔案時發生錯誤',
        true,
        () => handleDownload()
      );
    }
  };

  // 返回編輯模式
  const handleBackToEdit = () => {
    setShowResults(false);
  };

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">照片整理工具</h1>
          <Badge variant="outline" className="text-xs">
            v0.1.11
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowShortcuts(true)}
            title="鍵盤快捷鍵"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>

          <Button
            variant={showSettings ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setShowSettings(!showSettings)}
            title="設定"
          >
            <Settings className="h-5 w-5" />
          </Button>

          {photos.length > 0 && !showResults && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => clearPhotos()}
              title="清空照片"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}

          {showResults && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackToEdit}
                className="flex items-center gap-1"
                title="返回編輯"
              >
                <ArrowLeft className="h-4 w-4" /> 返回編輯
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleDownload}
                className="flex items-center gap-1"
                title="下載照片"
              >
                <Download className="h-4 w-4" /> 下載照片
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header; 