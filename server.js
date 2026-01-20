// MQTT 伺服器 - 處理玩家投注和會員登入
const mqtt = require('mqtt');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./database');

// 取得本機 IP 作為頻道 ID
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // 跳過內部迴圈和非 IPv4
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// 系統頻道 ID（用於區分不同的獨立系統）
// 優先順序：命令列參數 > 環境變數 > 本機IP
// 使用方式：node server.js --channel=192.168.1.100
const CHANNEL_ID = process.argv.find(arg => arg.startsWith('--channel='))?.split('=')[1] ||
    process.env.CHANNEL_ID ||
    getLocalIP();

console.log(`\n========== 系統頻道: ${CHANNEL_ID} ==========\n`);

// MQTT 連線設定
const MQTT_BROKER = 'wss://tw5399.com:9002';
const MQTT_OPTIONS = {
    username: 'palee',
    password: '888168',
    clientId: `roulette_${CHANNEL_ID}_` + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 30000,
    rejectUnauthorized: false  // 跳過自簽名憑證驗證
};

// MQTT 主題（加上頻道前綴）
const CHANNEL_PREFIX = `roulette/${CHANNEL_ID}`;
const TOPICS = {
    GAME_STATE: `${CHANNEL_PREFIX}/game/state`,           // 遊戲狀態（期數、階段、秒數）
    GAME_RESULT: `${CHANNEL_PREFIX}/game/result`,         // 開獎結果
    BETS_UPDATE: `${CHANNEL_PREFIX}/bets/update`,         // 投注更新
    PLAYER_BET: `${CHANNEL_PREFIX}/player/bet`,           // 玩家投注（客戶端發送）
    PLAYER_LOGIN: `${CHANNEL_PREFIX}/player/login`,       // 玩家登入（客戶端發送）
    PLAYER_RESULT: `${CHANNEL_PREFIX}/player/result/`,    // 個人結果（加上memberId）
    ADMIN_DATA: `${CHANNEL_PREFIX}/admin/data`,           // 管理員資料
    ADMIN_RECHARGE: `${CHANNEL_PREFIX}/admin/recharge`,   // 管理員充值
    ADMIN_QUERY: `${CHANNEL_PREFIX}/admin/query`,         // 管理員查詢
    BALANCE_UPDATE: `${CHANNEL_PREFIX}/balance/`,         // 餘額更新（加上memberId）
};

// 儲存所有投注資料
let bets = {}; // { number: { total: 0, players: [] } }
let oddEvenBets = { odd: { total: 0, players: [] }, even: { total: 0, players: [] } };
let bigSmallBets = { big: { total: 0, players: [] }, small: { total: 0, players: [] } };
let colorBets = { red: { total: 0, players: [] }, blue: { total: 0, players: [] }, green: { total: 0, players: [] } };
let sessions = {}; // 儲存已登入的會員 session
let currentPhase = 'stop'; // stop, betting, spinning
let lastWinningNumber = null;
let currentRoundNumber = null;
let settlingRoundNumber = null; // 用於結算的期數（在進入spinning時保存）
let gameRunning = false;
let gameTimer = null;
let onlineCount = 0;

// MQTT 客戶端
let mqttClient = null;

// 初始化所有號碼的投注資料
function initBets() {
    for (let i = 1; i <= 39; i++) {
        const num = i.toString().padStart(2, '0');
        bets[num] = { total: 0, players: [] };
    }
    oddEvenBets = { odd: { total: 0, players: [] }, even: { total: 0, players: [] } };
    bigSmallBets = { big: { total: 0, players: [] }, small: { total: 0, players: [] } };
    colorBets = { red: { total: 0, players: [] }, blue: { total: 0, players: [] }, green: { total: 0, players: [] } };
}

// 取得號碼對應的顏色（按照輪盤實際顏色）
// 01,04,07,10,13,16,19,22,25,28,31,34,37 = 綠色（餘1）
// 02,05,08,11,14,17,20,23,26,29,32,35,38 = 紅色（餘2）
// 03,06,09,12,15,18,21,24,27,30,33,36,39 = 藍色（餘0）
function getNumberColor(num) {
    const n = parseInt(num);
    const colorIndex = n % 3;
    if (colorIndex === 0) return 'blue';  // 3,6,9,12,15,18...
    if (colorIndex === 1) return 'green'; // 1,4,7,10,13,16...
    return 'red'; // colorIndex === 2 (2,5,8,11,14,17...)
}

initBets();

// 連接 MQTT
function connectMQTT() {
    console.log('正在連接 MQTT 伺服器:', MQTT_BROKER);

    mqttClient = mqtt.connect(MQTT_BROKER, MQTT_OPTIONS);

    mqttClient.on('connect', () => {
        console.log('MQTT 連線成功');

        // 訂閱需要監聯的主題
        mqttClient.subscribe([
            TOPICS.PLAYER_BET,
            TOPICS.PLAYER_LOGIN,
            TOPICS.ADMIN_RECHARGE,
            TOPICS.ADMIN_QUERY,
            `${CHANNEL_PREFIX}/client/connect`,
            `${CHANNEL_PREFIX}/client/disconnect`
        ], (err) => {
            if (err) {
                console.error('MQTT 訂閱失敗:', err);
            } else {
                console.log('MQTT 主題訂閱成功');
            }
        });

        // 發送伺服器上線訊息
        publishGameState();
    });

    mqttClient.on('message', async (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            await handleMQTTMessage(topic, data);
        } catch (error) {
            console.error('處理 MQTT 訊息錯誤:', error);
        }
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT 錯誤:', err);
    });

    mqttClient.on('close', () => {
        console.log('MQTT 連線關閉');
    });

    mqttClient.on('reconnect', () => {
        console.log('MQTT 重新連線中...');
    });
}

// 處理 MQTT 訊息
async function handleMQTTMessage(topic, data) {
    // 客戶端連線
    if (topic === `${CHANNEL_PREFIX}/client/connect`) {
        onlineCount++;
        console.log(`客戶端連線，目前在線: ${onlineCount}`);
        // 有人上線就啟動遊戲
        if (!gameRunning) {
            startGame();
        }
        return;
    }

    // 客戶端斷線
    if (topic === `${CHANNEL_PREFIX}/client/disconnect`) {
        onlineCount = Math.max(0, onlineCount - 1);
        if (data.memberId && sessions[data.memberId]) {
            delete sessions[data.memberId];
            console.log(`會員斷線: ID ${data.memberId}`);
            broadcastAdminUpdate();
        }
        console.log(`客戶端斷線，目前在線: ${onlineCount}`);
        return;
    }

    // 玩家登入
    if (topic === TOPICS.PLAYER_LOGIN) {
        await handleLogin(data);
        return;
    }

    // 玩家投注
    if (topic === TOPICS.PLAYER_BET) {
        await handleBet(data);
        return;
    }

    // 管理員充值
    if (topic === TOPICS.ADMIN_RECHARGE) {
        await handleRecharge(data);
        return;
    }

    // 管理員查詢
    if (topic === TOPICS.ADMIN_QUERY) {
        await handleAdminQuery(data);
        return;
    }
}

// 處理登入
async function handleLogin(data) {
    const { username, password, clientId } = data;
    const result = await db.login(username, password);

    if (result.success) {
        const memberId = result.member.id;

        // 檢查是否已經有人登入此帳號
        if (sessions[memberId]) {
            mqttClient.publish(`${CHANNEL_PREFIX}/login/response/${clientId}`, JSON.stringify({
                success: false,
                message: '此帳號已在其他裝置登入中'
            }));
            console.log(`會員 ${result.member.name} 嘗試重複登入，已拒絕`);
            return;
        }

        sessions[memberId] = { clientId, name: result.member.name };

        mqttClient.publish(`${CHANNEL_PREFIX}/login/response/${clientId}`, JSON.stringify({
            success: true,
            member: result.member
        }));

        console.log(`會員登入: ${result.member.name} (${result.member.username})`);
        broadcastAdminUpdate();
    } else {
        mqttClient.publish(`${CHANNEL_PREFIX}/login/response/${data.clientId}`, JSON.stringify({
            success: false,
            message: result.message
        }));
    }
}

// 處理投注
async function handleBet(data) {
    // 支援兩種格式：betType（正式）或 type（模擬器）
    const { memberId, target, amount, clientId, memberName } = data;
    const betType = data.betType || data.type;

    // 模擬器模式：有 memberName 但沒有 clientId
    const isSimulator = memberName && !clientId;

    // 正式玩家需要檢查是否已登入
    if (!isSimulator && !sessions[memberId]) {
        mqttClient.publish(`${CHANNEL_PREFIX}/bet/response/${clientId}`, JSON.stringify({
            success: false,
            message: '請先登入'
        }));
        return;
    }

    // 檢查是否在投注期
    if (currentPhase !== 'betting') {
        if (clientId) {
            mqttClient.publish(`${CHANNEL_PREFIX}/bet/response/${clientId}`, JSON.stringify({
                success: false,
                message: currentPhase === 'stop' ? '停止期，正在結算中' : '已停止下注，請等待開獎'
            }));
        }
        return;
    }

    // 取得會員資料或使用模擬器資料
    let member;
    if (isSimulator) {
        // 模擬器：直接使用傳入的資料，不檢查資料庫
        member = { id: memberId, name: memberName };
        // 將模擬玩家加入 sessions（標記為在線）
        if (!sessions[memberId]) {
            sessions[memberId] = { clientId: `sim_${memberId}`, name: memberName, isSimulator: true };
        }
    } else {
        // 正式玩家：檢查餘額
        const hasBalance = await db.checkBalance(memberId, amount);
        if (!hasBalance) {
            mqttClient.publish(`${CHANNEL_PREFIX}/bet/response/${clientId}`, JSON.stringify({
                success: false,
                message: '餘額不足'
            }));
            return;
        }
        member = await db.getMember(memberId);
    }

    let displayTarget = target;

    if (betType === 'number') {
        // 號碼投注
        if (!bets[target]) {
            bets[target] = { total: 0, players: [] };
        }

        const existingBet = bets[target].players.find(p => p.id === memberId);
        if (existingBet) {
            await db.updateBalance(memberId, existingBet.amount);
            bets[target].total -= existingBet.amount;
            existingBet.amount = amount;
            bets[target].total += amount;
        } else {
            bets[target].players.push({ id: memberId, name: member.name, amount });
            bets[target].total += amount;
        }
    } else if (betType === 'oddeven') {
        // 單雙投注
        displayTarget = target === 'odd' ? '單' : '雙';
        const existingBet = oddEvenBets[target].players.find(p => p.id === memberId);
        if (existingBet) {
            await db.updateBalance(memberId, existingBet.amount);
            oddEvenBets[target].total -= existingBet.amount;
            existingBet.amount = amount;
            oddEvenBets[target].total += amount;
        } else {
            oddEvenBets[target].players.push({ id: memberId, name: member.name, amount });
            oddEvenBets[target].total += amount;
        }
    } else if (betType === 'bigsmall') {
        // 大小投注
        displayTarget = target === 'big' ? '大' : '小';
        const existingBet = bigSmallBets[target].players.find(p => p.id === memberId);
        if (existingBet) {
            await db.updateBalance(memberId, existingBet.amount);
            bigSmallBets[target].total -= existingBet.amount;
            existingBet.amount = amount;
            bigSmallBets[target].total += amount;
        } else {
            bigSmallBets[target].players.push({ id: memberId, name: member.name, amount });
            bigSmallBets[target].total += amount;
        }
    } else if (betType === 'color') {
        // 顏色投注（紅藍綠）
        const colorNames = { red: '紅', blue: '藍', green: '綠' };
        displayTarget = colorNames[target] || target;
        const existingBet = colorBets[target].players.find(p => p.id === memberId);
        if (existingBet) {
            await db.updateBalance(memberId, existingBet.amount);
            colorBets[target].total -= existingBet.amount;
            existingBet.amount = amount;
            colorBets[target].total += amount;
        } else {
            colorBets[target].players.push({ id: memberId, name: member.name, amount });
            colorBets[target].total += amount;
        }
    }

    // 正式玩家：扣除餘額並儲存記錄
    if (!isSimulator) {
        const balanceResult = await db.updateBalance(memberId, -amount);
        await db.addBetRecord(memberId, currentRoundNumber, betType, target, amount);

        // 發送投注成功訊息
        mqttClient.publish(`${CHANNEL_PREFIX}/bet/response/${clientId}`, JSON.stringify({
            success: true,
            target: displayTarget,
            amount,
            balance: balanceResult.balance
        }));
    } else {
        // 模擬玩家也記錄到資料庫（用於測試結算功能）
        // memberId 1-30 對應資料庫中的會員 ID 1-30
        if (memberId >= 1 && memberId <= 100) {
            await db.addBetRecord(memberId, currentRoundNumber, betType, target, amount);
        }
    }

    console.log(`投注: ${displayTarget} $${amount} (${isSimulator ? '模擬' : '會員'}: ${member.name})`);

    // 廣播投注更新（只發送投注資料，不重新查詢資料庫）
    broadcastBetsUpdate();
}

// 處理充值
async function handleRecharge(data) {
    const { memberId, amount, operator, remark, requestId } = data;

    const result = await db.rechargeMember(memberId, amount, operator, remark);

    mqttClient.publish(`${CHANNEL_PREFIX}/admin/recharge/response/${requestId}`, JSON.stringify(result));

    if (result.success) {
        console.log(`充值成功: 會員ID ${memberId}, 金額 ${amount}`);

        // 如果會員在線，通知餘額更新
        if (sessions[memberId]) {
            mqttClient.publish(TOPICS.BALANCE_UPDATE + memberId, JSON.stringify({
                balance: result.balanceAfter
            }));
        }

        broadcastAdminUpdate();
    }
}

// 處理管理員查詢
async function handleAdminQuery(data) {
    const { queryType, params, requestId } = data;
    let result = {};

    switch (queryType) {
        case 'betRecords':
            result = await db.getAllBetRecords(params?.days || 14);
            break;
        case 'memberBetRecords':
            result = await db.getMemberBetRecords(params?.memberId, params?.days || 14);
            break;
        case 'systemStats':
            result = await db.getSystemProfitStats(params?.days || 14);
            break;
        case 'memberStats':
            result = await db.getMemberProfitStats(params?.memberId, params?.days || 14);
            break;
        case 'rechargeRecords':
            result = await db.getRechargeRecords(params?.memberId, params?.days || 14);
            break;
        case 'gameResults':
            result = await db.getGameResults(params?.days || 14);
            break;
    }

    mqttClient.publish(`${CHANNEL_PREFIX}/admin/query/response/${requestId}`, JSON.stringify(result));
}

// 發布遊戲狀態
function publishGameState() {
    if (!mqttClient || !mqttClient.connected) return;

    const state = {
        phase: currentPhase,
        roundNumber: currentRoundNumber,
        seconds: new Date().getSeconds(),
        gameRunning
    };

    mqttClient.publish(TOPICS.GAME_STATE, JSON.stringify(state), { retain: true });
}

// 廣播投注更新
function broadcastBetsUpdate() {
    if (!mqttClient || !mqttClient.connected) return;

    const onlinePlayers = Object.keys(sessions).map(id => parseInt(id));
    mqttClient.publish(TOPICS.BETS_UPDATE, JSON.stringify({
        bets,
        oddEvenBets,
        bigSmallBets,
        colorBets,
        onlinePlayers
    }));
}

// 廣播管理員資料
async function broadcastAdminUpdate() {
    if (!mqttClient || !mqttClient.connected) return;

    const members = await db.getAllMembers();
    // 計算所有在線玩家（包含模擬器玩家）
    const onlinePlayers = Object.keys(sessions).map(id => parseInt(id));
    const systemStats = await db.getSystemProfitStats(0); // 當天統計

    mqttClient.publish(TOPICS.ADMIN_DATA, JSON.stringify({
        members,
        onlinePlayers,
        bets,
        oddEvenBets,
        bigSmallBets,
        colorBets,
        systemStats,
        currentRoundNumber
    }));
}

// 啟動遊戲循環
function startGame() {
    if (gameRunning) return;

    gameRunning = true;
    console.log('\n=== 遊戲啟動 ===');

    // 每秒執行
    gameTimer = setInterval(async () => {
        const now = new Date();
        const seconds = now.getSeconds();
        let newPhase;

        // 根據秒數決定階段
        // 0-10秒: 停止期（結算）
        // 11-50秒: 投注期
        // 51-59秒: 開獎期
        if (seconds >= 0 && seconds <= 10) {
            newPhase = 'stop';
        } else if (seconds >= 11 && seconds <= 50) {
            newPhase = 'betting';
        } else {
            newPhase = 'spinning';
        }

        // 每秒發布遊戲狀態
        currentRoundNumber = db.calculateRoundNumber();
        publishGameState();

        // 階段變化時處理
        if (newPhase !== currentPhase) {
            const oldPhase = currentPhase;
            currentPhase = newPhase;

            console.log(`遊戲階段變更: ${oldPhase} -> ${currentPhase} (${seconds}秒) 期數: ${currentRoundNumber}`);

            // 進入旋轉期時產生開獎號碼
            if (oldPhase === 'betting' && currentPhase === 'spinning') {
                // 保存當前期數用於結算（因為結算時分鐘可能已經改變）
                settlingRoundNumber = currentRoundNumber;

                const randomNum = Math.floor(Math.random() * 39) + 1;
                const winningNumber = randomNum.toString().padStart(2, '0');
                lastWinningNumber = winningNumber;

                console.log(`\n=== 輪盤開始轉動，目標號碼: ${winningNumber}，結算期數: ${settlingRoundNumber} ===`);

                mqttClient.publish(TOPICS.GAME_RESULT, JSON.stringify({
                    type: 'spin_wheel',
                    winningNumber,
                    roundNumber: settlingRoundNumber
                }));
            }

            // 進入停止期時自動開獎結算（使用保存的期數）
            if (oldPhase === 'spinning' && currentPhase === 'stop') {
                await handleGameResult(lastWinningNumber, settlingRoundNumber);
            }

            // 進入投注期時重置所有投注
            if (oldPhase !== 'betting' && currentPhase === 'betting') {
                console.log('\n=== 新一局開始（自動重置）===');
                initBets();

                // 清除模擬器玩家的 session
                for (let id in sessions) {
                    if (sessions[id].isSimulator) {
                        delete sessions[id];
                    }
                }

                mqttClient.publish(TOPICS.BETS_UPDATE, JSON.stringify({
                    type: 'new_round',
                    bets,
                    oddEvenBets,
                    bigSmallBets,
                    colorBets,
                    roundNumber: currentRoundNumber
                }));

                console.log('投注已重置，開放下注\n');
            }

            broadcastAdminUpdate();
        }
    }, 1000);
}

// 處理開獎結算
async function handleGameResult(winningNumber, roundNumber) {
    console.log(`\n=== 開獎結算: ${winningNumber} 期數: ${roundNumber} ===`);

    const result = calculateGameResult(winningNumber);
    const playerProfits = calculatePlayerProfits(winningNumber);

    // 更新資料庫押注結果（使用傳入的期數，而非currentRoundNumber）
    await db.updateBetRecordResult(roundNumber, winningNumber);

    // 儲存開獎結果
    await db.saveGameResult(
        roundNumber,
        winningNumber,
        result.totalBets,
        result.totalPayout,
        result.systemProfit
    );

    // 派彩給中獎玩家
    await payoutWinners(winningNumber);

    // 發送個人結果給每個已登入的玩家
    for (let memberId in sessions) {
        const numericMemberId = parseInt(memberId);
        const profit = playerProfits[numericMemberId] || 0;
        const member = await db.getMember(numericMemberId);

        mqttClient.publish(TOPICS.PLAYER_RESULT + memberId, JSON.stringify({
            winningNumber,
            profit,
            balance: member ? member.balance : 0,
            roundNumber: roundNumber
        }));
    }

    // 廣播結果
    mqttClient.publish(TOPICS.GAME_RESULT, JSON.stringify({
        type: 'game_result',
        result,
        winningNumber,
        roundNumber: roundNumber
    }));

    // 更新所有已登入玩家的餘額
    await updateAllPlayerBalances();
}

// 計算遊戲結果
function calculateGameResult(winningNumber) {
    let totalBets = 0;
    for (let num in bets) {
        totalBets += bets[num].total;
    }
    totalBets += oddEvenBets.odd.total + oddEvenBets.even.total;
    totalBets += bigSmallBets.big.total + bigSmallBets.small.total;
    totalBets += colorBets.red.total + colorBets.blue.total + colorBets.green.total;

    const winNum = parseInt(winningNumber);
    const isOdd = winNum % 2 === 1;
    const isBig = winNum >= 20 && winNum <= 39;
    const isSmall = winNum >= 1 && winNum <= 19;
    const winningColor = getNumberColor(winNum);

    // 計算號碼投注派彩 (賠率 35:1，返還本金所以 x36)
    const winningBets = bets[winningNumber] || { total: 0, players: [] };
    let totalPayout = winningBets.total * 36;

    // 計算單雙投注派彩 (賠率 1:0.9，返還本金所以 x1.9)，39莊家通吃
    if (winNum !== 39) {
        if (isOdd) {
            totalPayout += oddEvenBets.odd.total * 1.9;
        } else {
            totalPayout += oddEvenBets.even.total * 1.9;
        }
    }
    // 39 莊家通吃，單雙不派彩

    // 計算大小投注派彩 (賠率 1:0.9，返還本金所以 x1.9)，39莊家通吃
    if (winNum !== 39) {
        if (isBig) {
            totalPayout += bigSmallBets.big.total * 1.9;
        } else if (isSmall) {
            totalPayout += bigSmallBets.small.total * 1.9;
        }
    }
    // 39 莊家通吃，大小不派彩

    // 計算顏色投注派彩 (賠率 1:1.8，返還本金所以 x2.8)
    totalPayout += colorBets[winningColor].total * 2.8;

    const winnersCount = winningBets.players.length;

    const result = {
        winningNumber,
        totalBets,
        winnersCount,
        totalPayout,
        systemProfit: totalBets - totalPayout
    };

    console.log('=== 遊戲結果 ===');
    console.log(`開獎號碼: ${winningNumber}`);
    console.log(`總投注金額: $${totalBets.toLocaleString()}`);
    console.log(`中獎人數: ${winnersCount}`);
    console.log(`派彩金額: $${totalPayout.toLocaleString()}`);
    console.log(`系統輸贏: $${result.systemProfit.toLocaleString()}`);
    console.log('================\n');

    return result;
}

// 計算每個玩家的個人損益
function calculatePlayerProfits(winningNumber) {
    const playerProfits = {};
    const winNum = parseInt(winningNumber);
    const isOdd = winNum % 2 === 1;
    const isBig = winNum >= 20 && winNum <= 38;
    const isSmall = winNum >= 1 && winNum <= 19;
    const winningColor = getNumberColor(winNum);

    // 號碼投注
    for (let num in bets) {
        bets[num].players.forEach(player => {
            if (!playerProfits[player.id]) playerProfits[player.id] = 0;
            if (num === winningNumber) {
                playerProfits[player.id] += player.amount * 35;
            } else {
                playerProfits[player.id] -= player.amount;
            }
        });
    }

    // 單雙投注 (賠率 1:0.9)，39莊家通吃
    let winningOddEven = winNum === 39 ? null : (isOdd ? 'odd' : 'even');
    ['odd', 'even'].forEach(oddeven => {
        oddEvenBets[oddeven].players.forEach(player => {
            if (!playerProfits[player.id]) playerProfits[player.id] = 0;
            if (winningOddEven && oddeven === winningOddEven) {
                playerProfits[player.id] += player.amount * 0.9; // 1賠0.9
            } else {
                playerProfits[player.id] -= player.amount;
            }
        });
    });

    // 大小投注 (賠率 1:0.9)，39莊家通吃
    let winningBigSmall = winNum === 39 ? null : (isBig ? 'big' : (isSmall ? 'small' : null));
    ['big', 'small'].forEach(bigsmall => {
        bigSmallBets[bigsmall].players.forEach(player => {
            if (!playerProfits[player.id]) playerProfits[player.id] = 0;
            if (winningBigSmall && bigsmall === winningBigSmall) {
                playerProfits[player.id] += player.amount * 0.9; // 1賠0.9
            } else {
                playerProfits[player.id] -= player.amount;
            }
        });
    });

    // 顏色投注（紅藍綠）1賠1.8
    ['red', 'blue', 'green'].forEach(color => {
        colorBets[color].players.forEach(player => {
            if (!playerProfits[player.id]) playerProfits[player.id] = 0;
            if (color === winningColor) {
                playerProfits[player.id] += player.amount * 1.8; // 1賠1.8
            } else {
                playerProfits[player.id] -= player.amount;
            }
        });
    });

    return playerProfits;
}

// 派彩給中獎玩家
async function payoutWinners(winningNumber) {
    const winNum = parseInt(winningNumber);
    const isOdd = winNum % 2 === 1;
    const isBig = winNum >= 20 && winNum <= 38;
    const isSmall = winNum >= 1 && winNum <= 19;
    const winningColor = getNumberColor(winNum);
    const colorNames = { red: '紅', blue: '藍', green: '綠' };

    // 號碼投注派彩
    const winningBets = bets[winningNumber];
    if (winningBets && winningBets.players.length > 0) {
        for (const player of winningBets.players) {
            const payout = player.amount * 36;
            await db.updateBalance(player.id, payout);
            console.log(`號碼派彩: ${player.name} 投注 $${player.amount}, 獲得 $${payout}`);
        }
    }

    // 顏色投注派彩（1賠1.8含本金，即 x2.8）
    const winningColorBets = colorBets[winningColor];
    if (winningColorBets && winningColorBets.players.length > 0) {
        for (const player of winningColorBets.players) {
            const payout = player.amount * 2.8;
            await db.updateBalance(player.id, payout);
            console.log(`顏色派彩: ${player.name} 投注${colorNames[winningColor]} $${player.amount}, 獲得 $${payout}`);
        }
    }

    // 單雙投注派彩 (賠率 1:0.9，含本金 x1.9)
    if (winNum !== 39) {
        const winningOddEven = isOdd ? 'odd' : 'even';
        const winningOddEvenBets = oddEvenBets[winningOddEven];
        if (winningOddEvenBets && winningOddEvenBets.players.length > 0) {
            for (const player of winningOddEvenBets.players) {
                const payout = player.amount * 1.9;
                await db.updateBalance(player.id, payout);
                console.log(`單雙派彩: ${player.name} 投注${isOdd ? '單' : '雙'} $${player.amount}, 獲得 $${payout}`);
            }
        }

        // 大小投注派彩 (賠率 1:0.9，含本金 x1.9)
        const winningBigSmall = isBig ? 'big' : (isSmall ? 'small' : null);
        if (winningBigSmall) {
            const winningBigSmallBets = bigSmallBets[winningBigSmall];
            if (winningBigSmallBets && winningBigSmallBets.players.length > 0) {
                for (const player of winningBigSmallBets.players) {
                    const payout = player.amount * 1.9;
                    await db.updateBalance(player.id, payout);
                    console.log(`大小派彩: ${player.name} 投注${isBig ? '大' : '小'} $${player.amount}, 獲得 $${payout}`);
                }
            }
        }
    } else {
        console.log('39 莊家通吃，單雙大小投注不派彩');
    }
}

// 更新所有已登入玩家的餘額
async function updateAllPlayerBalances() {
    for (let memberId in sessions) {
        const member = await db.getMember(parseInt(memberId));
        if (member) {
            mqttClient.publish(TOPICS.BALANCE_UPDATE + memberId, JSON.stringify({
                balance: member.balance
            }));
        }
    }
}

// 創建 HTTP 伺服器（提供靜態檔案）
const server = http.createServer(async (req, res) => {
    // 處理 API 請求
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                const result = await db.login(username, password);

                if (result.success) {
                    const memberId = result.member.id;
                    if (sessions[memberId]) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            message: '此帳號已在其他裝置登入中'
                        }));
                        return;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '系統錯誤' }));
            }
        });
        return;
    }

    // 處理斷線 API（用於 navigator.sendBeacon）
    if (req.url === '/api/disconnect' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { memberId, clientId } = JSON.parse(body);
                if (memberId && sessions[memberId]) {
                    delete sessions[memberId];
                    onlineCount = Math.max(0, onlineCount - 1);
                    console.log(`會員斷線 (HTTP): ID ${memberId}`);
                    broadcastAdminUpdate();
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false }));
            }
        });
        return;
    }

    // 處理靜態檔案
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);

    const extname = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
    };

    const contentType = contentTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            // 對 HTML 檔案注入 CHANNEL_ID
            if (extname === '.html') {
                let html = data.toString();
                // 在 <head> 後注入 CHANNEL_ID 設定
                html = html.replace('<head>', `<head>\n    <script>window.CHANNEL_ID = "${CHANNEL_ID}";</script>`);
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(html);
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(data);
            }
        }
    });
});

// 啟動伺服器
async function startServer() {
    try {
        // 初始化資料庫
        await db.initDatabase();

        // 連接 MQTT
        connectMQTT();

        // 啟動 HTTP 伺服器
        // Port 可透過環境變數或命令列參數設定
        const PORT = process.env.PORT ||
            process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] ||
            3000;

        server.listen(PORT, () => {
            console.log(`\n========== ${CHANNEL_ID.toUpperCase()} 系統啟動 ==========`);
            console.log(`HTTP 伺服器: http://localhost:${PORT}`);
            console.log(`手機登入: http://localhost:${PORT}/login.html`);
            console.log(`管理後台: http://localhost:${PORT}/admin.html`);
            console.log(`MQTT 頻道: ${CHANNEL_PREFIX}`);
            console.log('\n=== 測試帳號 ===');
            console.log('帳號: player001 ~ player100');
            console.log('密碼: 1234');
            console.log('================\n');
            console.log('MQTT 伺服器:', MQTT_BROKER);
            console.log('等待客戶端連線以啟動遊戲...\n');
        });

        // 定時清除舊資料（每天凌晨3點）
        setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 3 && now.getMinutes() === 0) {
                await db.cleanOldRecords();
            }
        }, 60000);

    } catch (error) {
        console.error('伺服器啟動失敗:', error);
        process.exit(1);
    }
}

startServer();
