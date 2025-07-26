import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Folder } from "lucide-react";
import { toast } from "sonner";

// 簡化函數 - 檢查是否在 Electron 環境中
function isElectron(): boolean {
  return window.electronAPI !== undefined;
}

// 簡易照片數據接口
interface PhotoData {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  lastModified: number;
  dateAdded: string;
}

// 簡化版的 PhotoUploader 組件
const PhotoUploader = ({ 
  onFilesAdded
}: {
  onFilesAdded: (files: PhotoData[]) => void;
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [hasPhotosLibraryError, setHasPhotosLibraryError] = useState(false);
  
  // 開啟檔案選擇對話框
  const handleFileSelect = async () => {
    if (!isElectron() || !window.electronAPI || isUploading) return;
    
    try {
      setIsUploading(true);
      const filePaths = await window.electronAPI.openFileDialog();
      
      if (filePaths && filePaths.length > 0) {
        await processSelectedFiles(filePaths);
      }
      
    } catch (error) {
      console.error('選擇檔案時出錯:', error);
      toast.error('選擇檔案時發生錯誤');
    } finally {
      setIsUploading(false);
    }
  };
  
  // 處理選擇的檔案
  const processSelectedFiles = async (filePaths: string[]) => {
    if (!window.electronAPI) return;
    
    const progressToast = toast.loading(`處理 ${filePaths.length} 個檔案...`);
    let loadedCount = 0;
    let errorCount = 0;
    const results: PhotoData[] = [];
    
    for (const path of filePaths) {
      try {
        const fileResult = await window.electronAPI.readFile(path);
        
        // 處理錯誤結果
        if (typeof fileResult === 'object' && 'error' in fileResult) {
          errorCount++;
          
          if (fileResult.error === 'PHOTOS_LIBRARY_PERMISSION') {
            setHasPhotosLibraryError(true);
            toast.error('無法存取照片庫，需要特別權限', {
              description: '請在系統設定中授權應用程式存取您的照片庫'
            });
          } else if (fileResult.error.includes('PERMISSION')) {
            setHasPermissionError(true);
            toast.error('檔案存取權限不足', {
              description: fileResult.message || '請檢查應用程式權限'
            });
          }
          
          continue;
        }
        
        // 處理成功讀取的檔案
        const base64Data = String(fileResult);
        const fileName = path.split(/[\\/]/).pop() || 'unknown.jpg';
        const fileType = fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg' :
                       fileName.endsWith('.png') ? 'image/png' :
                       fileName.endsWith('.gif') ? 'image/gif' : 'image/unknown';
        
        results.push({
          id: Date.now() + '-' + loadedCount,
          name: fileName,
          size: base64Data.length,
          type: fileType,
          dataUrl: `data:${fileType};base64,${base64Data}`,
          lastModified: Date.now(),
          dateAdded: new Date().toISOString()
        });
        
        loadedCount++;
        
      } catch (error) {
        console.error('處理檔案時出錯:', error);
        errorCount++;
      }
    }
    
    // 更新進度提示
    if (errorCount > 0) {
      toast.error(`處理完成: ${loadedCount} 成功, ${errorCount} 失敗`, { id: progressToast });
    } else if (loadedCount > 0) {
      toast.success(`成功載入 ${loadedCount} 個檔案`, { id: progressToast });
    } else {
      toast.error('無法載入任何檔案', { id: progressToast });
    }
    
    // 將結果傳遞給父組件
    if (results.length > 0) {
      onFilesAdded(results);
    }
  };
  
  return (
    <Card className="p-6">
      {/* 權限錯誤提示 */}
      {hasPermissionError && (
        <div className="mb-4 p-4 border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 rounded-md">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-amber-800">檔案存取權限不足</h4>
              <p className="text-sm mt-1 text-amber-700">
                請前往「系統設定」→「隱私權與安全性」→「檔案和資料夾」，
                確保已允許「Smart Photo Organizer」存取您的檔案。
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 bg-amber-100 border-amber-300"
                onClick={() => {
                  if (isElectron() && window.electronAPI) {
                    window.electronAPI.setTitle('open-privacy-settings');
                  }
                }}
              >
                開啟系統設定
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* 照片庫錯誤提示 */}
      {hasPhotosLibraryError && (
        <div className="mb-4 p-4 border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 rounded-md">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-amber-800">照片庫存取受限</h4>
              <p className="text-sm mt-1 text-amber-700">
                macOS 安全機制限制直接存取照片庫。建議先使用「照片」應用程式將照片匯出到一般資料夾後再處理。
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* 檔案選擇按鈕 */}
      <div className="text-center">
        <Button
          onClick={handleFileSelect}
          disabled={isUploading}
          className="mx-auto"
        >
          <Folder className="w-4 h-4 mr-2" />
          {isUploading ? '處理中...' : '選擇照片'}
        </Button>
      </div>
    </Card>
  );
};

export default PhotoUploader; 