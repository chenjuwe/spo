import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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

  const getQualityColor = (score: number) => {
    if (score >= 80) return "text-photo-quality-high border-photo-quality-high bg-photo-quality-high/10";
    if (score >= 60) return "text-photo-quality-medium border-photo-quality-medium bg-photo-quality-medium/10";
    return "text-photo-quality-low border-photo-quality-low bg-photo-quality-low/10";
  };

  const getQualityIcon = (score: number) => {
    if (score >= 80) return <CheckCircle className="w-4 h-4" />;
    if (score >= 60) return <AlertTriangle className="w-4 h-4" />;
    return <Trash2 className="w-4 h-4" />;
  };

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
              {groups.map((group, index) => {
                const groupPhotos = photos.filter(p => group.photos.includes(p.id));
                const bestPhoto = groupPhotos.find(p => p.id === group.bestPhoto);
                const duplicates = groupPhotos.filter(p => p.id !== group.bestPhoto);
                
                return (
                  <Card key={group.id} className="p-4 border-l-4 border-l-primary">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">分組 {index + 1}</h4>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            相似度: {Math.round(group.averageSimilarity)}%
                          </Badge>
                          <Badge variant="secondary">
                            {group.photos.length} 張照片
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {/* 最佳照片 */}
                        {bestPhoto && (
                          <div className="relative">
                            <div className="aspect-square rounded-lg overflow-hidden border-2 border-success">
                              <img 
                                src={bestPhoto.preview} 
                                alt="最佳照片" 
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <Badge 
                              className="absolute -top-2 -right-2 bg-success text-success-foreground"
                            >
                              <Star className="w-3 h-3 mr-1" />
                              最佳
                            </Badge>
                            {bestPhoto.quality && (
                              <Badge 
                                className={`absolute -bottom-2 left-1/2 transform -translate-x-1/2 ${getQualityColor(bestPhoto.quality.score)}`}
                              >
                                {getQualityIcon(bestPhoto.quality.score)}
                                {bestPhoto.quality.score}分
                              </Badge>
                            )}
                          </div>
                        )}
                        
                        {/* 重複照片 */}
                        {duplicates.slice(0, 3).map((photo) => (
                          <div key={photo.id} className="relative opacity-60">
                            <div className="aspect-square rounded-lg overflow-hidden border-2 border-destructive">
                              <img 
                                src={photo.preview} 
                                alt="重複照片" 
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <Badge 
                              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground"
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              刪除
                            </Badge>
                            {photo.quality && (
                              <Badge 
                                className={`absolute -bottom-2 left-1/2 transform -translate-x-1/2 ${getQualityColor(photo.quality.score)}`}
                              >
                                {getQualityIcon(photo.quality.score)}
                                {photo.quality.score}分
                              </Badge>
                            )}
                          </div>
                        ))}
                        
                        {/* 更多照片指示器 */}
                        {duplicates.length > 3 && (
                          <div className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/50 flex items-center justify-center">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-muted-foreground">
                                +{duplicates.length - 3}
                              </div>
                              <div className="text-xs text-muted-foreground">更多</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* 品質分析 */}
      <Card className="p-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            照片品質分析
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 高品質照片 */}
            <div className="text-center space-y-2 p-4 rounded-lg bg-photo-quality-high/10 border border-photo-quality-high/20">
              <div className="w-12 h-12 mx-auto rounded-full bg-photo-quality-high/20 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-photo-quality-high" />
              </div>
              <div className="text-xl font-bold text-photo-quality-high">
                {photos.filter(p => p.quality && p.quality.score >= 80).length}
              </div>
              <div className="text-sm text-muted-foreground">高品質照片 (80分以上)</div>
            </div>
            
            {/* 中等品質照片 */}
            <div className="text-center space-y-2 p-4 rounded-lg bg-photo-quality-medium/10 border border-photo-quality-medium/20">
              <div className="w-12 h-12 mx-auto rounded-full bg-photo-quality-medium/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-photo-quality-medium" />
              </div>
              <div className="text-xl font-bold text-photo-quality-medium">
                {photos.filter(p => p.quality && p.quality.score >= 60 && p.quality.score < 80).length}
              </div>
              <div className="text-sm text-muted-foreground">中等品質照片 (60-79分)</div>
            </div>
            
            {/* 低品質照片 */}
            <div className="text-center space-y-2 p-4 rounded-lg bg-photo-quality-low/10 border border-photo-quality-low/20">
              <div className="w-12 h-12 mx-auto rounded-full bg-photo-quality-low/20 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-photo-quality-low" />
              </div>
              <div className="text-xl font-bold text-photo-quality-low">
                {photos.filter(p => p.quality && p.quality.score < 60).length}
              </div>
              <div className="text-sm text-muted-foreground">低品質照片 (60分以下)</div>
            </div>
          </div>
        </div>
      </Card>

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