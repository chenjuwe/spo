import React, { useEffect, useState } from 'react';
import { PhotoFile, SimilarityGroup as BasicSimilarityGroup } from "@/lib/types";
import { 
  getEnhancedSimilaritySystem, 
  EnhancedSimilarityGroup,
  EnhancedSimilarityOptions
} from '../lib/enhancedImageSimilarity';
import { FeatureLevel } from '../lib/multiLevelFeatureFusion';
import { preloadFeatureExtractor } from '../lib/deepFeatureExtractor';
import { ModelType } from '../lib/deepFeatureExtractor';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';

// 預加載深度學習模型
preloadFeatureExtractor();

interface EnhancedSimilarityViewProps {
  photos: PhotoFile[];
  onSelectPhoto?: (photo: PhotoFile) => void;
  onGroupsFound?: (groups: EnhancedSimilarityGroup[]) => void;
}

const EnhancedSimilarityView: React.FC<EnhancedSimilarityViewProps> = ({ 
  photos, 
  onSelectPhoto,
  onGroupsFound
}) => {
  // 狀態
  const [similarityGroups, setSimilarityGroups] = useState<EnhancedSimilarityGroup[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [options, setOptions] = useState<EnhancedSimilarityOptions>({
    threshold: 90,
    useDeepFeatures: true,
    enabledLevels: [FeatureLevel.LOW, FeatureLevel.MID, FeatureLevel.HIGH],
    batchSize: 20,
    maxParallelTasks: 4,
    showProgress: true
  });

  // 配置選項
  const [selectedTab, setSelectedTab] = useState('analyze');

  // 處理照片相似度分析
  const handleAnalyzePhotos = async () => {
    if (photos.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setSimilarityGroups([]);

    try {
      // 獲取相似性系統
      const similaritySystem = getEnhancedSimilaritySystem(options);

      // 設置進度更新處理程序
      const originalConsoleInfo = console.info;
      console.info = (...args: any[]) => {
        const message = args[0];
        if (typeof message === 'string' && message.includes('照片處理進度')) {
          const progressMatch = message.match(/(\d+)%/);
          if (progressMatch && progressMatch[1]) {
            setProgress(parseInt(progressMatch[1]));
          }
        }
        originalConsoleInfo(...args);
      };

      // 處理照片
      await similaritySystem.processPhotos(photos);

      // 查找相似組
      const groups = similaritySystem.findSimilarGroups();
      setSimilarityGroups(groups);

      // 調用回調
      if (onGroupsFound) {
        onGroupsFound(groups);
      }

      // 恢復 console.info
      console.info = originalConsoleInfo;
    } catch (error) {
      console.error('分析照片失敗:', error);
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  };

  // 更新選項
  const updateOptions = (newOptions: Partial<EnhancedSimilarityOptions>) => {
    setOptions(prev => ({ ...prev, ...newOptions }));
  };

  // 切換特徵級別
  const toggleFeatureLevel = (level: FeatureLevel) => {
    setOptions(prev => {
      const currentLevels = [...prev.enabledLevels];
      const index = currentLevels.indexOf(level);
      
      if (index === -1) {
        currentLevels.push(level);
      } else {
        currentLevels.splice(index, 1);
      }
      
      return { ...prev, enabledLevels: currentLevels };
    });
  };

  // 渲染相似度組
  const renderSimilarityGroups = () => {
    if (similarityGroups.length === 0) {
      return (
        <div className="p-4 text-center text-gray-500">
          {isProcessing ? '處理中...' : '沒有找到相似照片組'}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {similarityGroups.map((group, index) => (
          <Card key={index} className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">相似照片組 #{index + 1}</CardTitle>
              <div className="text-xs text-muted-foreground">
                {group.similarPhotos.length} 張相似照片
              </div>
            </CardHeader>
            <CardContent className="p-2">
              <div className="aspect-video relative overflow-hidden rounded-md mb-2">
                <img
                  src={group.keyPhoto.preview}
                  alt={`主要照片 ${group.keyPhoto.file.name}`}
                  className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onSelectPhoto && onSelectPhoto(group.keyPhoto)}
                />
                <Badge className="absolute top-2 right-2 bg-blue-500">主照片</Badge>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {group.similarPhotos.slice(0, 6).map((item, photoIndex) => (
                  <div
                    key={photoIndex}
                    className="aspect-square relative overflow-hidden rounded-sm"
                  >
                    <img
                      src={item.photo.preview}
                      alt={`相似照片 ${item.photo.file.name}`}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => onSelectPhoto && onSelectPhoto(item.photo)}
                    />
                    <div className="absolute bottom-0 right-0 bg-black bg-opacity-70 text-white text-xs px-1 rounded-tl-sm">
                      {item.similarity}%
                    </div>
                    <div className="absolute top-0 left-0 bg-black bg-opacity-70 text-white text-xs px-1 rounded-br-sm">
                      {item.method === 'combined' ? '融合' : 
                       item.method === 'hash' ? '哈希' :
                       item.method === 'feature' ? '特徵' :
                       item.method === 'deep_learning' ? '深度' : 
                       item.method}
                    </div>
                  </div>
                ))}
                {group.similarPhotos.length > 6 && (
                  <div className="aspect-square bg-muted flex items-center justify-center rounded-sm">
                    <span className="text-sm">+{group.similarPhotos.length - 6}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
        <TabsList className="grid grid-cols-2 mb-4">
          <TabsTrigger value="analyze">分析照片</TabsTrigger>
          <TabsTrigger value="settings">進階設定</TabsTrigger>
        </TabsList>

        <TabsContent value="analyze" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">增強相似度分析</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2 mb-4">
                <Button onClick={handleAnalyzePhotos} disabled={isProcessing || photos.length === 0}>
                  {isProcessing ? '處理中...' : '分析照片相似度'}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {photos.length} 張照片 | 閾值: {options.threshold}% | 
                  使用深度特徵: {options.useDeepFeatures ? '是' : '否'}
                </span>
              </div>

              {isProcessing && (
                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${progress}%` }}>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-4">
                <Badge 
                  variant={options.enabledLevels.includes(FeatureLevel.LOW) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFeatureLevel(FeatureLevel.LOW)}
                >
                  低級特徵 (哈希)
                </Badge>
                <Badge 
                  variant={options.enabledLevels.includes(FeatureLevel.MID) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFeatureLevel(FeatureLevel.MID)}
                >
                  中級特徵 (顏色/紋理)
                </Badge>
                <Badge 
                  variant={options.enabledLevels.includes(FeatureLevel.HIGH) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFeatureLevel(FeatureLevel.HIGH)}
                >
                  高級特徵 (深度學習)
                </Badge>
              </div>

              <div className="flex items-center space-x-4">
                <span className="text-sm">相似度閾值: {options.threshold}%</span>
                <Slider
                  min={50}
                  max={100}
                  step={1}
                  value={[options.threshold]}
                  onValueChange={(values) => updateOptions({ threshold: values[0] })}
                  className="w-48"
                />
              </div>
            </CardContent>
          </Card>

          <div className="py-2">
            {renderSimilarityGroups()}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">深度學習設定</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">啟用深度學習特徵</p>
                  <p className="text-sm text-muted-foreground">使用 MobileNet V2 提取圖像高級特徵</p>
                </div>
                <Switch
                  checked={options.useDeepFeatures}
                  onCheckedChange={(checked) => updateOptions({ useDeepFeatures: checked })}
                />
              </div>
              
              <Separator />
              
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">性能優化設定</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">批處理大小</span>
                    <Slider
                      min={5}
                      max={50}
                      step={5}
                      value={[options.batchSize || 20]}
                      onValueChange={(values) => updateOptions({ batchSize: values[0] })}
                      className="w-48"
                    />
                    <span className="text-sm w-8 text-right">{options.batchSize || 20}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">並行任務數</span>
                  <Slider
                    min={1}
                    max={8}
                    step={1}
                    value={[options.maxParallelTasks || 4]}
                    onValueChange={(values) => updateOptions({ maxParallelTasks: values[0] })}
                    className="w-48"
                  />
                  <span className="text-sm w-8 text-right">{options.maxParallelTasks || 4}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">特徵融合設定</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm font-medium mb-2">低級特徵權重</p>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[30]}
                    className="w-full"
                  />
                  <p className="text-xs text-center mt-1">30%</p>
                </div>
                
                <div>
                  <p className="text-sm font-medium mb-2">中級特徵權重</p>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[30]}
                    className="w-full"
                  />
                  <p className="text-xs text-center mt-1">30%</p>
                </div>
                
                <div>
                  <p className="text-sm font-medium mb-2">高級特徵權重</p>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[40]}
                    className="w-full"
                  />
                  <p className="text-xs text-center mt-1">40%</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">自適應權重</p>
                  <p className="text-sm text-muted-foreground">根據可用特徵動態調整權重</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EnhancedSimilarityView; 