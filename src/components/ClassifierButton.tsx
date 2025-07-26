import React from 'react';
import { Button } from '@/components/ui/button';
import { Tag } from 'lucide-react';

interface ClassifierButtonProps {
  onClick: () => void;
}

/**
 * 分類標籤按鈕元件
 * 負責顯示分類與標籤按鈕，點擊後打開分類面板
 */
const ClassifierButton: React.FC<ClassifierButtonProps> = ({ onClick }) => {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="gap-1.5"
      title="開啟/關閉分類和標籤面板"
    >
      <Tag className="w-4 h-4" />
      <span className="hidden sm:inline">分類標籤</span>
    </Button>
  );
};

export default ClassifierButton; 