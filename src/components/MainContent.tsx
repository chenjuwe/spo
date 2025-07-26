import React, { Suspense, lazy, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PhotoFile, SimilarityGroup } from "@/lib/types";
import { EnhancedSimilarityGroup } from "@/lib/enhancedImageSimilarity";

// 懶加載元件
const PhotoGrid = lazy(() => import("./PhotoGrid"));
const PhotoProcessor = lazy(() => import("./PhotoProcessor"));
const ResultsView = lazy(() => import("./ResultsView"));
const PhotoUploader = lazy(() => import("./PhotoUploader"));
const EnhancedSimilarityView = lazy(() => import("./EnhancedSimilarityView"));

// 懶加載外殼組件
const LazyComponent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="p-4 text-center">載入中...</div>}>
    {children}
  </Suspense>
);

interface MainContentProps {
  showResults: boolean;
  photos: PhotoFile[];
  setPhotos: React.Dispatch<React.SetStateAction<PhotoFile[]>>;
  similarityGroups: SimilarityGroup[];
  similarityThreshold: number;
  setShowResults: React.Dispatch<React.SetStateAction<boolean>>;
  handleProcessingComplete: (processedPhotos: PhotoFile[], groups: SimilarityGroup[]) => void;
}

/**
 * 主要內容區域元件
 * 根據當前狀態顯示照片上傳、處理或結果頁面
 */
const MainContent: React.FC<MainContentProps> = ({
  showResults,
  photos,
  setPhotos,
  similarityGroups,
  similarityThreshold,
  setShowResults,
  handleProcessingComplete
}) => {
  const [activeResultTab, setActiveResultTab] = useState<string>("standard");
  const [enhancedGroups, setEnhancedGroups] = useState<EnhancedSimilarityGroup[]>([]);

  // 照片上傳處理
  const handlePhotosAdded = (newPhotos: PhotoFile[]) => {
    setPhotos(prev => [...prev, ...newPhotos]);
  };

  // 處理增強相似度分析完成
  const handleEnhancedGroupsFound = (groups: EnhancedSimilarityGroup[]) => {
    setEnhancedGroups(groups);
  };

  return (
    <Card className="p-6">
      {!showResults ? (
        <div className="space-y-6">
          <LazyComponent>
            <PhotoUploader onPhotosAdded={handlePhotosAdded} />
          </LazyComponent>
          
          {photos.length > 0 && (
            <>
              <LazyComponent>
                <PhotoGrid photos={photos} onPhotosChange={setPhotos} />
              </LazyComponent>
              
              <LazyComponent>
                <PhotoProcessor 
                  photos={photos}
                  similarityThreshold={similarityThreshold}
                  onProcessingComplete={handleProcessingComplete}
                />
              </LazyComponent>
            </>
          )}
        </div>
      ) : (
        <LazyComponent>
          <Tabs value={activeResultTab} onValueChange={setActiveResultTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="standard">標準分析</TabsTrigger>
              <TabsTrigger value="enhanced">增強分析</TabsTrigger>
            </TabsList>
            
            <TabsContent value="standard">
              <ResultsView
                photos={photos}
                groups={similarityGroups}
                onDownload={() => console.log("下載結果")}
                onBack={() => setShowResults(false)}
              />
            </TabsContent>
            
            <TabsContent value="enhanced">
              <EnhancedSimilarityView 
                photos={photos}
                onGroupsFound={handleEnhancedGroupsFound}
                onSelectPhoto={(photo) => console.log("選擇照片", photo.id)}
              />
              <div className="mt-4 flex justify-end">
                <button 
                  className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
                  onClick={() => setShowResults(false)}
                >
                  返回編輯
                </button>
              </div>
            </TabsContent>
          </Tabs>
        </LazyComponent>
      )}
    </Card>
  );
};

export default MainContent; 