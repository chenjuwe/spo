import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Loader2, Timer } from "lucide-react";
import { ProcessingStep } from "@/lib/types";

interface ProcessingStatusProps {
  steps: ProcessingStep[];
  currentStep: number;
  onCancel?: () => void;
}

export const ProcessingStatus = ({ steps, currentStep, onCancel }: ProcessingStatusProps) => {
  // 計算總進度百分比
  const totalProgress = steps.reduce(
    (acc, step, index) => acc + step.progress / steps.length,
    0
  );

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">處理中，請稍候...</h3>
          <Badge variant="secondary">
            <Timer className="w-3 h-3 mr-1" />
            {Math.round(totalProgress)}% 完成
          </Badge>
        </div>

        <Progress value={totalProgress} className="h-2" />

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
              <Progress
                value={step.progress}
                className={`h-1.5 w-32 ${
                  step.status === "error" ? "bg-destructive/20" : ""
                }`}
              />
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