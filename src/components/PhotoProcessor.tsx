import React, { useState, useCallback, useEffect } from 'react';
import { PhotoFile, ProcessingStep } from '../lib/types';
import { MultiLevelFeature, FeatureLevel } from '../lib/multiLevelFeatureFusion';
import { featureManager } from '../lib/featureManager';
import { validatePhotoBatch, ValidationErrorType, ValidationError } from '../lib/inputValidator';
import { 
  ErrorType, 
  errorHandler, 
  ErrorSeverity,
  handleErrorWithResult,
  safeExecute,
  withRetry
} from '../lib/errorHandlingService';
import { unwrapAsync, unwrapOrAsync, Result, ok } from '../lib/result';
import { Button } from './ui/button';
import { toast } from 'sonner'; // 使用 sonner 而不是 react-toastify

// 內存管理配置
const MEMORY_CONFIG = {
  // 設置批處理大小以避免內存溢出
  BATCH_SIZE: 2, // 減少到每批 2 個文件
  // 處理照片之間的延遲 (毫秒)
  BATCH_DELAY: 500, // 增加延遲
  // 每批之間的暫停時間 (毫秒)
  BATCH_PAUSE: 1000, // 增加暫停時間
  // 處理高級特徵的照片閾值 (如果照片數量大於此值，則不處理高級特徵)
  HIGH_FEATURE_THRESHOLD: 10, // 降低閾值
  // HEIC 文件的特殊處理
  HEIC_SPECIAL_HANDLING: true
};

// 簡化的 ProcessingStatus 組件 Props 接口，與主檔案保持一致
interface ProcessingStatusProps {
  steps: ProcessingStep[];
  currentStep: number;
  startTime?: number;
  onCancel?: () => void;
}

// 這裡臨時定義一個簡化版本的 ProcessingStatus 組件
// 在正式版本中應該導入正式的 ProcessingStatus 組件
const SimpleProcessingStatus: React.FC<{
  progress: number;
  total: number;
  processed: number;
  errors: number;
  onCancel?: () => void;
}> = ({ progress, total, processed, errors, onCancel }) => {
  return (
    <div className="mt-4 p-4 bg-slate-100 rounded-md">
      <div className="w-full h-2 bg-slate-200 rounded-full mb-2">
        <div 
          className="h-full bg-blue-600 rounded-full" 
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between text-sm">
        <span>進度: {progress}%</span>
        <span>已處理: {processed}/{total}</span>
        {errors > 0 && <span className="text-red-500">錯誤: {errors}</span>}
      </div>
      {onCancel && (
        <div className="mt-2 text-right">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onCancel}
            className="text-sm"
          >
            取消處理
          </Button>
        </div>
      )}
    </div>
  );
};

interface PhotoProcessorProps {
  photos: PhotoFile[];
  onProcessed: (processedPhotos: PhotoFile[]) => void;
  onFeatureExtracted: (features: Record<string, MultiLevelFeature>) => void;
  similarityThreshold?: number; // 相似度閾值
  batchSize?: number; // 批處理大小
}

export const PhotoProcessor: React.FC<PhotoProcessorProps> = ({
  photos,
  onProcessed,
  onFeatureExtracted,
  similarityThreshold = 90,
  batchSize = MEMORY_CONFIG.BATCH_SIZE
}) => {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [features, setFeatures] = useState<Record<string, MultiLevelFeature>>({});
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  
  // 初始化特徵管理器
  useEffect(() => {
    const initManager = async () => {
      // 使用 safeExecute 替代原始的錯誤處理
      const result = await safeExecute(
        async () => {
          await unwrapAsync(featureManager.initialize());
          
          // 設置批處理配置
          featureManager.setBatchConfig({
            defaultBatchSize: batchSize,
            highFeatureThreshold: MEMORY_CONFIG.HIGH_FEATURE_THRESHOLD
          });
          
          console.info('特徵管理器初始化成功');
          return true;
        },
        {
          errorType: ErrorType.SYSTEM_ERROR,
          errorMessage: '特徵管理器初始化失敗',
          recoverable: true,
          recoveryAction: () => initManager() // 提供重試操作
        }
      );
    };
    
    initManager();
    
    // 組件卸載時釋放資源
    return () => {
      featureManager.dispose();
    };
  }, [batchSize]);
  
  // 取消處理
  const cancelProcessing = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setProcessing(false);
      setProgress(0);
      
      // 通知用戶
      errorHandler.handleError(
        new Error('已取消照片處理'),
        ErrorType.UNKNOWN_ERROR,
        '處理已被用戶取消',
        false,
        undefined,
        ErrorSeverity.LOW
      );
    }
  }, [abortController]);

  // 使用 withRetry 包裝特徵提取函數
  const extractFeatureWithRetry = withRetry(
    async (photo: PhotoFile, level: FeatureLevel) => {
      const result = await featureManager.extractAndCacheFeature(photo, level);
      return unwrapOrAsync(Promise.resolve(result), null);
    },
    {
      maxAttempts: 2,
      errorType: ErrorType.PHOTO_EXTRACTION_ERROR,
      errorMessage: '特徵提取失敗，將嘗試重試',
      severity: ErrorSeverity.MEDIUM,
      autoRetry: true
    }
  );
  
  // 使用優化的批量處理，防止內存溢出
  const processPhotos = useCallback(async () => {
    if (photos.length === 0 || processing) return;
    
    // 創建新的 AbortController
    const controller = new AbortController();
    setAbortController(controller);
    
    setProcessing(true);
    setProgress(0);
    setProcessedCount(0);
    setErrorCount(0);
    
    try {
      // 驗證照片
      const { validPhotos, errors } = await validatePhotoBatch(photos);
      
      if (errors.length > 0) {
        // 使用 errorHandler 處理所有的驗證錯誤
        errors.forEach(({ photo, error }) => {
          errorHandler.handleError(
            new Error(error.message),
            ErrorType.INPUT_ERROR,
            `照片 ${photo.id} 驗證失敗: ${error.details || error.message}`,
            true,
            // 添加恢復操作 - 可以嘗試重新處理該照片
            () => console.log(`嘗試重新驗證照片: ${photo.id}`),
            ErrorSeverity.MEDIUM
          );
        });
        
        setErrorCount(errors.length);
      }
      
      if (validPhotos.length === 0) {
        handleErrorWithResult(
          new Error('沒有有效的照片可處理'),
          ErrorType.INPUT_ERROR,
          '請上傳有效的照片',
          true
        );
        setProcessing(false);
        return;
      }
      
      // 處理有效照片
      const totalPhotos = validPhotos.length;
      const newFeatures: Record<string, MultiLevelFeature> = {};
      
      // 使用批處理配置
      const effectiveBatchSize = Math.min(
        featureManager.getBatchConfig().defaultBatchSize || batchSize, 
        MEMORY_CONFIG.BATCH_SIZE
      );
      
      // 將照片分成多個批次，以避免內存溢出
      const batches: PhotoFile[][] = [];
      for (let i = 0; i < totalPhotos; i += effectiveBatchSize) {
        batches.push(validPhotos.slice(i, i + effectiveBatchSize));
      }
      
      // 處理每個批次
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        // 檢查是否已取消
        if (controller.signal.aborted) {
          console.log('照片處理已被取消');
          break;
        }
        
        const batch = batches[batchIndex];
        
        // 並行處理批次中的照片
        const batchPromises = batch.map(async (photo) => {
          try {
            // 使用帶有重試功能的特徵提取
            const lowFeature = await extractFeatureWithRetry(photo, FeatureLevel.LOW);
            const midFeature = await extractFeatureWithRetry(photo, FeatureLevel.MID);
            
            let highFeature: MultiLevelFeature | null = null;
            
            // 僅在需要時提取高級特徵 (深度學習)，並且照片數量不多的情況下
            const highFeatureThreshold = Math.min(
              featureManager.getBatchConfig().highFeatureThreshold || 100,
              MEMORY_CONFIG.HIGH_FEATURE_THRESHOLD
            );
            
            if (totalPhotos <= highFeatureThreshold) {
              highFeature = await extractFeatureWithRetry(photo, FeatureLevel.HIGH);
            }
            
            if (!lowFeature && !midFeature && !highFeature) {
              throw new Error(`無法提取照片 ${photo.id} 的特徵`);
            }
            
            // 創建完整的多級特徵
            const feature: MultiLevelFeature = {
              id: photo.id,
              lowLevelFeatures: lowFeature?.lowLevelFeatures,
              midLevelFeatures: midFeature?.midLevelFeatures,
              highLevelFeatures: highFeature?.highLevelFeatures,
              metadata: { photo }
            };
            
            newFeatures[photo.id] = feature;
            
            // 在批處理中添加小暫停，降低內存壓力
            await new Promise(resolve => setTimeout(resolve, MEMORY_CONFIG.BATCH_DELAY));
            
            return photo;
          } catch (error) {
            // 使用統一的錯誤處理
            handleErrorWithResult(
              error instanceof Error ? error : new Error(`處理照片 ${photo.id} 時發生錯誤`),
              ErrorType.PHOTO_EXTRACTION_ERROR,
              `無法處理照片 ${photo.file.name}`,
              true,
              // 添加恢復操作
              () => {
                console.log(`嘗試重新處理照片: ${photo.id}`);
                // 這裡可以添加單獨處理此照片的邏輯
              }
            );
            
            setErrorCount(prev => prev + 1);
            return null;
          }
        });
        
        // 等待批次完成
        const processedBatch = (await Promise.all(batchPromises)).filter(Boolean) as PhotoFile[];
        setProcessedCount(prev => prev + processedBatch.length);
        
        const processedTotal = Math.min(
          (batchIndex + 1) * effectiveBatchSize, 
          totalPhotos
        );
        setProgress(Math.round((processedTotal / totalPhotos) * 100));
        
        // 批次之間的暫停，讓 GC 有機會回收內存
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, MEMORY_CONFIG.BATCH_PAUSE));
          
          // 主動請求垃圾回收（僅在開發環境有效）
          if (typeof window !== 'undefined' && 
              typeof window.gc === 'function' && 
              process.env.NODE_ENV === 'development') {
            try {
              window.gc();
            } catch (e) {
              console.warn('無法主動觸發垃圾回收');
            }
          }
        }
        
        // 檢查是否有照片處理失敗
        if (processedBatch.length < batch.length) {
          // 記錄處理失敗的警告
          errorHandler.handleError(
            new Error(`批次處理中有 ${batch.length - processedBatch.length} 個照片處理失敗`),
            ErrorType.PHOTO_PROCESSING_ERROR,
            '部分照片處理失敗',
            true,
            // 添加恢復操作
            () => console.log('嘗試重新處理失敗的照片'),
            ErrorSeverity.MEDIUM
          );
        }
      }
      
      // 處理完成，更新特徵和照片
      setFeatures(newFeatures);
      
      // 通知父組件
      const processedPhotos = validPhotos.filter(photo => newFeatures[photo.id] !== undefined);
      
      if (processedPhotos.length > 0) {
        onProcessed(processedPhotos);
        onFeatureExtracted(newFeatures);
        
        toast.success(`成功處理 ${processedPhotos.length} 張照片`, {
          description: `共計 ${validPhotos.length} 張, 失敗 ${errorCount} 張`,
        });
      } else {
        toast.error('沒有照片能夠被處理', {
          description: '所有照片處理失敗，請檢查照片格式或嘗試重試',
        });
      }
      
    } catch (error) {
      console.error('照片處理時發生錯誤:', error);
      
      // 使用統一的錯誤處理
      errorHandler.handleError(
        error instanceof Error ? error : new Error('照片處理失敗'),
        ErrorType.PHOTO_PROCESSING_ERROR,
        '照片處理過程中發生錯誤',
        true,
        // 添加恢復操作
        () => processPhotos(), // 提供重試整個過程的選項
        ErrorSeverity.HIGH
      );
    } finally {
      setProcessing(false);
      setAbortController(null);
    }
  }, [photos, processing, batchSize, onProcessed, onFeatureExtracted, extractFeatureWithRetry]);
  
  return (
    <div className="photo-processor">
      <div className="mb-4">
        <Button
          onClick={processPhotos}
          disabled={processing || photos.length === 0}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {processing ? '處理中...' : '處理照片'}
        </Button>
      </div>
      
      {processing && (
        <SimpleProcessingStatus 
          progress={progress}
          total={photos.length}
          processed={processedCount}
          errors={errorCount}
          onCancel={cancelProcessing}
        />
      )}
    </div>
  );
}; 