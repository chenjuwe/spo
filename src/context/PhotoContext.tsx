import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { ErrorType, errorHandler } from '@/lib/errorHandlingService';

// 照片文件介面
export interface PhotoFile {
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
}

// 處理狀態介面
export interface ProcessingStatus {
  isProcessing: boolean;
  progress: number;
  step: string;
  totalSteps: number;
  processingPhase: 'uploading' | 'analyzing' | 'organizing' | 'finalizing' | 'idle';
}

// 照片上下文介面
interface PhotoContextType {
  // 照片數據
  photos: PhotoFile[];
  setPhotos: React.Dispatch<React.SetStateAction<PhotoFile[]>>;
  selectedPhotos: PhotoFile[];
  
  // 照片操作
  addPhotos: (newPhotos: File[]) => Promise<void>;
  removePhoto: (id: string) => void;
  selectPhoto: (id: string, selected?: boolean) => void;
  selectAll: (selected?: boolean) => void;
  clearPhotos: () => void;
  
  // 處理狀態
  processingStatus: ProcessingStatus;
  setProcessingStatus: React.Dispatch<React.SetStateAction<ProcessingStatus>>;
  isProcessing: boolean;
  
  // 結果管理
  duplicateGroups: Record<string, PhotoFile[]>;
  setDuplicateGroups: React.Dispatch<React.SetStateAction<Record<string, PhotoFile[]>>>;
  showResults: boolean;
  setShowResults: React.Dispatch<React.SetStateAction<boolean>>;
}

// 創建 Context
const PhotoContext = createContext<PhotoContextType | undefined>(undefined);

// Provider 組件
export const PhotoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 照片狀態
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  
  // 處理狀態
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    progress: 0,
    step: '',
    totalSteps: 0,
    processingPhase: 'idle'
  });
  
  // 結果狀態
  const [duplicateGroups, setDuplicateGroups] = useState<Record<string, PhotoFile[]>>({});
  const [showResults, setShowResults] = useState<boolean>(false);
  
  // 計算選中的照片
  const selectedPhotos = useMemo(() => {
    return photos.filter(photo => photo.isSelected);
  }, [photos]);
  
  // 添加照片
  const addPhotos = useCallback(async (newFiles: File[]) => {
    try {
      // 過濾掉非圖像文件
      const validImageFiles = newFiles.filter(file => 
        file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.heic')
      );
      
      if (validImageFiles.length === 0) {
        errorHandler.handleError(
          '沒有找到有效的圖像文件',
          ErrorType.FILE_TYPE_ERROR,
          '支援的格式：JPEG、PNG、GIF、WebP、HEIC',
          false
        );
        return;
      }
      
      // 生成預覽和ID
      const newPhotos: PhotoFile[] = await Promise.all(
        validImageFiles.map(async (file) => {
          const id = Math.random().toString(36).substring(2, 11);
          const preview = URL.createObjectURL(file);
          
          return {
            file,
            preview,
            id,
            isSelected: false
          };
        })
      );
      
      // 更新照片列表
      setPhotos(prev => [...prev, ...newPhotos]);
      
    } catch (error) {
      errorHandler.handleError(
        error as Error,
        ErrorType.PHOTO_LOADING_ERROR,
        '載入照片時發生錯誤',
        true,
        () => addPhotos(newFiles)
      );
    }
  }, []);
  
  // 移除照片
  const removePhoto = useCallback((id: string) => {
    setPhotos(prev => {
      const photoToRemove = prev.find(p => p.id === id);
      if (photoToRemove && photoToRemove.preview && !photoToRemove.preview.startsWith('data:')) {
        try {
          URL.revokeObjectURL(photoToRemove.preview);
        } catch (error) {
          console.warn('釋放資源失敗:', error);
        }
      }
      return prev.filter(p => p.id !== id);
    });
  }, []);
  
  // 選擇照片
  const selectPhoto = useCallback((id: string, selected?: boolean) => {
    setPhotos(prev => 
      prev.map(photo => 
        photo.id === id 
          ? { ...photo, isSelected: selected !== undefined ? selected : !photo.isSelected } 
          : photo
      )
    );
  }, []);
  
  // 全選/取消全選
  const selectAll = useCallback((selected: boolean = true) => {
    setPhotos(prev => 
      prev.map(photo => ({ ...photo, isSelected: selected }))
    );
  }, []);
  
  // 清空照片
  const clearPhotos = useCallback(() => {
    // 釋放所有 preview URL
    photos.forEach(photo => {
      if (photo.preview && !photo.preview.startsWith('data:')) {
        try {
          URL.revokeObjectURL(photo.preview);
        } catch (error) {
          console.warn('釋放資源失敗:', error);
        }
      }
    });
    
    // 清空照片陣列
    setPhotos([]);
    setDuplicateGroups({});
    setShowResults(false);
    
    // 重置處理狀態
    setProcessingStatus({
      isProcessing: false,
      progress: 0,
      step: '',
      totalSteps: 0,
      processingPhase: 'idle'
    });
  }, [photos]);
  
  // 監聽記憶體使用，釋放資源
  React.useEffect(() => {
    // 元件卸載時釋放所有 preview URL
    return () => {
      photos.forEach(photo => {
        if (photo.preview && !photo.preview.startsWith('data:')) {
          try {
            URL.revokeObjectURL(photo.preview);
          } catch (error) {
            console.warn('釋放資源失敗:', error);
          }
        }
      });
    };
  }, [photos]);
  
  const value = useMemo(() => ({
    photos,
    setPhotos,
    selectedPhotos,
    addPhotos,
    removePhoto,
    selectPhoto,
    selectAll,
    clearPhotos,
    processingStatus,
    setProcessingStatus,
    isProcessing: processingStatus.isProcessing,
    duplicateGroups,
    setDuplicateGroups,
    showResults,
    setShowResults
  }), [
    photos, 
    selectedPhotos, 
    addPhotos, 
    removePhoto, 
    selectPhoto, 
    selectAll, 
    clearPhotos,
    processingStatus,
    duplicateGroups,
    showResults
  ]);
  
  return (
    <PhotoContext.Provider value={value}>
      {children}
    </PhotoContext.Provider>
  );
};

// 自定義 Hook
export const usePhotoContext = () => {
  const context = useContext(PhotoContext);
  
  if (context === undefined) {
    throw new Error('usePhotoContext 必須在 PhotoProvider 內部使用');
  }
  
  return context;
};

// 導出更具體的 Hook
export const usePhotos = () => {
  const { photos, setPhotos, addPhotos, removePhoto, selectPhoto, selectAll, clearPhotos, selectedPhotos } = usePhotoContext();
  return { photos, setPhotos, addPhotos, removePhoto, selectPhoto, selectAll, clearPhotos, selectedPhotos };
};

export const useProcessing = () => {
  const { processingStatus, setProcessingStatus, isProcessing } = usePhotoContext();
  return { processingStatus, setProcessingStatus, isProcessing };
};

export const useResults = () => {
  const { duplicateGroups, setDuplicateGroups, showResults, setShowResults } = usePhotoContext();
  return { duplicateGroups, setDuplicateGroups, showResults, setShowResults };
}; 