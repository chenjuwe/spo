#!/bin/bash

# 清理舊安裝
echo "清理舊安裝..."
rm -rf ~/Library/Application\ Support/Smart\ Photo\ Organizer
rm -rf ~/Library/Caches/Smart\ Photo\ Organizer
rm -rf ~/Library/Preferences/com.spo.app.plist
rm -rf /Applications/Smart\ Photo\ Organizer.app

# 安裝新版本
echo "安裝新版本..."
cp -R "./release/mac-arm64/Smart Photo Organizer.app" /Applications/

echo "完成! 可以從應用程式資料夾運行 Smart Photo Organizer 了。" 