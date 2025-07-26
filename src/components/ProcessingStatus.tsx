import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Loader2, Timer, Clock } from "lucide-react";
import { ProcessingStep } from "@/lib/types";
import { useEffect, useState } from "react";

interface ProcessingStatusProps {
  steps: ProcessingStep[];
  currentStep: number;
  startTime?: number; // 開始處理的時間戳
  onCancel?: () => void;
}

export const ProcessingStatus = ({ steps, currentStep, startTime, onCancel }: ProcessingStatusProps) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null);
  
  // 計算總進度百分比，使用加權平均值
  const calculateWeightedProgress = () => {
    // 使用指數加權，使早期步驟權重較低，後期步驟權重較高
    const weights = steps.map((_, i) => Math.pow(1.5, i));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    // 計算加權總進度
    let weightedProgress = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const normalizedWeight = weights[i] / totalWeight;
      
      if (step.status === 'completed') {
        weightedProgress += normalizedWeight * 100;
      } else if (step.status === 'processing') {
        weightedProgress += normalizedWeight * step.progress;
      }
    }
    
    return Math.round(weightedProgress);
  };

  const totalProgress = calculateWeightedProgress();

  // 根據已處理的進度和已經過的時間估算剩餘時間
  useEffect(() => {
    if (!startTime) return;

    // 更新已過時間
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000); // 轉換為秒
      setElapsedTime(elapsed);
      
      // 只有當進度大於 5% 時才開始估算時間
      if (totalProgress > 5 && totalProgress < 99) {
        // 根據已用時間和進度估算剩餘時間
        const estimatedTotal = (elapsed * 100) / totalProgress;
        const remaining = Math.max(0, estimatedTotal - elapsed);
        setEstimatedTimeRemaining(Math.round(remaining));
      } else if (totalProgress >= 99) {
        setEstimatedTimeRemaining(0);
      }
    }, 1000);
    
    return () => clearInterval(timer);
  }, [startTime, totalProgress]);

  // 格式化時間
  const formatTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds} 秒`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${minutes} 分 ${secs} 秒`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours} 小時 ${minutes} 分`;
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">處理中，請稍候...</h3>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="flex items-center gap-1">
              <Timer className="w-3 h-3" />
              {totalProgress}% 完成
            </Badge>
            {startTime && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                已用時間: {formatTime(elapsedTime)}
              </Badge>
            )}
          </div>
        </div>

        <Progress value={totalProgress} className="h-2" />
        
        {estimatedTimeRemaining !== null && (
          <div className="text-sm text-muted-foreground text-center">
            預估剩餘時間: {formatTime(estimatedTimeRemaining)}
          </div>
        )}

        <div className="space-y-4">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`flex items-center justify-between ${
                index === currentStep ? "font-medium" : "text-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2">
                {step.status === "pending" && (
                  <div className="w-5 h-5 rounded-full border-2 border-muted flex-shrink-0" />
                )}
                {step.status === "processing" && (
                  <Loader2 className="w-5 h-5 text-primary animate-spin flex-shrink-0" />
                )}
                {step.status === "completed" && (
                  <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
                )}
                {step.status === "error" && (
                  <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
                )}
                <span>{step.name}</span>
                {step.error && (
                  <Badge variant="destructive" className="text-xs ml-2">
                    錯誤
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs w-8 text-right">{step.progress}%</span>
                <Progress
                  value={step.progress}
                  className={`h-1.5 w-32 ${
                    step.status === "error" ? "bg-destructive/20" : ""
                  }`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* 錯誤訊息顯示區域 */}
        {steps.some(step => step.status === "error") && (
          <div className="mt-4 p-3 border border-destructive/30 rounded bg-destructive/10 text-sm text-destructive">
            <p className="font-medium">處理過程中發生錯誤：</p>
            <ul className="mt-1 list-disc list-inside">
              {steps
                .filter(step => step.status === "error" && step.error)
                .map((step, index) => (
                  <li key={index}>{step.error}</li>
                ))}
            </ul>
            <p className="mt-2">
              您可以嘗試取消操作，然後重新開始處理。
            </p>
          </div>
        )}
        
        {/* 取消按鈕 */}
        {onCancel && (
          <div className="flex justify-end mt-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={onCancel}
            >
              取消處理
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};