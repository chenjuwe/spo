import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Star, Eye, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

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
}

interface PhotoGridProps {
  photos: PhotoFile[];
  onPhotosChange: (photos: PhotoFile[]) => void;
}

// 虛擬化照片網格組件
const PhotoGrid = ({ photos, onPhotosChange }: PhotoGridProps) => {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 40 });
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollingRef = useRef<boolean>(false);
  const isMobile = useIsMobile();
  
  // 計算網格佈局參數
  const gridParams = useMemo(() => {
    // 根據螢幕大小計算每行顯示的照片數量
    const getColumnsPerRow = () => {
      if (isMobile) return 2;
      
      const width = window.innerWidth;
      if (width >= 1280) return 5; // xl
      if (width >= 1024) return 4; // lg
      if (width >= 768) return 3; // md
      return 2; // sm
    };
    
    const columnsPerRow = getColumnsPerRow();
    const photoHeight = 320; // 照片卡片估計高度 (像素)
    const itemsPerPage = columnsPerRow * 3; // 每頁顯示3行
    const overscan = columnsPerRow * 2; // 上下多渲染2行以便平滑滾動
    
    return {
      columnsPerRow,
      photoHeight,
      itemsPerPage,
      overscan
    };
  }, [isMobile]);
  
  // 處理滾動更新可見範圍
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !photos.length) return;
    
    // 防止過度觸發
    if (scrollingRef.current) return;
    scrollingRef.current = true;
    
    // 使用 requestAnimationFrame 減少性能影響
    requestAnimationFrame(() => {
      if (!containerRef.current) {
        scrollingRef.current = false;
        return;
      }
      
      const container = containerRef.current;
      const { top: containerTop } = container.getBoundingClientRect();
      const scrollTop = window.scrollY + containerTop * -1;
      
      const { photoHeight, itemsPerPage, overscan, columnsPerRow } = gridParams;
      
      // 計算可見照片的範圍
      const rowHeight = photoHeight;
      const visibleTop = Math.floor(scrollTop / rowHeight) * columnsPerRow;
      const visibleItems = itemsPerPage;
      
      let start = Math.max(0, visibleTop - overscan);
      let end = Math.min(photos.length, visibleTop + visibleItems + overscan);
      
      // 確保至少渲染一頁
      if (end - start < itemsPerPage) {
        end = Math.min(photos.length, start + itemsPerPage);
      }
      
      // 當視口範圍變化時更新
      if (visibleRange.start !== start || visibleRange.end !== end) {
        setVisibleRange({ start, end });
      }
      
      scrollingRef.current = false;
    });
  }, [photos.length, visibleRange, gridParams]);
  
  // 初始化和視窗大小變化時的監聽
  useEffect(() => {
    handleScroll(); // 初始計算
    
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [handleScroll]);
  
  // 照片數量變化時重新計算
  useEffect(() => {
    handleScroll();
  }, [photos.length, handleScroll]);

  const handleRemovePhoto = (id: string) => {
    const photoToRemove = photos.find(p => p.id === id);
    if (photoToRemove) {
      URL.revokeObjectURL(photoToRemove.preview);
    }
    onPhotosChange(photos.filter(p => p.id !== id));
  };

  const handleToggleSelect = (id: string) => {
    onPhotosChange(
      photos.map(photo =>
        photo.id === id
          ? { ...photo, isSelected: !photo.isSelected }
          : photo
      )
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  // 僅渲染當前可見範圍的照片
  const visiblePhotos = useMemo(() => {
    return photos.slice(visibleRange.start, visibleRange.end);
  }, [photos, visibleRange]);
  
  // 計算網格的總高度，以保持滾動條正確
  const gridHeight = useMemo(() => {
    const { columnsPerRow, photoHeight } = gridParams;
    const rows = Math.ceil(photos.length / columnsPerRow);
    return rows * photoHeight;
  }, [photos.length, gridParams]);
  
  // 計算每個照片的位置偏移
  const getPhotoOffset = useCallback((index: number) => {
    const { columnsPerRow, photoHeight } = gridParams;
    const row = Math.floor((index + visibleRange.start) / columnsPerRow);
    return row * photoHeight;
  }, [gridParams, visibleRange.start]);
  
  // 懶加載圖片處理
  const lazyLoadImage = useCallback((src: string) => {
    return new Promise<HTMLImageElement>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = src;
    });
  }, []);
  
  // 預加載下一批圖片
  useEffect(() => {
    const preloadCount = 10; // 預加載的照片數量
    const nextIndex = visibleRange.end;
    
    if (nextIndex < photos.length) {
      const preloadBatch = photos.slice(nextIndex, nextIndex + preloadCount);
      
      preloadBatch.forEach(photo => {
        if (photo.preview) {
          lazyLoadImage(photo.preview).catch(() => {
            // 忽略加載錯誤
          });
        }
      });
    }
  }, [visibleRange, photos, lazyLoadImage]);

  return (
    <div className="space-y-4" ref={containerRef}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">已載入的照片</h2>
        <div className="text-sm text-muted-foreground">
          {photos.filter(p => p.isSelected).length} / {photos.length} 張已選取
        </div>
      </div>

      {/* 使用虛擬化滾動的照片網格 */}
      <div 
        style={{ 
          height: `${gridHeight}px`, 
          position: 'relative' 
        }} 
        className="grid-container"
      >
        <div 
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 absolute top-0 left-0 right-0"
          style={{
            transform: `translateY(${getPhotoOffset(0)}px)`
          }}
        >
          {visiblePhotos.map((photo, index) => (
            <Card
              key={photo.id}
              className={`
                relative overflow-hidden transition-all duration-200 hover:shadow-photo group
                ${photo.isSelected ? 'ring-2 ring-primary' : ''}
                ${selectedPhoto === photo.id ? 'ring-2 ring-primary shadow-elevation' : ''}
              `}
              data-index={visibleRange.start + index}
            >
              {/* Photo */}
              <div className="aspect-square relative bg-photo-bg">
                <img
                  loading="lazy"
                  src={photo.preview}
                  alt={photo.file.name}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setSelectedPhoto(selectedPhoto === photo.id ? null : photo.id)}
                />
                
                {/* Overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                
                {/* Selection Checkbox */}
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Checkbox
                    checked={photo.isSelected || false}
                    onCheckedChange={() => handleToggleSelect(photo.id)}
                    className="bg-white shadow-md"
                  />
                </div>

                {/* Remove Button */}
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemovePhoto(photo.id)}
                >
                  <X className="w-3 h-3" />
                </Button>

                {/* Quality Indicators */}
                {photo.similarity && (
                  <div className="absolute bottom-2 right-2">
                    <Badge variant={photo.similarity > 95 ? "default" : "secondary"} className="text-xs">
                      <Star className="w-3 h-3 mr-1" />
                      {photo.similarity}%
                    </Badge>
                  </div>
                )}

                {/* View Button */}
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute bottom-2 left-2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setSelectedPhoto(selectedPhoto === photo.id ? null : photo.id)}
                >
                  <Eye className="w-3 h-3" />
                </Button>
              </div>

              {/* Photo Info */}
              <div className="p-3 space-y-2">
                <h4 className="font-medium text-sm truncate" title={photo.file.name}>
                  {photo.file.name}
                </h4>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatFileSize(photo.file.size)}</span>
                  {photo.group && (
                    <Badge variant="outline" className="text-xs">
                      群組 {photo.group}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Loading Indicator */}
      {photos.length > visibleRange.end && (
        <div className="flex justify-center p-4">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {/* Selected Photo Preview */}
      {selectedPhoto && (
        <Card className="p-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">照片預覽</h3>
            {(() => {
              const photo = photos.find(p => p.id === selectedPhoto);
              if (!photo) return null;
              
              return (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <img
                      src={photo.preview}
                      alt={photo.file.name}
                      className="w-full rounded-lg shadow-photo"
                    />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">檔案資訊</h4>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">檔案名稱:</dt>
                          <dd className="font-medium">{photo.file.name}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">檔案大小:</dt>
                          <dd>{formatFileSize(photo.file.size)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">檔案類型:</dt>
                          <dd>{photo.file.type}</dd>
                        </div>
                        {photo.similarity && (
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">品質分數:</dt>
                            <dd>
                              <Badge variant={photo.similarity > 95 ? "default" : "secondary"}>
                                {photo.similarity}%
                              </Badge>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedPhoto(null)}
                      className="w-full"
                    >
                      關閉預覽
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>
      )}
    </div>
  );
};

export default PhotoGrid;