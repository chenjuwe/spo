import React from "react";
import { Button } from "@/components/ui/button";
import {
  Settings,
  HelpCircle,
  Download,
  Tag
} from "lucide-react";
import { SimilarityGroup } from "@/lib/types";
import { toast } from "sonner";

interface HeaderProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  setShowShortcuts: (show: boolean) => void;
  setShowClassifier?: React.Dispatch<React.SetStateAction<boolean>>;
  settings: any;
  similarityGroups: SimilarityGroup[];
}

export const Header = ({
  showSettings,
  setShowSettings,
  setShowShortcuts,
  setShowClassifier,
  settings,
  similarityGroups,
}: HeaderProps) => {
  const handleDownload = () => {
    if (similarityGroups.length === 0) {
      toast.error("請先處理照片");
      return;
    }

    // 處理下載邏輯...
    toast.info("正在準備下載...");
  };

  return (
    <header className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
      <div className="flex items-center">
        <h1 className="text-2xl font-bold">智能照片整理器</h1>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-2">
          v0.1.11
        </span>
      </div>
      
      <div className="flex items-center gap-2">
        <Button
          variant={showSettings ? "default" : "outline"}
          size="sm"
          onClick={() => setShowSettings(!showSettings)}
          className="gap-1.5"
        >
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">設定</span>
        </Button>
        
        {setShowClassifier && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowClassifier(prev => !prev)}
            className="gap-1.5"
          >
            <Tag className="w-4 h-4" />
            <span className="hidden sm:inline">分類標籤</span>
          </Button>
        )}
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowShortcuts(true)}
          className="gap-1.5"
        >
          <HelpCircle className="w-4 h-4" />
          <span className="hidden sm:inline">快捷鍵</span>
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          className="gap-1.5"
          disabled={similarityGroups.length === 0}
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">下載結果</span>
        </Button>
      </div>
    </header>
  );
};

export default Header; 