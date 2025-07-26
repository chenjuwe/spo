const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

// 確保 build 目錄存在
const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir);
}

// 創建 entitlements 文件
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

fs.writeFileSync(path.join(buildDir, 'entitlements.mac.plist'), entitlements);

module.exports = {
  packagerConfig: {
    asar: false, // 不使用 asar 格式，避免文件訪問限制
    extraResource: [
      'electron', // 複製整個 electron 目錄作為資源
      'dist'
    ],
    protocols: [
      {
        name: 'Smart Photo Organizer',
        schemes: ['spo']
      }
    ],
    // macOS 特定設置
    osxSign: {
      identity: null, // 開發階段不簽名
      'hardened-runtime': false,
      'gatekeeper-assess': false,
      entitlements: 'build/entitlements.mac.plist',
      'entitlements-inherit': 'build/entitlements.mac.plist'
    },
    osxNotarize: false, // 開發階段不公證
    // 添加 macOS Info.plist 特定權限設定
    extend: {
      'info-plist': {
        'NSPhotoLibraryUsageDescription': '此應用需要訪問您的照片庫以整理照片。請在系統設定中授予權限。',
        'NSCameraUsageDescription': '此應用需要訪問您的相機以獲取新照片。',
        'NSMicrophoneUsageDescription': '此應用需要訪問您的麥克風以記錄語音備註。',
        'NSDesktopFolderUsageDescription': '此應用需要訪問您的桌面資料夾以處理那裡的照片。請在系統設定中授予權限。',
        'NSDocumentsFolderUsageDescription': '此應用需要訪問您的文件資料夾以處理那裡的照片。請在系統設定中授予權限。',
        'NSDownloadsFolderUsageDescription': '此應用需要訪問您的下載資料夾以處理那裡的照片。請在系統設定中授予權限。',
        'NSPicturesFolderUsageDescription': '此應用需要訪問您的圖片資料夾以處理那裡的照片。請在系統設定中授予權限。',
        'NSRemovableVolumesUsageDescription': '此應用需要訪問您的外部存儲設備以處理那裡的照片。',
        'NSFileProviderPresenceUsageDescription': '此應用需要確定檔案的可用性。',
        'NSFileProviderDomainUsageDescription': '此應用需要訪問您的檔案提供商。',
        'NSAppleEventsUsageDescription': '此應用需要與系統交互以處理檔案。',
        'com.apple.security.app-sandbox': false,
        'LSUIElement': false
      }
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {
        // Darwin/mac 平台配置
      }
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        // DMG 格式特定配置
        format: 'ULFO'
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {}
    },
    // 禁用 Fuses 以避免可能的兼容性問題
    /* 
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
    */
  ],
  hooks: {
    // 添加在打包前執行的自定義操作
    generateAssets: async () => {
      console.log('正在準備打包所需的資產...');
      // 這裡可以添加其他自定義邏輯
    },
    postPackage: async (forgeConfig, options) => {
      console.log('打包完成，正在執行後續處理...');
      // 這裡可以添加打包後的處理邏輯
    }
  }
};
