import { useState, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { downloadManager, DownloadStatus, DownloadProgressListener } from '@/lib/downloadManager';
import { X, Download, Clock, XCircle } from 'lucide-react';

const DownloadProgress = () => {
  const [status, setStatus] = useState<DownloadStatus>(downloadManager.getStatus());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 創建下載進度監聽器
    const listener: DownloadProgressListener = {
      onStart: () => {
        setVisible(true);
        setStatus(downloadManager.getStatus());
      },
      onProgress: (current, total, percentage) => {
        setStatus(downloadManager.getStatus());
      },
      onChunkComplete: (chunkIndex, totalChunks) => {
        setStatus(downloadManager.getStatus());
      },
      onComplete: () => {
        setStatus(downloadManager.getStatus());
        // 下載完成後3秒關閉進度框
        setTimeout(() => setVisible(false), 3000);
      },
      onError: () => {
        setStatus(downloadManager.getStatus());
        // 錯誤後5秒關閉進度框
        setTimeout(() => setVisible(false), 5000);
      },
      onCancel: () => {
        setStatus(downloadManager.getStatus());
        // 取消後1秒關閉進度框
        setTimeout(() => setVisible(false), 1000);
      }
    };

    // 添加監聽器
    downloadManager.addListener(listener);

    // 初始檢查狀態
    const initialStatus = downloadManager.getStatus();
    setVisible(initialStatus.isDownloading);
    setStatus(initialStatus);

    // 清理函數
    return () => downloadManager.removeListener(listener);
  }, []);

  // 如果沒有下載任務且不可見，不渲染任何內容
  if (!visible && !status.isDownloading) {
    return null;
  }

  // 格式化剩餘時間
  const formatTimeRemaining = (ms: number | null): string => {
    if (ms === null) return '計算中...';
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes} 分 ${remainingSeconds} 秒`;
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 w-96 max-w-full shadow-lg">
      <Card className="p-4 bg-card border-primary/20">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" />
              <h3 className="font-medium">下載進度</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setVisible(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <Progress value={status.progress} className="h-2" />
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {status.currentChunk}/{status.totalChunks} 個檔案
              </span>
              <span>{status.progress}%</span>
            </div>
          </div>

          {/* Time Estimate */}
          {status.isDownloading && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>預估剩餘時間: {formatTimeRemaining(status.estimatedTimeRemaining)}</span>
            </div>
          )}

          {/* Controls */}
          {status.isDownloading && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadManager.cancelDownload()}
                className="text-xs"
              >
                <XCircle className="w-3 h-3 mr-1" />
                取消下載
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default DownloadProgress; 