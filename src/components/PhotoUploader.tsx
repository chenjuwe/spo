import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { PhotoFile } from "@/lib/types";
import { convertHeicToJpeg } from "@/lib/imageProcessingService";

interface PhotoUploaderProps {
  onPhotosAdded: (photos: PhotoFile[]) => void;
  isDisabled?: boolean;
  showDropArea?: boolean;
}

export const PhotoUploader = ({
  onPhotosAdded,
  isDisabled = false,
  showDropArea = true
}: PhotoUploaderProps) => {
  const [isUploading, setIsUploading] = useState(false);

  const handleFiles = useCallback(async (acceptedFiles: File[]) => {
    if (isDisabled || isUploading) return;
    
    try {
      setIsUploading(true);
      
      // 提前過濾掉非圖片檔
      const imageFiles = acceptedFiles.filter(file => file.type.startsWith('image/') || 
        file.name.toLowerCase().endsWith('.heic'));
      
      if (imageFiles.length === 0) {
        toast.error("請選擇圖片檔案");
        setIsUploading(false);
        return;
      }
      
      // 顯示進度通知
      const progressToast = toast.loading(`處理 ${imageFiles.length} 張照片...`);
      
      // 處理 HEIC 轉換
      const processedFiles: File[] = [];
      const totalFiles = imageFiles.length;
      let processedCount = 0;
      
      for (const file of imageFiles) {
        try {
          // 轉換 HEIC 或保留原始檔案
          const processedFile = file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic")
            ? await convertHeicToJpeg(file)
            : file;
            
          processedFiles.push(processedFile);
          
          // 更新進度
          processedCount++;
          if (processedCount % 5 === 0 || processedCount === totalFiles) {
            toast.loading(`處理中... ${processedCount}/${totalFiles}`, { id: progressToast });
          }
        } catch (error) {
          console.error(`處理檔案失敗: ${file.name}`, error);
          // 繼續處理其他檔案
        }
      }
      
      // 創建 PhotoFile 物件
      const newPhotos: PhotoFile[] = processedFiles.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        id: Math.random().toString(36).substr(2, 9),
        isSelected: false,
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      }));
      
      toast.dismiss(progressToast);
      
      if (newPhotos.length > 0) {
        onPhotosAdded(newPhotos);
        toast.success(`已載入 ${newPhotos.length} 張照片`);
      } else {
        toast.error("無法載入任何照片");
      }
    } catch (error) {
      console.error("處理照片時發生錯誤:", error);
      toast.error("處理照片時發生錯誤");
    } finally {
      setIsUploading(false);
    }
  }, [isDisabled, isUploading, onPhotosAdded]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    handleFiles(acceptedFiles);
  }, [handleFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp', '.heic']
    },
    multiple: true,
    disabled: isDisabled || isUploading
  });

  const handleFolderSelect = () => {
    if (isDisabled || isUploading) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.accept = 'image/*';
    
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files) {
        const files = Array.from(target.files);
        handleFiles(files);
      }
    };
    
    input.click();
  };

  if (!showDropArea) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-2">
        <Button
          type="button"
          onClick={(e) => {
            const rootProps = getRootProps();
            if (rootProps.onClick) rootProps.onClick(e);
          }}
          disabled={isDisabled || isUploading}
          className="w-full sm:w-auto"
        >
          <Upload className="w-4 h-4 mr-2" />
          {isUploading ? '上傳中...' : '選擇檔案'}
        </Button>
        <Button
          variant="outline"
          onClick={handleFolderSelect}
          disabled={isDisabled || isUploading}
          className="w-full sm:w-auto mt-2 sm:mt-0"
        >
          <FolderOpen className="w-4 h-4 mr-2" />
          {isUploading ? '上傳中...' : '選擇資料夾'}
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-6 sm:p-12">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-6 sm:p-12 text-center cursor-pointer transition-all duration-200
          ${isDragActive 
            ? 'border-primary bg-photo-hover' 
            : 'border-photo-border hover:border-primary hover:bg-photo-hover'
          }
          ${isDisabled || isUploading ? 'opacity-60 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className={`w-8 h-8 ${isUploading ? 'animate-pulse' : ''} text-primary`} />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold">
              {isUploading 
                ? '上傳中，請稍候...' 
                : isDragActive 
                  ? '放開滑鼠來上傳照片' 
                  : '拖曳照片到這裡'}
            </h3>
            <p className="text-muted-foreground">
              支援 JPG、PNG、GIF、WebP、HEIC 等格式
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
            <Button 
              variant="outline" 
              onClick={handleFolderSelect}
              disabled={isDisabled || isUploading}
              className="w-full sm:w-auto"
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              選擇資料夾
            </Button>
            <span className="text-sm text-muted-foreground my-2 sm:my-0">或</span>
            <Button 
              disabled={isDisabled || isUploading}
              className="w-full sm:w-auto"
            >
              <Upload className="w-4 h-4 mr-2" />
              選擇檔案
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default PhotoUploader; 