import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, Loader2 } from "lucide-react";

interface ProcessingStep {
  name: string;
  status: 'pending' | 'processing' | 'completed';
  progress: number;
}

interface ProcessingStatusProps {
  steps: ProcessingStep[];
  currentStep: number;
}

export const ProcessingStatus = ({ steps, currentStep }: ProcessingStatusProps) => {
  const getStepIcon = (step: ProcessingStep, index: number) => {
    if (step.status === 'completed') {
      return <CheckCircle className="w-5 h-5 text-success" />;
    } else if (step.status === 'processing') {
      return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
    }
    return <Circle className="w-5 h-5 text-muted-foreground" />;
  };

  const getStepBadge = (step: ProcessingStep) => {
    switch (step.status) {
      case 'completed':
        return <Badge variant="default" className="bg-success">完成</Badge>;
      case 'processing':
        return <Badge variant="default">處理中</Badge>;
      default:
        return <Badge variant="secondary">等待中</Badge>;
    }
  };

  const overallProgress = steps.reduce((acc, step) => acc + step.progress, 0) / steps.length;

  return (
    <Card className="p-6 bg-gradient-subtle">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">正在處理照片...</h3>
          <p className="text-sm text-muted-foreground">
            請稍候，系統正在分析並整理您的照片
          </p>
        </div>

        {/* Overall Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">整體進度</span>
            <span className="text-muted-foreground">{Math.round(overallProgress)}%</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </div>

        {/* Step Details */}
        <div className="space-y-4">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`
                flex items-center space-x-4 p-4 rounded-lg transition-all duration-200
                ${step.status === 'processing' 
                  ? 'bg-photo-hover border border-primary/20' 
                  : step.status === 'completed'
                  ? 'bg-success/5 border border-success/20'
                  : 'bg-muted/30'
                }
              `}
            >
              {/* Step Icon */}
              <div className="flex-shrink-0">
                {getStepIcon(step, index)}
              </div>

              {/* Step Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium text-sm">{step.name}</h4>
                  {getStepBadge(step)}
                </div>
                
                {/* Step Progress */}
                {step.status !== 'pending' && (
                  <div className="space-y-1">
                    <Progress 
                      value={step.progress} 
                      className={`h-1.5 ${
                        step.status === 'completed' 
                          ? '[&>div]:bg-success' 
                          : step.status === 'processing'
                          ? '[&>div]:bg-gradient-processing'
                          : ''
                      }`}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {step.status === 'processing' && currentStep === index
                          ? '正在處理...'
                          : step.status === 'completed'
                          ? '已完成'
                          : '等待中'
                        }
                      </span>
                      <span>{step.progress}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Processing Animation */}
        <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>AI 正在努力工作中</span>
        </div>
      </div>
    </Card>
  );
};