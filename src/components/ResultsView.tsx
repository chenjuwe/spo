import { lazy, Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Download, 
  Image, 
  Trash2, 
  Star, 
  BarChart3, 
  FolderOpen,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import { PhotoFile, SimilarityGroup } from "@/lib/types";

// 懶加載較重的元件
const SimilarityGroupCard = lazy(() => import('./SimilarityGroupCard'));
const PhotoQualityAnalysis = lazy(() => import('./PhotoQualityAnalysis'));

interface ResultsViewProps {
  photos: PhotoFile[];
  groups: SimilarityGroup[];
  onDownload: () => void;
  onBack: () => void;
}

const ResultsView = ({ photos, groups, onDownload, onBack }: ResultsViewProps) => {
  const totalPhotos = photos.length;
  const duplicatePhotos = groups.reduce((sum, group) => sum + group.photos.length - 1, 0);
  const keptPhotos = totalPhotos - duplicatePhotos;
  const spaceSaved = duplicatePhotos > 0 ? Math.round((duplicatePhotos / totalPhotos) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 統計摘要 */}
      <Card className="p-6 bg-gradient-subtle">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-primary">整理完成！</h2>
          <p className="text-muted-foreground">照片分析和整理已完成，以下是詳細結果</p>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <Image className="w-6 h-6 text-primary" />
              </div>
              <div className="text-2xl font-bold">{totalPhotos}</div>
              <div className="text-sm text-muted-foreground">總照片數</div>
            </div>
            
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <div className="text-2xl font-bold text-success">{keptPhotos}</div>
              <div className="text-sm text-muted-foreground">保留照片</div>
            </div>
            
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-warning/10 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-warning" />
              </div>
              <div className="text-2xl font-bold text-warning">{duplicatePhotos}</div>
              <div className="text-sm text-muted-foreground">重複照片</div>
            </div>
            
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-photo-quality-high/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-photo-quality-high" />
              </div>
              <div className="text-2xl font-bold text-photo-quality-high">{spaceSaved}%</div>
              <div className="text-sm text-muted-foreground">空間節省</div>
            </div>
          </div>
        </div>
      </Card>

      {/* 重複照片分組 */}
      {groups.length > 0 && (
        <Suspense fallback={
          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-44" />
                <Skeleton className="h-6 w-24" />
              </div>
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <Card key={i} className="p-4 border-l-4 border-l-primary">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-24" />
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-6 w-28" />
                          <Skeleton className="h-6 w-24" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map((j) => (
                          <Skeleton key={j} className="aspect-square rounded-lg" />
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </Card>
        }>
          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <FolderOpen className="w-5 h-5" />
                  發現的重複照片分組
                </h3>
                <Badge variant="secondary">{groups.length} 個分組</Badge>
              </div>
              
              <div className="space-y-4">
                {groups.map((group) => (
                  <SimilarityGroupCard 
                    key={group.id}
                    group={group}
                    photos={photos}
                  />
                ))}
              </div>
            </div>
          </Card>
        </Suspense>
      )}

      {/* 品質分析 */}
      <Suspense fallback={
        <Card className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-6 w-36" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          </div>
        </Card>
      }>
        <PhotoQualityAnalysis photos={photos} />
      </Suspense>

      {/* 行動按鈕 */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="font-semibold">下載整理後的照片</h3>
            <p className="text-sm text-muted-foreground">
              下載包含最佳照片和刪除清單的完整檔案包
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onBack}>
              返回編輯
            </Button>
            <Button onClick={onDownload} size="lg" className="px-8">
              <Download className="w-4 h-4 mr-2" />
              下載結果
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ResultsView;