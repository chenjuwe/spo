import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Upload, FolderOpen, Image, Settings, Play, CheckCircle } from "lucide-react";
import { PhotoGrid } from "./PhotoGrid";
import { ProcessingStatus } from "./ProcessingStatus";
import { SettingsPanel } from "./SettingsPanel";
import { toast } from "sonner";

interface PhotoFile {
  file: File;
  preview: string;
  id: string;
  similarity?: number;
  isSelected?: boolean;
  group?: string;
}

interface ProcessingStep {
  name: string;
  status: 'pending' | 'processing' | 'completed';
  progress: number;
}

export const PhotoOrganizer = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [similarityThreshold, setSimilarityThreshold] = useState(90);
  
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([
    { name: "載入照片", status: 'pending', progress: 0 },
    { name: "分析相似性", status: 'pending', progress: 0 },
    { name: "挑選最佳照片", status: 'pending', progress: 0 },
    { name: "整理檔案", status: 'pending', progress: 0 }
  ]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const imageFiles = acceptedFiles.filter(file => 
      file.type.startsWith('image/')
    );

    if (imageFiles.length === 0) {
      toast.error("請選擇圖片檔案");
      return;
    }

    const newPhotos: PhotoFile[] = imageFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9),
      isSelected: false
    }));

    setPhotos(prev => [...prev, ...newPhotos]);
    toast.success(`已載入 ${imageFiles.length} 張照片`);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp']
    },
    multiple: true
  });

  const handleFolderSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.accept = 'image/*';
    
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files) {
        const files = Array.from(target.files);
        onDrop(files);
      }
    };
    
    input.click();
  };

  const startProcessing = async () => {
    if (photos.length === 0) {
      toast.error("請先選擇照片");
      return;
    }

    setIsProcessing(true);
    setCurrentStep(0);

    // 模擬處理步驟
    for (let i = 0; i < processingSteps.length; i++) {
      setCurrentStep(i);
      
      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === i ? 'processing' : index < i ? 'completed' : 'pending'
      })));

      // 模擬進度更新
      for (let progress = 0; progress <= 100; progress += 10) {
        setProcessingSteps(prev => prev.map((step, index) => ({
          ...step,
          progress: index === i ? progress : step.progress
        })));
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index <= i ? 'completed' : 'pending',
        progress: index <= i ? 100 : 0
      })));
    }

    setIsProcessing(false);
    toast.success("照片整理完成！");
  };

  const clearPhotos = () => {
    photos.forEach(photo => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setProcessingSteps(prev => prev.map(step => ({
      ...step,
      status: 'pending',
      progress: 0
    })));
    toast.success("已清除所有照片");
  };

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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings className="w-4 h-4" />
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
        {showSettings && (
          <SettingsPanel
            similarityThreshold={similarityThreshold}
            onSimilarityThresholdChange={setSimilarityThreshold}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* Drop Zone */}
        {photos.length === 0 && (
          <Card className="p-12">
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-200
                ${isDragActive 
                  ? 'border-primary bg-photo-hover' 
                  : 'border-photo-border hover:border-primary hover:bg-photo-hover'
                }
              `}
            >
              <input {...getInputProps()} />
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold">
                    {isDragActive ? '放開滑鼠來上傳照片' : '拖曳照片到這裡'}
                  </h3>
                  <p className="text-muted-foreground">
                    支援 JPG、PNG、GIF、WebP 等格式
                  </p>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <Button variant="outline" onClick={handleFolderSelect}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    選擇資料夾
                  </Button>
                  <span className="text-sm text-muted-foreground">或</span>
                  <Button>
                    <Upload className="w-4 h-4 mr-2" />
                    選擇檔案
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Processing Status */}
        {isProcessing && (
          <ProcessingStatus
            steps={processingSteps}
            currentStep={currentStep}
          />
        )}

        {/* Photo Grid */}
        {photos.length > 0 && (
          <>
            <PhotoGrid photos={photos} onPhotosChange={setPhotos} />
            
            {/* Action Bar */}
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-semibold">準備開始整理照片</h3>
                  <p className="text-sm text-muted-foreground">
                    將分析照片相似性並自動挑選最佳版本
                  </p>
                </div>
                <Button
                  onClick={startProcessing}
                  disabled={isProcessing}
                  size="lg"
                  className="px-8"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      處理中...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      開始整理
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};