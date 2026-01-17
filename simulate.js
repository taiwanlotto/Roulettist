// 模擬多人下注腳本 - 含報表輸出
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 取得本機 IP
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// 頻道 ID（可透過命令列參數設定，或使用本機 IP）
// 使用方式: node simulate.js --channel=192.168.1.100
const CHANNEL_ID = process.argv.find(arg => arg.startsWith('--channel='))?.split('=')[1] || getLocalIP();
const CHANNEL_PREFIX = `roulette/${CHANNEL_ID}`;

console.log(`系統頻道: ${CHANNEL_ID}`);

const MQTT_BROKER = 'wss://tw5399.com:9002';
const MQTT_OPTIONS = {
    username: 'palee',
    password: '888168',
    clientId: `simulator_${CHANNEL_ID}_` + Math.random().toString(16).substr(2, 8),
    clean: true,
    rejectUnauthorized: false
};

// 模擬設定
const PLAYER_COUNT = 30;           // 模擬玩家數量
const SIMULATION_MINUTES = 10;     // 模擬時間（分鐘）
const BET_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];  // 下注金額選項

// 下注目標
const NUMBER_TARGETS = [];
for (let i = 1; i <= 39; i++) {
    NUMBER_TARGETS.push(i.toString().padStart(2, '0'));
}
const ODDEVEN_TARGETS = ['odd', 'even'];
const BIGSMALL_TARGETS = ['big', 'small'];
const COLOR_TARGETS = ['red', 'blue', 'green'];

let mqttClient = null;
let currentPhase = 'stop';
let currentRoundNumber = '';
let simulationActive = true;

// 統計資料
let stats = {
    startTime: new Date(),
    endTime: null,
    totalBets: 0,
    totalAmount: 0,
    totalRounds: 0,
    roundStats: [],
    playerStats: {},
    betDetails: []
};

// 當前期的下注
let currentRoundBets = [];

// 模擬玩家
const players = [];
for (let i = 1; i <= PLAYER_COUNT; i++) {
    const playerId = i;
    const playerNum = i.toString().padStart(3, '0');
    players.push({
        id: playerId,
        username: `player${playerNum}`,
        name: `玩家${playerNum}`
    });
    stats.playerStats[playerId] = {
        name: `玩家${playerNum}`,
        bets: 0,
        totalBet: 0,
        wins: 0,
        losses: 0,
        profit: 0
    };
}

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTargetDisplay(type, target) {
    if (type === 'number') return target;
    if (target === 'odd') return '單';
    if (target === 'even') return '雙';
    if (target === 'big') return '大';
    if (target === 'small') return '小';
    if (target === 'red') return '紅';
    if (target === 'blue') return '藍';
    if (target === 'green') return '綠';
    return target;
}

// 取得號碼對應的顏色
function getNumberColor(num) {
    const n = parseInt(num);
    const colorIndex = n % 3;
    if (colorIndex === 0) return 'blue';  // 3,6,9,12,15,18...
    if (colorIndex === 1) return 'green'; // 1,4,7,10,13,16...
    return 'red'; // colorIndex === 2 (2,5,8,11,14,17...)
}

function placeBet(player) {
    if (!mqttClient || !mqttClient.connected || currentPhase !== 'betting') return;

    // 隨機選擇下注類型（號碼40%、單雙20%、大小20%、顏色20%）
    const rand = Math.random();
    let target, type;

    if (rand < 0.4) {
        target = randomChoice(NUMBER_TARGETS);
        type = 'number';
    } else if (rand < 0.6) {
        target = randomChoice(ODDEVEN_TARGETS);
        type = 'oddeven';
    } else if (rand < 0.8) {
        target = randomChoice(BIGSMALL_TARGETS);
        type = 'bigsmall';
    } else {
        target = randomChoice(COLOR_TARGETS);
        type = 'color';
    }

    const amount = randomChoice(BET_AMOUNTS);
    const timestamp = new Date();

    const betData = {
        memberId: player.id,
        memberName: player.name,
        type: type,
        target: target,
        amount: amount
    };

    mqttClient.publish(`${CHANNEL_PREFIX}/player/bet`, JSON.stringify(betData));

    // 記錄下注
    const betRecord = {
        time: timestamp.toLocaleTimeString(),
        roundNumber: currentRoundNumber,
        playerId: player.id,
        playerName: player.name,
        type: type,
        target: target,
        targetDisplay: getTargetDisplay(type, target),
        amount: amount,
        result: 'pending',
        profit: 0
    };

    currentRoundBets.push(betRecord);
    stats.betDetails.push(betRecord);
    stats.totalBets++;
    stats.totalAmount += amount;
    stats.playerStats[player.id].bets++;
    stats.playerStats[player.id].totalBet += amount;

    console.log(`[${timestamp.toLocaleTimeString()}] ${player.name} 下注 ${betRecord.targetDisplay} $${amount}`);
}

function calculateResult(bet, winningNumber) {
    const winNum = parseInt(winningNumber);
    let win = false;

    if (bet.type === 'number') {
        win = bet.target === winningNumber;
    } else if (bet.type === 'oddeven') {
        const isOdd = winNum % 2 === 1;
        win = (bet.target === 'odd' && isOdd) || (bet.target === 'even' && !isOdd);
    } else if (bet.type === 'bigsmall') {
        const isBig = winNum >= 20;
        win = (bet.target === 'big' && isBig) || (bet.target === 'small' && !isBig);
    } else if (bet.type === 'color') {
        const winningColor = getNumberColor(winningNumber);
        win = bet.target === winningColor;
    }

    if (win) {
        let odds;
        if (bet.type === 'number') odds = 36;      // 1賠36（含本金）
        else if (bet.type === 'color') odds = 2.8;  // 1賠1.8（含本金）
        else odds = 2;                              // 1賠2（含本金）
        return { result: 'win', profit: bet.amount * (odds - 1) };
    } else {
        return { result: 'lose', profit: -bet.amount };
    }
}

function processRoundResult(winningNumber) {
    let roundProfit = 0;
    let roundBets = 0;
    let roundAmount = 0;

    currentRoundBets.forEach(bet => {
        const result = calculateResult(bet, winningNumber);
        bet.result = result.result;
        bet.profit = result.profit;
        roundProfit += result.profit;
        roundBets++;
        roundAmount += bet.amount;

        // 更新玩家統計
        const ps = stats.playerStats[bet.playerId];
        ps.profit += result.profit;
        if (result.result === 'win') {
            ps.wins++;
        } else {
            ps.losses++;
        }
    });

    if (currentRoundBets.length > 0) {
        stats.totalRounds++;
        stats.roundStats.push({
            roundNumber: currentRoundNumber,
            winningNumber: winningNumber,
            bets: roundBets,
            totalBet: roundAmount,
            payout: roundAmount + roundProfit,
            systemProfit: -roundProfit
        });
    }

    console.log(`\n>>> 本期結果: 開獎 ${winningNumber}, 下注 ${roundBets} 筆, 總額 $${roundAmount}, 系統損益 $${-roundProfit}\n`);

    currentRoundBets = [];
}

function simulateBets() {
    if (!simulationActive || currentPhase !== 'betting') return;

    // 隨機選擇 2-8 個玩家下注
    const numBets = randomInt(2, 8);
    const selectedPlayers = new Set();

    while (selectedPlayers.size < numBets) {
        selectedPlayers.add(randomChoice(players));
    }

    let delay = 0;
    selectedPlayers.forEach(player => {
        setTimeout(() => placeBet(player), delay);
        delay += randomInt(200, 800);
    });
}

function generateReport() {
    stats.endTime = new Date();
    const duration = Math.round((stats.endTime - stats.startTime) / 1000 / 60 * 10) / 10;

    let report = '';
    report += '════════════════════════════════════════════════════════════\n';
    report += '                    模擬下注報表\n';
    report += '════════════════════════════════════════════════════════════\n\n';

    report += `【基本資訊】\n`;
    report += `  開始時間: ${stats.startTime.toLocaleString()}\n`;
    report += `  結束時間: ${stats.endTime.toLocaleString()}\n`;
    report += `  模擬時長: ${duration} 分鐘\n`;
    report += `  模擬玩家: ${PLAYER_COUNT} 人\n\n`;

    report += `【總計統計】\n`;
    report += `  總期數: ${stats.totalRounds} 期\n`;
    report += `  總下注筆數: ${stats.totalBets} 筆\n`;
    report += `  總下注金額: $${stats.totalAmount.toLocaleString()}\n`;
    const totalSystemProfit = stats.roundStats.reduce((sum, r) => sum + r.systemProfit, 0);
    report += `  系統總損益: $${totalSystemProfit.toLocaleString()}\n\n`;

    report += '────────────────────────────────────────────────────────────\n';
    report += '【各期開獎記錄】\n';
    report += '────────────────────────────────────────────────────────────\n';
    report += '  期數          開獎  下注數  總金額      系統損益\n';
    stats.roundStats.forEach(r => {
        report += `  ${r.roundNumber}  ${r.winningNumber}    ${r.bets.toString().padStart(3)}筆   $${r.totalBet.toString().padStart(8)}  $${r.systemProfit.toString().padStart(8)}\n`;
    });

    report += '\n────────────────────────────────────────────────────────────\n';
    report += '【玩家損益排行】\n';
    report += '────────────────────────────────────────────────────────────\n';
    report += '  玩家        下注數  總下注      勝/負     損益\n';

    const playerRanking = Object.values(stats.playerStats)
        .filter(p => p.bets > 0)
        .sort((a, b) => b.profit - a.profit);

    playerRanking.forEach(p => {
        const profitStr = p.profit >= 0 ? `+$${p.profit}` : `-$${Math.abs(p.profit)}`;
        report += `  ${p.name}    ${p.bets.toString().padStart(3)}筆   $${p.totalBet.toString().padStart(8)}  ${p.wins}/${p.losses}    ${profitStr.padStart(10)}\n`;
    });

    report += '\n────────────────────────────────────────────────────────────\n';
    report += '【詳細下注記錄】\n';
    report += '────────────────────────────────────────────────────────────\n';
    report += '  時間      期數          玩家        目標    金額      結果    損益\n';

    stats.betDetails.forEach(b => {
        const resultStr = b.result === 'win' ? '中獎' : '未中';
        const profitStr = b.profit >= 0 ? `+$${b.profit}` : `-$${Math.abs(b.profit)}`;
        report += `  ${b.time}  ${b.roundNumber}  ${b.playerName}  ${b.targetDisplay.padStart(4)}  $${b.amount.toString().padStart(5)}  ${resultStr}  ${profitStr.padStart(8)}\n`;
    });

    report += '\n════════════════════════════════════════════════════════════\n';
    report += '                      報表結束\n';
    report += '════════════════════════════════════════════════════════════\n';

    return report;
}

function saveReport() {
    const report = generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `simulation_report_${timestamp}.txt`;
    const filepath = path.join(__dirname, 'reports', filename);

    // 確保 reports 目錄存在
    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir);
    }

    fs.writeFileSync(filepath, report, 'utf8');
    console.log(`\n報表已儲存: ${filepath}`);

    // 也輸出到 console
    console.log('\n' + report);
}

function connect() {
    console.log('════════════════════════════════════════');
    console.log('       模擬多人下注系統 v2.0');
    console.log('════════════════════════════════════════');
    console.log(`  模擬玩家數: ${PLAYER_COUNT} 人`);
    console.log(`  模擬時間: ${SIMULATION_MINUTES} 分鐘`);
    console.log(`  下注金額: ${BET_AMOUNTS.join(', ')}`);
    console.log('════════════════════════════════════════\n');

    mqttClient = mqtt.connect(MQTT_BROKER, MQTT_OPTIONS);

    mqttClient.on('connect', () => {
        console.log('[系統] MQTT 連線成功，等待遊戲開始...\n');
        mqttClient.subscribe(`${CHANNEL_PREFIX}/game/state`);
        mqttClient.subscribe(`${CHANNEL_PREFIX}/game/result`);

        // 設定結束時間
        setTimeout(() => {
            simulationActive = false;
            console.log('\n[系統] 模擬時間到，正在產生報表...');
            setTimeout(() => {
                saveReport();
                setTimeout(() => process.exit(0), 1000);
            }, 3000);
        }, SIMULATION_MINUTES * 60 * 1000);
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());

            if (topic === `${CHANNEL_PREFIX}/game/state`) {
                const oldPhase = currentPhase;
                currentPhase = data.phase;
                if (data.roundNumber) {
                    currentRoundNumber = data.roundNumber;
                }

                if (oldPhase !== 'betting' && currentPhase === 'betting') {
                    console.log(`\n══════ 第 ${currentRoundNumber} 期 開放下注 ══════\n`);
                    // 投注期間每 1-2 秒模擬一批下注
                    const betInterval = setInterval(() => {
                        if (currentPhase !== 'betting' || !simulationActive) {
                            clearInterval(betInterval);
                        } else {
                            simulateBets();
                        }
                    }, randomInt(1000, 2000));
                }

                if (currentPhase === 'spinning' && oldPhase === 'betting') {
                    console.log('\n>>> 停止下注，輪盤轉動中...');
                }
            }

            if (topic === `${CHANNEL_PREFIX}/game/result` && data.type === 'game_result') {
                processRoundResult(data.winningNumber);
            }
        } catch (e) {
            // ignore
        }
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT 錯誤:', err.message);
    });
}

// 啟動
connect();

// 處理 Ctrl+C
process.on('SIGINT', () => {
    console.log('\n\n[系統] 手動停止，正在產生報表...');
    simulationActive = false;
    saveReport();
    setTimeout(() => {
        if (mqttClient) mqttClient.end();
        process.exit(0);
    }, 1000);
});
