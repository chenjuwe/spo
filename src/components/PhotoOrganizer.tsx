import { Suspense, lazy, useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Upload, FolderOpen, Image, Settings, Play, CheckCircle } from "lucide-react";
import { ProcessingStatus } from "./ProcessingStatus";
import { toast } from "sonner";
import { 
  calculatePerceptualHash, 
  analyzeImageQuality, 
  groupSimilarPhotos 
} from "@/lib/imageAnalysis";
import { downloadOrganizedFiles } from "@/lib/fileOrganizer";
import ImageWorker from "@/lib/imageWorker.ts?worker";
import heic2any from "heic2any";

interface PhotoFile {
  file: File;
  preview: string;
  id: string;
  similarity?: number;
  isSelected?: boolean;
  group?: string;
  quality?: {
    sharpness: number;
    brightness: number;
    contrast: number;
    score: number;
  };
  hash?: string;
  path?: string;
}

interface SimilarityGroup {
  id: string;
  photos: string[];
  bestPhoto: string;
  averageSimilarity: number;
}

interface ProcessingStep {
  name: string;
  status: 'pending' | 'processing' | 'completed';
  progress: number;
}

// 動態載入大型元件
const PhotoGrid = lazy(() => import("./PhotoGrid"));
const SettingsPanel = lazy(() => import("./SettingsPanel"));
const ResultsView = lazy(() => import("./ResultsView"));

const PhotoOrganizer = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [similarityThreshold, setSimilarityThreshold] = useState(90);
  const [similarityGroups, setSimilarityGroups] = useState<SimilarityGroup[]>([]);
  const [settings, setSettings] = useState({
    autoRename: true,
    preserveOriginal: true,
    optimizeQuality: false,
    maxDimension: 1920
  });
  
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([
    { name: "分析照片品質", status: 'pending', progress: 0 },
    { name: "計算感知哈希", status: 'pending', progress: 0 },
    { name: "分析相似性", status: 'pending', progress: 0 },
    { name: "挑選最佳照片", status: 'pending', progress: 0 },
    { name: "準備下載檔案", status: 'pending', progress: 0 }
  ]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // 支援 HEIC 轉換
    const convertedFiles: File[] = [];
    for (const file of acceptedFiles) {
      if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic")) {
        try {
          const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 });
          // heic2any 可能回傳 Blob 或 Blob[]
          const blobs = Array.isArray(blob) ? blob : [blob];
          blobs.forEach((b, idx) => {
            const jpegFile = new File([b], file.name.replace(/\.heic$/i, `.jpg`), { type: "image/jpeg" });
            convertedFiles.push(jpegFile);
          });
        } catch (e) {
          toast.error(`HEIC 轉換失敗: ${file.name}`);
        }
      } else {
        convertedFiles.push(file);
      }
    }
    const imageFiles = convertedFiles.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast.error("請選擇圖片檔案");
      return;
    }
    const newPhotos: PhotoFile[] = imageFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      id: Math.random().toString(36).substr(2, 9),
      isSelected: false,
      path: (file as any).webkitRelativePath || file.name
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

  const BATCH_SIZE = 5;
  const worker = new ImageWorker();

  function runWorkerTask(task, file) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).substr(2, 9);
      const handler = (e) => {
        if (e.data.id === id) {
          worker.removeEventListener("message", handler);
          resolve(e.data.result);
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage({ task, file, id });
    });
  }

  const startProcessing = async () => {
    if (photos.length === 0) {
      toast.error("請先選擇照片");
      return;
    }

    setIsProcessing(true);
    setCurrentStep(0);

    try {
      const processedPhotos = [...photos];

      // 步驟 1: 分析照片品質（Web Worker 批次並行）
      setCurrentStep(0);
      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 0 ? 'processing' : 'pending'
      })));

      for (let i = 0; i < processedPhotos.length; i += BATCH_SIZE) {
        const batch = processedPhotos.slice(i, i + BATCH_SIZE);
        const qualities = await Promise.all(
          batch.map(photo => runWorkerTask('analyzeImageQuality', photo.file))
        );
        for (let j = 0; j < batch.length; j++) {
          batch[j].quality = qualities[j];
        }
        const progress = Math.round(((i + batch.length) / processedPhotos.length) * 100);
        setProcessingSteps(prev => prev.map((step, index) => ({
          ...step,
          progress: index === 0 ? progress : step.progress
        })));
      }

      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 0 ? 'completed' : step.status
      })));

      // 步驟 2: 計算感知哈希（Web Worker 批次並行）
      setCurrentStep(1);
      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 1 ? 'processing' : step.status
      })));

      for (let i = 0; i < processedPhotos.length; i += BATCH_SIZE) {
        const batch = processedPhotos.slice(i, i + BATCH_SIZE);
        const hashes = await Promise.all(
          batch.map(photo => runWorkerTask('calculatePerceptualHash', photo.file))
        );
        for (let j = 0; j < batch.length; j++) {
          batch[j].hash = hashes[j];
        }
        const progress = Math.round(((i + batch.length) / processedPhotos.length) * 100);
        setProcessingSteps(prev => prev.map((step, index) => ({
          ...step,
          progress: index === 1 ? progress : step.progress
        })));
      }

      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 1 ? 'completed' : step.status
      })));

      // 步驟 3: 分析相似性
      setCurrentStep(2);
      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 2 ? 'processing' : step.status
      })));

      const groups = await groupSimilarPhotos(processedPhotos, similarityThreshold);
      setSimilarityGroups(groups);

      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 2 ? 'completed' : step.status,
        progress: index === 2 ? 100 : step.progress
      })));

      // 步驟 4: 挑選最佳照片
      setCurrentStep(3);
      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 3 ? 'processing' : step.status
      })));

      // 標記分組照片
      for (const group of groups) {
        for (const photoId of group.photos) {
          const photoIndex = processedPhotos.findIndex(p => p.id === photoId);
          if (photoIndex !== -1) {
            processedPhotos[photoIndex].group = group.id;
          }
        }
      }

      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 3 ? 'completed' : step.status,
        progress: index === 3 ? 100 : step.progress
      })));

      // 步驟 5: 準備下載檔案
      setCurrentStep(4);
      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 4 ? 'processing' : step.status
      })));

      // 模擬準備時間
      for (let progress = 0; progress <= 100; progress += 20) {
        setProcessingSteps(prev => prev.map((step, index) => ({
          ...step,
          progress: index === 4 ? progress : step.progress
        })));
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      setProcessingSteps(prev => prev.map((step, index) => ({
        ...step,
        status: index === 4 ? 'completed' : step.status
      })));

      setPhotos(processedPhotos);
      setIsProcessing(false);
      setShowResults(true);
      
      const duplicateCount = groups.reduce((sum, group) => sum + group.photos.length - 1, 0);
      toast.success(`處理完成！找到 ${groups.length} 個重複分組，將移除 ${duplicateCount} 張重複照片`);
      
    } catch (error) {
      console.error("處理照片時發生錯誤:", error);
      toast.error("處理照片時發生錯誤，請重試");
      setIsProcessing(false);
    }
  };

  const clearPhotos = () => {
    photos.forEach(photo => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setSimilarityGroups([]);
    setShowResults(false);
    setProcessingSteps(prev => prev.map(step => ({
      ...step,
      status: 'pending',
      progress: 0
    })));
    toast.success("已清除所有照片");
  };

  const handleDownload = async () => {
    try {
      if (photos.length > 200) {
        toast.info("照片數量較多，將分批下載多個壓縮檔以避免瀏覽器記憶體不足。請耐心等待所有檔案下載完成。", { duration: 8000 });
      }
      await downloadOrganizedFiles(photos, similarityGroups, {
        autoRename: settings.autoRename,
        preserveOriginal: settings.preserveOriginal,
        maxDimension: settings.maxDimension,
        optimizeQuality: settings.optimizeQuality
      });
      toast.success("檔案下載開始！");
    } catch (error) {
      console.error("下載檔案時發生錯誤:", error);
      toast.error("下載檔案時發生錯誤");
    }
  };

  const handleBackToEdit = () => {
    setShowResults(false);
  };

  // 元件卸載時釋放所有 preview URL
  useEffect(() => {
    return () => {
      photos.forEach(photo => {
        try {
          URL.revokeObjectURL(photo.preview);
        } catch {}
      });
    };
  }, [photos]);

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
        <Suspense fallback={null}>
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
        </Suspense>
      </div>
    </div>
  );
};

export default PhotoOrganizer;