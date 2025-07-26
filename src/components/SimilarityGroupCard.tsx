import React from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, Trash2, CheckCircle, AlertTriangle } from "lucide-react";
import { PhotoFile, SimilarityGroup } from "@/lib/types";

interface SimilarityGroupCardProps {
  group: SimilarityGroup;
  photos: PhotoFile[];
}

const SimilarityGroupCard: React.FC<SimilarityGroupCardProps> = ({ group, photos }) => {
  // 找出分組中的照片
  const groupPhotos = photos.filter(p => group.photos.includes(p.id));
  // 找出最佳照片
  const bestPhoto = groupPhotos.find(p => p.id === group.bestPhoto);
  // 找出重複照片
  const duplicates = groupPhotos.filter(p => p.id !== group.bestPhoto);

  // 照片品質樣式
  const getQualityColor = (score: number) => {
    if (score >= 80) return "text-photo-quality-high border-photo-quality-high bg-photo-quality-high/10";
    if (score >= 60) return "text-photo-quality-medium border-photo-quality-medium bg-photo-quality-medium/10";
    return "text-photo-quality-low border-photo-quality-low bg-photo-quality-low/10";
  };

  // 照片品質圖標
  const getQualityIcon = (score: number) => {
    if (score >= 80) return <CheckCircle className="w-4 h-4" />;
    if (score >= 60) return <AlertTriangle className="w-4 h-4" />;
    return <Trash2 className="w-4 h-4" />;
  };

  return (
    <Card className="p-4 border-l-4 border-l-primary">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">分組 {group.id.substr(-4)}</h4>
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
                  loading="lazy"
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
                  loading="lazy"
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
};

export default SimilarityGroupCard; 