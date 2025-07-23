import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProcessingStatus } from "./ProcessingStatus";
import { Play, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { 
  PhotoFile, 
  ProcessingStep, 
  SimilarityGroup,
  ProcessingTaskOptions
} from "@/lib/types";
import {
  analyzePhotosQuality,
  calculatePhotosHash,
  calculatePhotosAllHashes,
  groupSimilarPhotosWithAdjustment
} from "@/lib/imageProcessingService";

interface PhotoProcessorProps {
  photos: PhotoFile[];
  onProcessingComplete: (processedPhotos: PhotoFile[], similarityGroups: SimilarityGroup[]) => void;
  similarityThreshold: number;
}

export const PhotoProcessor = ({ 
  photos, 
  onProcessingComplete,
  similarityThreshold
}: PhotoProcessorProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([
    { name: "分析照片品質", status: 'pending', progress: 0 },
    { name: "計算照片特徵", status: 'pending', progress: 0 },
    { name: "分析相似性", status: 'pending', progress: 0 },
    { name: "挑選最佳照片", status: 'pending', progress: 0 },
    { name: "準備結果", status: 'pending', progress: 0 }
  ]);
  
  // 用於取消處理操作
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const handleProcessingProgress = (step: number, progress: number) => {
    setProcessingSteps(prev => prev.map((s, idx) => 
      idx === step ? { ...s, progress } : s
    ));
  };

  const handleStepComplete = (step: number) => {
    setProcessingSteps(prev => prev.map((s, idx) => 
      idx === step ? { ...s, status: 'completed', progress: 100 } : s
    ));
  };

  const handleStepError = (step: number, error: string) => {
    setProcessingSteps(prev => prev.map((s, idx) => 
      idx === step ? { ...s, status: 'error', error } : s
    ));
  };
  
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      toast.info("處理已取消");
      setIsProcessing(false);
    }
  };

  const startProcessing = async () => {
    if (photos.length === 0) {
      toast.error("請先選擇照片");
      return;
    }

    try {
      setIsProcessing(true);
      
      // 每次開始處理時重置步驟狀態
      setProcessingSteps(prev => prev.map(step => ({
        ...step,
        status: 'pending',
        progress: 0,
        error: undefined
      })));
      
      // 創建新的 AbortController 用於取消處理
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      
      // 1. 分析照片品質
      setCurrentStep(0);
      setProcessingSteps(prev => prev.map((step, idx) => ({
        ...step,
        status: idx === 0 ? 'processing' : 'pending'
      })));
      
      const taskOptions: ProcessingTaskOptions = {
        onProgress: (progress) => handleProcessingProgress(0, progress),
        onError: (error) => handleStepError(0, error.message),
        signal
      };

      const processedPhotos = [...photos];
      const qualityMap = await analyzePhotosQuality(processedPhotos, taskOptions);
      
      // 更新每張照片的品質信息
      for (const photo of processedPhotos) {
        const quality = qualityMap.get(photo.id);
        if (quality) {
          photo.quality = quality;
        }
      }

      handleStepComplete(0);
      
      // 2. 計算多種哈希值
      setCurrentStep(1);
      setProcessingSteps(prev => prev.map((step, idx) => ({
        ...step,
        status: idx === 1 ? 'processing' : step.status
      })));
      
      taskOptions.onProgress = (progress) => handleProcessingProgress(1, progress);
      taskOptions.onError = (error) => handleStepError(1, error.message);
      
      // 使用多哈希計算
      const hashMap = await calculatePhotosAllHashes(processedPhotos, taskOptions);
      
      // 更新每張照片的哈希
      for (const photo of processedPhotos) {
        const hashes = hashMap.get(photo.id);
        if (hashes) {
          photo.hashes = hashes;
          photo.hash = hashes.pHash; // 向下兼容
        }
      }

      handleStepComplete(1);
      
      // 3. 分析相似性並分組
      setCurrentStep(2);
      setProcessingSteps(prev => prev.map((step, idx) => ({
        ...step,
        status: idx === 2 ? 'processing' : step.status
      })));
      
      taskOptions.onProgress = (progress) => handleProcessingProgress(2, progress);
      taskOptions.onError = (error) => handleStepError(2, error.message);
      
      // 使用考慮亮度和對比度的相似度分析
      const groups = await groupSimilarPhotosWithAdjustment(
        processedPhotos,
        taskOptions
      );

      handleStepComplete(2);
      
      // 4. 挑選最佳照片
      setCurrentStep(3);
      setProcessingSteps(prev => prev.map((step, idx) => ({
        ...step,
        status: idx === 3 ? 'processing' : step.status
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

      // 模擬處理時間
      for (let progress = 0; progress <= 100; progress += 20) {
        if (signal.aborted) break;
        handleProcessingProgress(3, progress);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      handleStepComplete(3);
      
      // 5. 準備結果
      setCurrentStep(4);
      setProcessingSteps(prev => prev.map((step, idx) => ({
        ...step,
        status: idx === 4 ? 'processing' : step.status
      })));
      
      // 模擬準備時間
      for (let progress = 0; progress <= 100; progress += 20) {
        if (signal.aborted) break;
        handleProcessingProgress(4, progress);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      handleStepComplete(4);
      
      // 處理完成
      onProcessingComplete(processedPhotos, groups);
      
      const duplicateCount = groups.reduce((sum, group) => sum + group.photos.length - 1, 0);
      toast.success(`處理完成！找到 ${groups.length} 個重複分組，將移除 ${duplicateCount} 張重複照片`);
    } catch (error) {
      const errorMessage = error instanceof DOMException && error.name === 'AbortError'
        ? '處理已取消'
        : '處理照片時發生錯誤，請重試';
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        // 已通過 handleCancel 處理訊息
      } else {
        console.error("處理照片時發生錯誤:", error);
        toast.error(errorMessage);
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <>
      {isProcessing && (
        <ProcessingStatus
          steps={processingSteps}
          currentStep={currentStep}
          onCancel={handleCancel}
        />
      )}
      
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
            disabled={isProcessing || photos.length === 0}
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
  );
};

export default PhotoProcessor; 