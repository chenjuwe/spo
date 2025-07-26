import React from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadManager } from '@/lib/downloadManager';
import { SimilarityGroup } from '@/lib/types';
import { ProcessingOptions } from '@/lib/types';

interface DownloadButtonProps {
  similarityGroups: SimilarityGroup[];
  settings: ProcessingOptions;
  photos: any[]; // 可以使用 PhotoFile[] 替換
}

/**
 * 下載按鈕元件
 * 負責顯示下載按鈕，點擊後處理下載相關邏輯
 */
const DownloadButton: React.FC<DownloadButtonProps> = ({ 
  similarityGroups, 
  settings,
  photos = []
}) => {
  const handleDownload = async () => {
    if (similarityGroups.length === 0) {
      toast.warning('沒有可下載的分組結果');
      return;
    }

    try {
      toast.info('準備下載分組結果');
      await downloadManager.downloadOrganizedFiles(photos, similarityGroups, settings);
    } catch (error) {
      toast.error('下載失敗', {
        description: error instanceof Error ? error.message : '未知錯誤'
      });
      console.error('下載失敗:', error);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      className="gap-1.5"
      disabled={similarityGroups.length === 0}
      title="下載整理結果"
    >
      <Download className="w-4 h-4" />
      <span className="hidden sm:inline">下載結果</span>
    </Button>
  );
};

export default DownloadButton; 