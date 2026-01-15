#!/bin/bash
# Roulettist 部署腳本 - Rocky Linux 9 + LAMPP
# 使用方式: chmod +x deploy.sh && ./deploy.sh

set -e

echo "=========================================="
echo "  Roulettist 部署腳本"
echo "  目標環境: Rocky Linux 9 + LAMPP"
echo "=========================================="

# 設定變數
APP_NAME="roulettist"
APP_DIR="/opt/lampp/htdocs/Roulettist"
NODE_PORT=3000

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# 檢查是否為 root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_warning "建議使用 sudo 執行此腳本"
    fi
}

# 步驟 1: 安裝 Node.js
install_nodejs() {
    echo ""
    echo ">>> 步驟 1: 安裝 Node.js"

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        print_status "Node.js 已安裝: $NODE_VERSION"
    else
        print_status "正在安裝 Node.js 18..."
        sudo dnf module enable nodejs:18 -y
        sudo dnf install nodejs -y
        print_status "Node.js 安裝完成: $(node -v)"
    fi
}

# 步驟 2: 建立應用目錄
setup_directory() {
    echo ""
    echo ">>> 步驟 2: 建立應用目錄"

    if [ ! -d "$APP_DIR" ]; then
        sudo mkdir -p "$APP_DIR"
        print_status "已建立目錄: $APP_DIR"
    else
        print_status "目錄已存在: $APP_DIR"
    fi

    # 設定權限
    sudo chown -R $USER:$USER "$APP_DIR"
}

# 步驟 3: 安裝依賴
install_dependencies() {
    echo ""
    echo ">>> 步驟 3: 安裝 NPM 依賴"

    cd "$APP_DIR"

    if [ -f "package.json" ]; then
        npm install
        print_status "NPM 依賴安裝完成"
    else
        print_error "找不到 package.json，請先上傳專案文件"
        exit 1
    fi
}

# 步驟 4: 設定防火牆
setup_firewall() {
    echo ""
    echo ">>> 步驟 4: 設定防火牆"

    if command -v firewall-cmd &> /dev/null; then
        sudo firewall-cmd --permanent --add-port=${NODE_PORT}/tcp 2>/dev/null || true
        sudo firewall-cmd --reload 2>/dev/null || true
        print_status "已開放 port ${NODE_PORT}"
    else
        print_warning "firewall-cmd 不可用，請手動設定防火牆"
    fi
}

# 步驟 5: 安裝並設定 PM2
setup_pm2() {
    echo ""
    echo ">>> 步驟 5: 設定 PM2 進程管理"

    # 安裝 PM2
    if ! command -v pm2 &> /dev/null; then
        sudo npm install -g pm2
        print_status "PM2 安裝完成"
    else
        print_status "PM2 已安裝"
    fi

    cd "$APP_DIR"

    # 停止舊進程（如果存在）
    pm2 delete "$APP_NAME" 2>/dev/null || true

    # 啟動應用
    pm2 start server.js --name "$APP_NAME"
    print_status "應用已啟動"

    # 設定開機自動啟動
    pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true
    pm2 save
    print_status "已設定開機自動啟動"
}

# 步驟 6: 顯示狀態
show_status() {
    echo ""
    echo "=========================================="
    echo "  部署完成!"
    echo "=========================================="
    echo ""

    # 取得伺服器 IP
    SERVER_IP=$(hostname -I | awk '{print $1}')

    echo "應用狀態:"
    pm2 status "$APP_NAME"
    echo ""
    echo "訪問地址:"
    echo "  主頁面: http://${SERVER_IP}:${NODE_PORT}"
    echo "  手機版: http://${SERVER_IP}:${NODE_PORT}/mobile.html"
    echo "  管理員: http://${SERVER_IP}:${NODE_PORT}/admin.html"
    echo ""
    echo "常用命令:"
    echo "  查看日誌: pm2 logs $APP_NAME"
    echo "  重啟應用: pm2 restart $APP_NAME"
    echo "  停止應用: pm2 stop $APP_NAME"
    echo ""
}

# 主程式
main() {
    check_root
    install_nodejs
    setup_directory
    install_dependencies
    setup_firewall
    setup_pm2
    show_status
}

# 執行
main
