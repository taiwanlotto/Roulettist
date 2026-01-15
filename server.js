// MQTT 伺服器 - 處理玩家投注和會員登入
const mqtt = require('mqtt');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./database');

// MQTT 連線設定
const MQTT_BROKER = 'wss://tw5399.com:9002';
const MQTT_OPTIONS = {
    username: 'palee',
    password: '888168',
    clientId: 'roulette_server_' + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 30000,
    rejectUnauthorized: false  // 跳過自簽名憑證驗證
};

// MQTT 主題
const TOPICS = {
    GAME_STATE: 'roulette/game/state',           // 遊戲狀態（期數、階段、秒數）
    GAME_RESULT: 'roulette/game/result',         // 開獎結果
    BETS_UPDATE: 'roulette/bets/update',         // 投注更新
    PLAYER_BET: 'roulette/player/bet',           // 玩家投注（客戶端發送）
    PLAYER_LOGIN: 'roulette/player/login',       // 玩家登入（客戶端發送）
    PLAYER_RESULT: 'roulette/player/result/',    // 個人結果（加上memberId）
    ADMIN_DATA: 'roulette/admin/data',           // 管理員資料
    ADMIN_RECHARGE: 'roulette/admin/recharge',   // 管理員充值
    ADMIN_QUERY: 'roulette/admin/query',         // 管理員查詢
    BALANCE_UPDATE: 'roulette/balance/',         // 餘額更新（加上memberId）
};

// 儲存所有投注資料
let bets = {}; // { number: { total: 0, players: [] } }
let oddEvenBets = { odd: { total: 0, players: [] }, even: { total: 0, players: [] } };
let bigSmallBets = { big: { total: 0, players: [] }, small: { total: 0, players: [] } };
let sessions = {}; // 儲存已登入的會員 session
let currentPhase = 'stop'; // stop, betting, spinning
let lastWinningNumber = null;
let currentRoundNumber = null;
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
}

initBets();

// 連接 MQTT
function connectMQTT() {
    console.log('正在連接 MQTT 伺服器:', MQTT_BROKER);

    mqttClient = mqtt.connect(MQTT_BROKER, MQTT_OPTIONS);

    mqttClient.on('connect', () => {
        console.log('MQTT 連線成功');

        // 訂閱需要監聽的主題
        mqttClient.subscribe([
            TOPICS.PLAYER_BET,
            TOPICS.PLAYER_LOGIN,
            TOPICS.ADMIN_RECHARGE,
            TOPICS.ADMIN_QUERY,
            'roulette/client/connect',
            'roulette/client/disconnect'
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
    if (topic === 'roulette/client/connect') {
        onlineCount++;
        console.log(`客戶端連線，目前在線: ${onlineCount}`);
        // 有人上線就啟動遊戲
        if (!gameRunning) {
            startGame();
        }
        return;
    }

    // 客戶端斷線
    if (topic === 'roulette/client/disconnect') {
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
            mqttClient.publish(`roulette/login/response/${clientId}`, JSON.stringify({
                success: false,
                message: '此帳號已在其他裝置登入中'
            }));
            console.log(`會員 ${result.member.name} 嘗試重複登入，已拒絕`);
            return;
        }

        sessions[memberId] = { clientId, name: result.member.name };

        mqttClient.publish(`roulette/login/response/${clientId}`, JSON.stringify({
            success: true,
            member: result.member
        }));

        console.log(`會員登入: ${result.member.name} (${result.member.username})`);
        broadcastAdminUpdate();
    } else {
        mqttClient.publish(`roulette/login/response/${data.clientId}`, JSON.stringify({
            success: false,
            message: result.message
        }));
    }
}

// 處理投注
async function handleBet(data) {
    const { memberId, betType, target, amount, clientId } = data;

    // 檢查是否已登入
    if (!sessions[memberId]) {
        mqttClient.publish(`roulette/bet/response/${clientId}`, JSON.stringify({
            success: false,
            message: '請先登入'
        }));
        return;
    }

    // 檢查是否在投注期
    if (currentPhase !== 'betting') {
        mqttClient.publish(`roulette/bet/response/${clientId}`, JSON.stringify({
            success: false,
            message: currentPhase === 'stop' ? '停止期，正在結算中' : '已停止下注，請等待開獎'
        }));
        return;
    }

    // 檢查餘額
    const hasBalance = await db.checkBalance(memberId, amount);
    if (!hasBalance) {
        mqttClient.publish(`roulette/bet/response/${clientId}`, JSON.stringify({
            success: false,
            message: '餘額不足'
        }));
        return;
    }

    const member = await db.getMember(memberId);
    let betTarget = target;
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
    }

    // 扣除餘額
    const balanceResult = await db.updateBalance(memberId, -amount);

    // 儲存押注記錄
    await db.addBetRecord(memberId, currentRoundNumber, betType, target, amount);

    // 發送投注成功訊息
    mqttClient.publish(`roulette/bet/response/${clientId}`, JSON.stringify({
        success: true,
        target: displayTarget,
        amount,
        balance: balanceResult.balance
    }));

    console.log(`投注: ${displayTarget} + ${amount} (會員: ${member.name})`);

    // 廣播投注更新
    broadcastBetsUpdate();
}

// 處理充值
async function handleRecharge(data) {
    const { memberId, amount, operator, remark, requestId } = data;

    const result = await db.rechargeMember(memberId, amount, operator, remark);

    mqttClient.publish(`roulette/admin/recharge/response/${requestId}`, JSON.stringify(result));

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

    mqttClient.publish(`roulette/admin/query/response/${requestId}`, JSON.stringify(result));
}

// 發布遊戲狀態
function publishGameState() {
    if (!mqttClient || !mqttClient.connected) return;

    // 計算倒數秒數
    const nowSeconds = new Date().getSeconds();
    let countdown;

    // 0-10秒: stop 停止期，倒數到 11 秒進入投注期
    // 11-50秒: betting 投注期，倒數到 51 秒停止
    // 51-59秒: spinning 開獎期，倒數到 0 秒結算
    if (nowSeconds >= 0 && nowSeconds <= 10) {
        countdown = 10 - nowSeconds; // 停止期剩餘秒數
    } else if (nowSeconds >= 11 && nowSeconds <= 50) {
        countdown = 50 - nowSeconds; // 投注期剩餘秒數
    } else {
        countdown = 59 - nowSeconds + 1; // 開獎期剩餘秒數
    }

    const state = {
        phase: currentPhase,
        roundNumber: currentRoundNumber,
        seconds: countdown,
        gameRunning
    };

    mqttClient.publish(TOPICS.GAME_STATE, JSON.stringify(state), { retain: true });
}

// 廣播投注更新
function broadcastBetsUpdate() {
    if (!mqttClient || !mqttClient.connected) return;

    mqttClient.publish(TOPICS.BETS_UPDATE, JSON.stringify({
        bets,
        oddEvenBets,
        bigSmallBets
    }));
}

// 廣播管理員資料
async function broadcastAdminUpdate() {
    if (!mqttClient || !mqttClient.connected) return;

    const members = await db.getAllMembers();
    const onlinePlayers = Object.keys(sessions).map(id => parseInt(id));
    const systemStats = await db.getSystemProfitStats(1); // 當天統計

    mqttClient.publish(TOPICS.ADMIN_DATA, JSON.stringify({
        members,
        onlinePlayers,
        bets,
        oddEvenBets,
        bigSmallBets,
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
                const randomNum = Math.floor(Math.random() * 39) + 1;
                const winningNumber = randomNum.toString().padStart(2, '0');
                lastWinningNumber = winningNumber;

                console.log(`\n=== 輪盤開始轉動，目標號碼: ${winningNumber} ===`);

                mqttClient.publish(TOPICS.GAME_RESULT, JSON.stringify({
                    type: 'spin_wheel',
                    winningNumber,
                    roundNumber: currentRoundNumber
                }));
            }

            // 進入停止期時自動開獎結算
            if (oldPhase === 'spinning' && currentPhase === 'stop') {
                await handleGameResult(lastWinningNumber);
            }

            // 進入投注期時重置所有投注
            if (oldPhase !== 'betting' && currentPhase === 'betting') {
                console.log('\n=== 新一局開始（自動重置）===');
                initBets();

                mqttClient.publish(TOPICS.BETS_UPDATE, JSON.stringify({
                    type: 'new_round',
                    bets,
                    oddEvenBets,
                    bigSmallBets,
                    roundNumber: currentRoundNumber
                }));

                console.log('投注已重置，開放下注\n');
            }

            broadcastAdminUpdate();
        }
    }, 1000);
}

// 處理開獎結算
async function handleGameResult(winningNumber) {
    console.log(`\n=== 開獎結算: ${winningNumber} 期數: ${currentRoundNumber} ===`);

    const result = calculateGameResult(winningNumber);
    const playerProfits = calculatePlayerProfits(winningNumber);

    // 更新資料庫押注結果
    await db.updateBetRecordResult(currentRoundNumber, winningNumber);

    // 儲存開獎結果
    await db.saveGameResult(
        currentRoundNumber,
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
            roundNumber: currentRoundNumber
        }));
    }

    // 廣播結果
    mqttClient.publish(TOPICS.GAME_RESULT, JSON.stringify({
        type: 'game_result',
        result,
        roundNumber: currentRoundNumber
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

    const winNum = parseInt(winningNumber);
    const isOdd = winNum % 2 === 1;
    const isBig = winNum >= 20 && winNum <= 39;
    const isSmall = winNum >= 1 && winNum <= 19;

    // 計算號碼投注派彩 (賠率 35:1，返還本金所以 x36)
    const winningBets = bets[winningNumber] || { total: 0, players: [] };
    let totalPayout = winningBets.total * 36;

    // 計算單雙投注派彩 (賠率 1:1，返還本金所以 x2)
    if (isOdd) {
        totalPayout += oddEvenBets.odd.total * 2;
    } else {
        totalPayout += oddEvenBets.even.total * 2;
    }

    // 計算大小投注派彩 (賠率 1:1，返還本金所以 x2)
    if (isBig) {
        totalPayout += bigSmallBets.big.total * 2;
    } else if (isSmall) {
        totalPayout += bigSmallBets.small.total * 2;
    }

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

    // 單雙投注
    let winningOddEven = winNum === 39 ? null : (isOdd ? 'odd' : 'even');
    ['odd', 'even'].forEach(oddeven => {
        oddEvenBets[oddeven].players.forEach(player => {
            if (!playerProfits[player.id]) playerProfits[player.id] = 0;
            if (winningOddEven && oddeven === winningOddEven) {
                playerProfits[player.id] += player.amount;
            } else {
                playerProfits[player.id] -= player.amount;
            }
        });
    });

    // 大小投注
    let winningBigSmall = winNum === 39 ? null : (isBig ? 'big' : (isSmall ? 'small' : null));
    ['big', 'small'].forEach(bigsmall => {
        bigSmallBets[bigsmall].players.forEach(player => {
            if (!playerProfits[player.id]) playerProfits[player.id] = 0;
            if (winningBigSmall && bigsmall === winningBigSmall) {
                playerProfits[player.id] += player.amount;
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

    // 號碼投注派彩
    const winningBets = bets[winningNumber];
    if (winningBets && winningBets.players.length > 0) {
        for (const player of winningBets.players) {
            const payout = player.amount * 36;
            await db.updateBalance(player.id, payout);
            console.log(`號碼派彩: ${player.name} 投注 $${player.amount}, 獲得 $${payout}`);
        }
    }

    // 單雙投注派彩
    if (winNum !== 39) {
        const winningOddEven = isOdd ? 'odd' : 'even';
        const winningOddEvenBets = oddEvenBets[winningOddEven];
        if (winningOddEvenBets && winningOddEvenBets.players.length > 0) {
            for (const player of winningOddEvenBets.players) {
                const payout = player.amount * 2;
                await db.updateBalance(player.id, payout);
                console.log(`單雙派彩: ${player.name} 投注${isOdd ? '單' : '雙'} $${player.amount}, 獲得 $${payout}`);
            }
        }

        // 大小投注派彩
        const winningBigSmall = isBig ? 'big' : (isSmall ? 'small' : null);
        if (winningBigSmall) {
            const winningBigSmallBets = bigSmallBets[winningBigSmall];
            if (winningBigSmallBets && winningBigSmallBets.players.length > 0) {
                for (const player of winningBigSmallBets.players) {
                    const payout = player.amount * 2;
                    await db.updateBalance(player.id, payout);
                    console.log(`大小派彩: ${player.name} 投注${isBig ? '大' : '小'} $${player.amount}, 獲得 $${payout}`);
                }
            }
        }
    } else {
        console.log('39 莊家通殺，單雙大小投注不派彩');
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
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
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
        const PORT = 3000;
        server.listen(PORT, () => {
            console.log(`HTTP 伺服器運行於 http://localhost:${PORT}`);
            console.log(`手機登入頁面: http://localhost:${PORT}/login.html`);
            console.log(`管理員頁面: http://localhost:${PORT}/admin.html`);
            console.log('\n=== 測試帳號 ===');
            console.log('帳號: player01 ~ player10');
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
