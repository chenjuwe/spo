import React, { useState, useCallback, useEffect } from 'react';
import { PhotoFile } from '../lib/types';
import { MultiLevelFeature, FeatureLevel } from '../lib/multiLevelFeatureFusion';
import { featureManager } from '../lib/featureManager';
import { validatePhotoBatch, ValidationErrorType } from '../lib/inputValidator';
import { handleError } from '../lib/utils';
import { ErrorType } from '../lib/errorHandlingService';
import { unwrapAsync, unwrapOrAsync } from '../lib/result';
import { Button } from './ui/button';

// 更新 ProcessingStatus 組件的 Props 接口
interface ProcessingStatusProps {
  progress: number;
  total: number;
  processed: number;
  errors: number;
}

// 簡化的 ProcessingStatus 組件
export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({
  progress,
  total,
  processed,
  errors
}) => {
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
    </div>
  );
};

interface PhotoProcessorProps {
  photos: PhotoFile[];
  onProcessed: (processedPhotos: PhotoFile[]) => void;
  onFeatureExtracted: (features: Record<string, MultiLevelFeature>) => void;
}

export const PhotoProcessor: React.FC<PhotoProcessorProps> = ({
  photos,
  onProcessed,
  onFeatureExtracted
}) => {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [features, setFeatures] = useState<Record<string, MultiLevelFeature>>({});
  
  // 初始化特徵管理器
  useEffect(() => {
    const initManager = async () => {
      try {
        await unwrapAsync(featureManager.initialize());
        console.info('特徵管理器初始化成功');
      } catch (error) {
        handleError(
          error,
          ErrorType.SYSTEM_ERROR,
          '特徵管理器初始化失敗',
          false
        );
      }
    };
    
    initManager();
    
    // 組件卸載時釋放資源
    return () => {
      featureManager.dispose();
    };
  }, []);
  
  const processPhotos = useCallback(async () => {
    if (photos.length === 0 || processing) return;
    
    setProcessing(true);
    setProgress(0);
    setProcessedCount(0);
    setErrorCount(0);
    
    try {
      // 驗證照片
      const { validPhotos, errors } = validatePhotoBatch(photos);
      
      if (errors.length > 0) {
        console.warn(`${errors.length} 個照片驗證失敗`);
        errors.forEach(({ photo, error }) => {
          console.warn(
            `照片 ${photo.id} 驗證失敗: ${error.message}`,
            error.details
          );
        });
        
        setErrorCount(errors.length);
      }
      
      if (validPhotos.length === 0) {
        handleError(
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
      
      // 按批次處理照片，避免阻塞 UI
      const batchSize = 5;
      
      for (let i = 0; i < totalPhotos; i += batchSize) {
        const batch = validPhotos.slice(i, i + batchSize);
        
        // 並行處理批次中的照片
        const batchPromises = batch.map(async (photo) => {
          try {
            // 提取特徵 (使用多級別特徵融合)
            const lowFeatureResult = await featureManager.extractAndCacheFeature(
              photo,
              FeatureLevel.LOW
            );
            
            const midFeatureResult = await featureManager.extractAndCacheFeature(
              photo,
              FeatureLevel.MID
            );
            
            let highFeature: MultiLevelFeature | null = null;
            
            // 僅在需要時提取高級特徵 (深度學習)
            if (totalPhotos <= 100) {
              highFeature = await unwrapOrAsync(
                featureManager.extractAndCacheFeature(photo, FeatureLevel.HIGH),
                null
              );
            }
            
            // 合併特徵
            const lowFeature = await unwrapOrAsync(lowFeatureResult, null);
            const midFeature = await unwrapOrAsync(midFeatureResult, null);
            
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
            return photo;
          } catch (error) {
            console.error(`處理照片 ${photo.id} 時發生錯誤:`, error);
            setErrorCount(prev => prev + 1);
            return null;
          }
        });
        
        // 等待批次完成
        const processedBatch = (await Promise.all(batchPromises)).filter(Boolean) as PhotoFile[];
        setProcessedCount(prev => prev + processedBatch.length);
        setProgress(Math.round(((i + batch.length) / totalPhotos) * 100));
        
        // 小暫停，讓 UI 有機會更新
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // 完成處理
      setFeatures(newFeatures);
      onFeatureExtracted(newFeatures);
      onProcessed(validPhotos.filter(photo => newFeatures[photo.id]));
    } catch (error) {
      handleError(
        error,
        ErrorType.SYSTEM_ERROR,
        '處理照片時發生錯誤',
        true
      );
    } finally {
      setProcessing(false);
      setProgress(100);
    }
  }, [photos, processing, onProcessed, onFeatureExtracted]);
  
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
        <ProcessingStatus 
          progress={progress}
          total={photos.length}
          processed={processedCount}
          errors={errorCount}
        />
      )}
    </div>
  );
}; 