import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { X, Settings, Sliders } from "lucide-react";

interface SettingsPanelProps {
  similarityThreshold: number;
  onSimilarityThresholdChange: (value: number) => void;
  onClose: () => void;
  settings?: {
    autoRename: boolean;
    preserveOriginal: boolean;
    optimizeQuality: boolean;
    maxDimension: number;
  };
  onSettingsChange?: (settings: {
    autoRename: boolean;
    preserveOriginal: boolean;
    optimizeQuality: boolean;
    maxDimension: number;
  }) => void;
}

const SettingsPanel = (props: SettingsPanelProps) => {
  return (
    <Card className="p-6 bg-gradient-subtle border-l-4 border-l-primary">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">處理設定</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Similarity Threshold */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center space-x-2">
              <Sliders className="w-4 h-4" />
              <span>相似度門檻</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              設定多相似的照片會被視為重複（值越高表示越嚴格）
            </p>
          </div>
          
          <div className="space-y-3">
            <Slider
              value={[props.similarityThreshold]}
              onValueChange={(value) => props.onSimilarityThresholdChange(value[0])}
              max={100}
              min={50}
              step={1}
              className="w-full"
            />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>50% (較寬鬆)</span>
              <span className="font-medium text-primary">{props.similarityThreshold}%</span>
              <span>100% (非常嚴格)</span>
            </div>
          </div>

          {/* Threshold Guide */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className={`p-2 rounded text-center ${props.similarityThreshold <= 70 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              50-70%<br />寬鬆模式
            </div>
            <div className={`p-2 rounded text-center ${props.similarityThreshold > 70 && props.similarityThreshold <= 90 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              70-90%<br />標準模式
            </div>
            <div className={`p-2 rounded text-center ${props.similarityThreshold > 90 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              90-100%<br />嚴格模式
            </div>
          </div>
        </div>

        {/* Additional Settings */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="font-medium text-sm">進階選項</h4>
          
          <div className="space-y-4">
            {/* Auto Rename */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm">自動重新命名</Label>
                <p className="text-xs text-muted-foreground">
                  使用標準化格式重新命名檔案
                </p>
              </div>
              <Switch 
                checked={props.settings?.autoRename}
                onCheckedChange={(checked) => 
                  props.onSettingsChange?.({ ...props.settings, autoRename: checked })
                }
              />
            </div>

            {/* Preserve Original */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm">保留原始檔案</Label>
                <p className="text-xs text-muted-foreground">
                  在刪除前備份原始檔案到安全位置
                </p>
              </div>
              <Switch 
                checked={props.settings?.preserveOriginal}
                onCheckedChange={(checked) => 
                  props.onSettingsChange?.({ ...props.settings, preserveOriginal: checked })
                }
              />
            </div>

            {/* Quality Optimization */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm">自動品質優化</Label>
                <p className="text-xs text-muted-foreground">
                  自動調整亮度、對比度和銳化
                </p>
              </div>
              <Switch 
                checked={props.settings?.optimizeQuality}
                onCheckedChange={(checked) => 
                  props.onSettingsChange?.({ ...props.settings, optimizeQuality: checked })
                }
              />
            </div>

            {/* Max Dimension */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-sm">最大尺寸限制</Label>
                <p className="text-xs text-muted-foreground">
                  調整照片最長邊的像素大小（保持比例）
                </p>
              </div>
              <Slider
                value={[props.settings?.maxDimension]}
                onValueChange={(value) => 
                  props.onSettingsChange?.({ ...props.settings, maxDimension: value[0] })
                }
                max={4000}
                min={800}
                step={100}
                className="w-full"
              />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>800px</span>
                <span className="font-medium text-primary">{props.settings?.maxDimension}px</span>
                <span>4000px</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 pt-4">
          <Button variant="outline" size="sm" onClick={props.onClose} className="flex-1">
            取消
          </Button>
          <Button size="sm" className="flex-1">
            套用設定
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default SettingsPanel;