/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
module.exports = {
  appId: 'com.spo.app',
  productName: 'Smart Photo Organizer',
  files: [
    'dist/**/*',
    'electron/**/*' // 確保複製所有電子文件
  ],
  extraResources: [
    {
      from: 'electron',
      to: 'electron'
    }
  ],
  directories: {
    buildResources: 'assets',
    output: 'release'
  },
  asar: false, // 不使用 asar 格式，避免文件訪問限制
  mac: {
    category: 'public.app-category.productivity',
    target: [
      'dmg',
      'zip'
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    hardenedRuntime: false, // 關閉強化運行時
    gatekeeperAssess: false,
    // 完全關閉沙盒 - 移除不支持的屬性
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // 添加所需權限
    extendInfo: {
      NSPhotoLibraryUsageDescription: "此應用需要訪問您的照片庫以整理照片。請在系統設定中授予權限。",
      NSCameraUsageDescription: "此應用需要訪問您的相機以獲取新照片。",
      NSMicrophoneUsageDescription: "此應用需要訪問您的麥克風以記錄語音備註。",
      NSDesktopFolderUsageDescription: "此應用需要訪問您的桌面資料夾以處理那裡的照片。請在系統設定中授予權限。",
      NSDocumentsFolderUsageDescription: "此應用需要訪問您的文件資料夾以處理那裡的照片。請在系統設定中授予權限。",
      NSDownloadsFolderUsageDescription: "此應用需要訪問您的下載資料夾以處理那裡的照片。請在系統設定中授予權限。",
      NSPicturesFolderUsageDescription: "此應用需要訪問您的圖片資料夾以處理那裡的照片。請在系統設定中授予權限。",
      NSRemovableVolumesUsageDescription: "此應用需要訪問您的外部存儲設備以處理那裡的照片。",
      NSFileProviderPresenceUsageDescription: "此應用需要確定檔案的可用性。",
      NSFileProviderDomainUsageDescription: "此應用需要訪問您的檔案提供商。",
      "NSAppleEventsUsageDescription": "此應用需要與系統交互以處理檔案。",
      "com.apple.security.app-sandbox": false,
      "LSUIElement": false
    },
    identity: null, // 不使用簽名
  },
  win: {
    target: [
      'nsis'
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  linux: {
    target: [
      'AppImage',
      'deb'
    ],
    category: 'Graphics'
  },
  // 確保執行前建立權限文件
  beforeBuild: () => {
    const fs = require('fs');
    const path = require('path');
    
    // 確保 build 目錄存在
    if (!fs.existsSync('build')) {
      fs.mkdirSync('build');
    }
    
    // 創建 macOS 權限文件 - 完全不限制權限
    const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.cs.disable-executable-page-protection</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.inherit</key>
    <true/>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.cs.debugger</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.bookmarks.app-scope</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
    <key>com.apple.security.files.pictures.read-write</key>
    <true/>
    <key>com.apple.security.files.desktop.read-write</key>
    <true/>
    <key>com.apple.security.files.documents.read-write</key>
    <true/>
    <key>com.apple.security.assets.pictures.read-write</key>
    <true/>
    <key>com.apple.security.assets.movies.read-write</key>
    <true/>
    <key>com.apple.security.assets.music.read-write</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
    <key>com.apple.security.device.microphone</key>
    <true/>
    <key>com.apple.security.personal-information.photos-library</key>
    <true/>
    <key>com.apple.security.personal-information.location</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
    <key>com.apple.security.temporary-exception.apple-events</key>
    <string>com.apple.systempreferences</string>
  </dict>
</plist>`;
    
    fs.writeFileSync(path.join('build', 'entitlements.mac.plist'), entitlements);
  }
}; 