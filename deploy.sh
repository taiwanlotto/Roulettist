#!/bin/bash
# Roulettist 部署腳本 - Rocky Linux 9 / LAMPP
# 使用方式: chmod +x deploy.sh && ./deploy.sh

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Roulettist 輪盤遊戲 - 部署腳本${NC}"
echo -e "${GREEN}========================================${NC}"

# 設定變數
APP_NAME="roulettist"
DEPLOY_DIR="/opt/lampp/htdocs/${APP_NAME}"
SERVICE_NAME="roulettist"

# 檢查是否為 root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}請使用 root 權限執行此腳本${NC}"
    echo "使用方式: sudo ./deploy.sh"
    exit 1
fi

# 1. 檢查 Node.js
echo -e "\n${YELLOW}[1/6] 檢查 Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo "正在安裝 Node.js..."
    dnf install -y nodejs npm
fi
echo -e "Node.js 版本: $(node -v)"
echo -e "npm 版本: $(npm -v)"

# 2. 建立部署目錄
echo -e "\n${YELLOW}[2/6] 建立部署目錄...${NC}"
mkdir -p ${DEPLOY_DIR}
mkdir -p ${DEPLOY_DIR}/reports

# 3. 複製檔案（如果是在當前目錄執行）
echo -e "\n${YELLOW}[3/6] 複製應用程式檔案...${NC}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 複製主要檔案
cp -v ${SCRIPT_DIR}/server.js ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/database.js ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/simulate.js ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/package.json ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/members.json ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/index.html ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/admin.html ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/mobile.html ${DEPLOY_DIR}/
cp -v ${SCRIPT_DIR}/login.html ${DEPLOY_DIR}/

# 複製 script.js（如果存在）
[ -f ${SCRIPT_DIR}/script.js ] && cp -v ${SCRIPT_DIR}/script.js ${DEPLOY_DIR}/

echo "檔案複製完成"

# 4. 安裝依賴
echo -e "\n${YELLOW}[4/6] 安裝 Node.js 依賴...${NC}"
cd ${DEPLOY_DIR}
npm install --production

# 5. 建立 systemd 服務
echo -e "\n${YELLOW}[5/6] 建立系統服務...${NC}"
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Roulettist Roulette Game Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${DEPLOY_DIR}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=${SERVICE_NAME}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# 重新載入 systemd
systemctl daemon-reload

# 6. 啟動服務
echo -e "\n${YELLOW}[6/6] 啟動服務...${NC}"
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

# 檢查狀態
sleep 2
if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}   部署完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "\n服務狀態: ${GREEN}運行中${NC}"
    echo -e "部署目錄: ${DEPLOY_DIR}"
    echo -e "\n訪問網址:"
    echo -e "  主控台: http://tw5399.com:3000"
    echo -e "  管理員: http://tw5399.com:3000/admin.html"
    echo -e "  手機版: http://tw5399.com:3000/mobile.html"
    echo -e "\n管理指令:"
    echo -e "  查看狀態: systemctl status ${SERVICE_NAME}"
    echo -e "  查看日誌: journalctl -u ${SERVICE_NAME} -f"
    echo -e "  重啟服務: systemctl restart ${SERVICE_NAME}"
    echo -e "  停止服務: systemctl stop ${SERVICE_NAME}"
else
    echo -e "\n${RED}服務啟動失敗！${NC}"
    echo "請檢查日誌: journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
fi
