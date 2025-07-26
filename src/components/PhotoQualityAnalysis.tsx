import React from 'react';
import { Card } from "@/components/ui/card";
import { BarChart3, CheckCircle, AlertTriangle, Trash2 } from "lucide-react";
import { PhotoFile } from "@/lib/types";

interface PhotoQualityAnalysisProps {
  photos: PhotoFile[];
}

const PhotoQualityAnalysis: React.FC<PhotoQualityAnalysisProps> = ({ photos }) => {
  // 計算各品質等級的照片數量
  const highQualityCount = photos.filter(p => p.quality && p.quality.score >= 80).length;
  const mediumQualityCount = photos.filter(p => p.quality && p.quality.score >= 60 && p.quality.score < 80).length;
  const lowQualityCount = photos.filter(p => p.quality && p.quality.score < 60).length;

  return (
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
              {highQualityCount}
            </div>
            <div className="text-sm text-muted-foreground">高品質照片 (80分以上)</div>
          </div>
          
          {/* 中等品質照片 */}
          <div className="text-center space-y-2 p-4 rounded-lg bg-photo-quality-medium/10 border border-photo-quality-medium/20">
            <div className="w-12 h-12 mx-auto rounded-full bg-photo-quality-medium/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-photo-quality-medium" />
            </div>
            <div className="text-xl font-bold text-photo-quality-medium">
              {mediumQualityCount}
            </div>
            <div className="text-sm text-muted-foreground">中等品質照片 (60-79分)</div>
          </div>
          
          {/* 低品質照片 */}
          <div className="text-center space-y-2 p-4 rounded-lg bg-photo-quality-low/10 border border-photo-quality-low/20">
            <div className="w-12 h-12 mx-auto rounded-full bg-photo-quality-low/20 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-photo-quality-low" />
            </div>
            <div className="text-xl font-bold text-photo-quality-low">
              {lowQualityCount}
            </div>
            <div className="text-sm text-muted-foreground">低品質照片 (60分以下)</div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default PhotoQualityAnalysis; 