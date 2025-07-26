import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Folder } from "lucide-react";
import { toast } from "sonner";
import { ErrorType, errorHandler, ErrorSeverity } from "../lib/errorHandlingService";
import { PhotoFile } from "../lib/types";

// 為 window 對象添加 electronAPI 類型
declare global {
  interface Window {
    electronAPI?: {
      openFileDialog: (options?: any) => Promise<string[]>;
      readFile: (path: string, options?: any) => Promise<any>;
      setTitle: (title: string) => void;
      checkPhotosPermission: () => Promise<any>;
      requestPhotosPermission: () => Promise<any>;
      openPhotosLibrary: () => Promise<any>;
    };
  }
}

// 檢查是否在 Electron 環境中
function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
}

// 簡化版的 PhotoUploader 組件
const PhotoUploader = ({ 
  onPhotosAdded
}: {
  onPhotosAdded: (files: PhotoFile[]) => void;
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  
  // 開啟檔案選擇對話框
  const handleFileSelect = async () => {
    if (!isElectron() || isUploading) return;
    
    try {
      setIsUploading(true);
      toast.loading("正在開啟檔案選擇對話框...");
      
      // 使用 electronAPI 選擇檔案
      const filePaths = await window.electronAPI!.openFileDialog();
      
      // 如果取消選擇，直接返回
      if (!filePaths || filePaths.length === 0) {
        toast.dismiss();
        setIsUploading(false);
        return;
      }
      
      // 限制一次處理的檔案數量，避免內存問題
      const maxFilesToProcess = 5;
      const filesToProcess = filePaths.slice(0, maxFilesToProcess);
      
      if (filePaths.length > maxFilesToProcess) {
        toast.warning(`選擇了 ${filePaths.length} 個檔案，但一次只能處理 ${maxFilesToProcess} 個`);
      }
      
      // 處理所選檔案
      const loadingToast = toast.loading(`處理中 0/${filesToProcess.length} 檔案...`);
      const results: PhotoFile[] = [];
      
      for (let i = 0; i < filesToProcess.length; i++) {
        const path = filesToProcess[i];
        
        try {
          // 更新進度
          toast.loading(`處理中 ${i+1}/${filesToProcess.length} 檔案...`, { id: loadingToast });
          
          // 使用 readFile 讀取檔案
          const fileResult = await window.electronAPI!.readFile(path);
          
          // 處理可能的錯誤回應
          if (typeof fileResult === 'object' && 'error' in fileResult) {
            console.error(`無法讀取檔案: ${path}`, fileResult);
            continue;
          }
          
          // 從路徑獲取檔案名
          const fileName = path.split(/[\\/]/).pop() || 'unknown';
          
          // 確定檔案類型
          const fileType = fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg' :
                          fileName.endsWith('.png') ? 'image/png' :
                          fileName.endsWith('.heic') ? 'image/heic' :
                          fileName.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
          
          // 創建 Blob 和 File 對象
          const base64Data = String(fileResult);
          const byteCharacters = atob(base64Data);
          const byteArrays = [];
          
          // 分塊處理大檔案，避免內存溢出
          const sliceSize = 512 * 1024; // 512KB 塊
          for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
              byteNumbers[i] = slice.charCodeAt(i);
            }
            byteArrays.push(new Uint8Array(byteNumbers));
          }
          
          // 創建 Blob
          const blob = new Blob(byteArrays, { type: fileType });
          
          // 創建檔案物件
          const file = new File([blob], fileName, { type: fileType });
          
          // 創建符合 PhotoFile 類型的對象
          const photoFile: PhotoFile = {
            id: `photo-${Date.now()}-${i}`,
            file: file,
            preview: URL.createObjectURL(blob),
            path: path
          };
          
          results.push(photoFile);
          
          // 釋放資源
          byteArrays.length = 0;
          
        } catch (error) {
          console.error(`處理檔案錯誤 (${path}):`, error);
        }
      }
      
      // 顯示結果
      toast.dismiss(loadingToast);
      
      if (results.length > 0) {
        onPhotosAdded(results);
        toast.success(`成功載入 ${results.length} 個檔案`);
      } else {
        toast.error("無法載入任何檔案");
      }
    } catch (error) {
      console.error("選擇檔案時發生錯誤:", error);
      
      if (String(error).includes('permission') || String(error).includes('access')) {
        setHasPermissionError(true);
      }
      
      toast.error("選擇檔案時發生錯誤", { 
        description: String(error).includes('permission') ? 
          "可能是權限問題，請檢查應用權限設定" : "請稍後再試" 
      });
    } finally {
      setIsUploading(false);
    }
  };
  
  return (
    <Card className="p-10 flex flex-col items-center justify-center space-y-4">
      <Button 
        size="lg" 
        variant="outline" 
        className="flex items-center gap-2"
        disabled={isUploading}
        onClick={handleFileSelect}
      >
        <Folder className="h-5 w-5" />
        {isUploading ? '處理中...' : '選擇照片'}
      </Button>
      
      {hasPermissionError && (
        <div className="flex items-center text-amber-600 bg-amber-50 p-2 rounded-md text-sm">
          <AlertTriangle className="h-4 w-4 mr-2" />
          <span>檔案存取權限不足，請檢查系統權限設定</span>
        </div>
      )}
    </Card>
  );
};

export default PhotoUploader; 