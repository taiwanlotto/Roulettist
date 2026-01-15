# 輪盤遊戲 - Roulettist

支援手機投注的互動式輪盤遊戲系統

## 功能特色

- 🎰 39 個號碼的輪盤遊戲
- 📱 手機掃描 QR Code 即可投注
- 💰 即時顯示投注統計（總金額、人數）
- 🔄 自動同步所有玩家的投注資料
- ⚡ WebSocket 即時通訊

## 安裝步驟

### 1. 安裝 Node.js
確保您的電腦已安裝 Node.js (建議 v14 以上版本)
- 下載地址：https://nodejs.org/

### 2. 安裝專案依賴
在專案目錄下執行：
```bash
npm install
```

### 3. 啟動伺服器
```bash
npm start
```

或者直接執行：
```bash
node server.js
```

### 4. 開啟瀏覽器
伺服器啟動後，開啟瀏覽器訪問：
- 主輪盤頁面：http://localhost:3000
- 手機投注頁面：http://localhost:3000/mobile.html

## 使用方式

### 主控端（電腦）
1. 在瀏覽器開啟 http://localhost:3000
2. 可以看到輪盤、QR Code 和投注統計
3. 點擊「旋轉輪盤」開始遊戲
4. 查看底部的投注統計，了解每個號碼的投注情況

### 玩家端（手機）
1. 使用手機掃描頁面上的 QR Code
2. 選擇號碼（01-39）
3. 輸入投注金額
4. 點擊「確認投注」
5. 投注會即時顯示在主控端畫面

## 投注格式
玩家在手機端投注時：
- 選擇號碼：01-39
- 輸入金額：最少 100
- 例如：號碼 08 + 金額 3000

## 技術架構
- 前端：HTML5 + CSS3 + JavaScript
- 後端：Node.js + WebSocket (ws)
- QR Code：qrcode.js
- SVG 繪圖：原生 SVG API

## 文件說明
- `index.html` - 主輪盤頁面
- `mobile.html` - 手機投注頁面
- `script.js` - 輪盤邏輯和 WebSocket 客戶端
- `server.js` - WebSocket 伺服器和投注管理
- `package.json` - Node.js 專案配置

## 注意事項
- 手機和電腦必須在同一個網路環境下
- 如果使用局域網，請將 localhost 改成電腦的 IP 地址
- 預設端口為 3000，如需修改請編輯 server.js

## 疑難排解

### 手機無法連線
1. 確認手機和電腦在同一個 Wi-Fi
2. 查看電腦 IP 地址（Windows: `ipconfig`，Mac/Linux: `ifconfig`）
3. 將 QR Code 生成的 URL 改為電腦 IP，例如：http://192.168.1.100:3000/mobile.html

### WebSocket 連線失敗
1. 檢查防火牆是否阻擋端口 3000
2. 確認 server.js 是否正常運行
3. 查看瀏覽器控制台的錯誤訊息
