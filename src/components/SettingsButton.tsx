import React from 'react';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';

interface SettingsButtonProps {
  isActive: boolean;
  onClick: () => void;
}

/**
 * 設定按鈕元件
 * 負責顯示設定按鈕，點擊後打開設定面板
 */
const SettingsButton: React.FC<SettingsButtonProps> = ({ isActive, onClick }) => {
  return (
    <Button
      variant={isActive ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="gap-1.5"
      title="開啟/關閉設定面板"
    >
      <Settings className="w-4 h-4" />
      <span className="hidden sm:inline">設定</span>
    </Button>
  );
};

export default SettingsButton; 