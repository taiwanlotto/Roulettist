// 輪盤選項設定 - 生成01到39的數字
const options = [];
// 三種顏色循環：紅、藍、綠
const colors = ['#DC2626', '#2563EB', '#16A34A']; // 紅色、藍色、綠色

for (let i = 1; i <= 39; i++) {
    options.push({
        text: i.toString().padStart(2, '0'),
        color: colors[(i - 1) % 3] // 循環使用三種顏色，從0開始索引
    });
}

// 音效系統
let audioContext = null;
let spinSound = null;
let audioInitialized = false;
let soundEnabled = true; // 音效開關
let masterVolume = 0.7; // 主音量 (0-1)

// 初始化音效系統（需要用戶互動後調用）
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 如果 AudioContext 被暫停，嘗試恢復
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    audioInitialized = true;
}

// 頁面點擊時初始化音效（解決瀏覽器自動播放限制）
document.addEventListener('click', function() {
    if (!audioInitialized) {
        initAudio();
        console.log('音效系統已初始化');
    }
}, { once: false });

// 初始化音效控制
function initSoundControls() {
    const soundToggle = document.getElementById('soundToggle');
    const soundIcon = document.getElementById('soundIcon');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');

    if (soundToggle) {
        soundToggle.addEventListener('change', function() {
            soundEnabled = this.checked;
            soundIcon.textContent = soundEnabled ? '🔊' : '🔇';
            console.log('音效: ' + (soundEnabled ? '開啟' : '關閉'));
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', function() {
            masterVolume = this.value / 100;
            volumeValue.textContent = this.value + '%';
            console.log('音量: ' + this.value + '%');
        });
    }
}

// 播放輪盤滾動音效（模擬真實輪盤）
let spinSoundTimeout = null;
let ballRollingOsc = null;
let wheelRollingOsc = null;

function playSpinSound() {
    // 檢查音效是否啟用
    if (!soundEnabled) {
        console.log('音效已關閉');
        return;
    }

    if (!audioContext) {
        initAudio();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    // 停止之前的音效
    stopSpinSound();

    try {
        const totalDuration = 8000; // 總時長 8 秒
        const startTime = Date.now();

        // 創建輪盤底層滾動聲（低頻隆隆聲）
        wheelRollingOsc = audioContext.createOscillator();
        const wheelGain = audioContext.createGain();
        const wheelFilter = audioContext.createBiquadFilter();

        wheelFilter.type = 'lowpass';
        wheelFilter.frequency.setValueAtTime(150, audioContext.currentTime);

        wheelRollingOsc.type = 'sawtooth';
        wheelRollingOsc.frequency.setValueAtTime(80, audioContext.currentTime);
        wheelRollingOsc.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 8);

        wheelRollingOsc.connect(wheelFilter);
        wheelFilter.connect(wheelGain);
        wheelGain.connect(audioContext.destination);

        // 套用主音量
        wheelGain.gain.setValueAtTime(0.08 * masterVolume, audioContext.currentTime);
        wheelGain.gain.exponentialRampToValueAtTime(0.01 * masterVolume, audioContext.currentTime + 8);

        wheelRollingOsc.start(audioContext.currentTime);
        wheelRollingOsc.stop(audioContext.currentTime + 8);

        // 播放球碰撞格子的聲音
        function playBallClick(volume, pitchVariation) {
            // 套用主音量
            const adjustedVolume = volume * masterVolume;

            // 主要碰撞聲
            const clickOsc = audioContext.createOscillator();
            const clickGain = audioContext.createGain();
            const clickFilter = audioContext.createBiquadFilter();

            clickFilter.type = 'bandpass';
            clickFilter.frequency.setValueAtTime(2000 + pitchVariation, audioContext.currentTime);
            clickFilter.Q.setValueAtTime(5, audioContext.currentTime);

            clickOsc.type = 'triangle';
            clickOsc.frequency.setValueAtTime(1200 + pitchVariation, audioContext.currentTime);
            clickOsc.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.03);

            clickOsc.connect(clickFilter);
            clickFilter.connect(clickGain);
            clickGain.connect(audioContext.destination);

            clickGain.gain.setValueAtTime(adjustedVolume, audioContext.currentTime);
            clickGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.04);

            clickOsc.start(audioContext.currentTime);
            clickOsc.stop(audioContext.currentTime + 0.04);

            // 金屬共鳴聲
            const resonanceOsc = audioContext.createOscillator();
            const resonanceGain = audioContext.createGain();

            resonanceOsc.type = 'sine';
            resonanceOsc.frequency.setValueAtTime(3500 + Math.random() * 500, audioContext.currentTime);

            resonanceOsc.connect(resonanceGain);
            resonanceGain.connect(audioContext.destination);

            resonanceGain.gain.setValueAtTime(adjustedVolume * 0.15, audioContext.currentTime);
            resonanceGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);

            resonanceOsc.start(audioContext.currentTime);
            resonanceOsc.stop(audioContext.currentTime + 0.08);
        }

        // 球滾動的節奏
        function tick() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / totalDuration;

            if (progress >= 1) {
                spinSoundTimeout = null;
                return;
            }

            // 音量隨時間減弱，但最後階段稍微增加（球跳動更明顯）
            let volume = 0.25 * (1 - progress * 0.5);
            if (progress > 0.85) {
                volume *= 1.3; // 最後球跳動聲更大
            }

            // 隨機音高變化，模擬球碰到不同格子
            const pitchVariation = (Math.random() - 0.5) * 400;

            playBallClick(volume, pitchVariation);

            // 間隔從快到慢（模擬球減速）
            // 開始：約 30ms 間隔，結束：約 500ms 間隔
            const baseInterval = 30;
            const maxInterval = 500;
            const newInterval = baseInterval + (maxInterval - baseInterval) * Math.pow(progress, 1.8);

            // 加入隨機抖動，更真實
            const jitter = newInterval * 0.15 * (Math.random() - 0.5);

            spinSoundTimeout = setTimeout(tick, newInterval + jitter);
        }

        tick();
        console.log('播放輪盤音效');
    } catch (e) {
        console.error('播放音效失敗:', e);
    }
}

// 停止輪盤音效
function stopSpinSound() {
    if (spinSoundTimeout) {
        clearTimeout(spinSoundTimeout);
        spinSoundTimeout = null;
    }
    if (ballRollingOsc) {
        try { ballRollingOsc.stop(); } catch(e) {}
        ballRollingOsc = null;
    }
    if (wheelRollingOsc) {
        try { wheelRollingOsc.stop(); } catch(e) {}
        wheelRollingOsc = null;
    }
}

// 播放開獎音效
function playResultSound() {
    // 檢查音效是否啟用
    if (!soundEnabled) {
        return;
    }

    if (!audioContext) {
        initAudio();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523, audioContext.currentTime); // C5
        oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1); // E5
        oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2); // G5

        // 套用主音量
        gainNode.gain.setValueAtTime(0.3 * masterVolume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
        console.log('播放開獎音效');
    } catch (e) {
        console.error('播放音效失敗:', e);
    }
}

// 初始化變數
let isSpinning = false;
let currentRotation = 0;
let currentSeconds = 0;
let gamePhase = 'stop'; // stop, betting, spinning
let previousPhase = 'stop'; // 追蹤上一個階段
let lastWinningNumber = null;
let lastGameResult = null;
let newRoundSent = false; // 追蹤是否已發送新一局訊息

// WebSocket 連接
let ws;
let betsData = {};
let oddEvenBetsData = { odd: { total: 0, players: [] }, even: { total: 0, players: [] } };
let bigSmallBetsData = { big: { total: 0, players: [] }, small: { total: 0, players: [] } };

// 遊戲時間設定
const PHASE_STOP_START = 0;
const PHASE_STOP_END = 10;
const PHASE_BETTING_START = 11;
const PHASE_BETTING_END = 50;
const PHASE_SPINNING_START = 51;
const PHASE_SPINNING_END = 59;

// 繪製輪盤
function createWheel() {
    const wheel = document.getElementById('wheel');
    const numberOfSections = options.length; // 39
    const anglePerSection = 360 / numberOfSections; // 每個扇形 9.23 度
    const radius = 280; // SVG 半徑

    console.log(`總區塊數: ${numberOfSections}, 每個區塊角度: ${anglePerSection.toFixed(2)}度`);

    options.forEach((option, index) => {
        // 計算起始和結束角度（SVG 中 0度在3點鐘方向，順時針）
        const startAngle = (anglePerSection * index - 90) * Math.PI / 180;
        const endAngle = (anglePerSection * (index + 1) - 90) * Math.PI / 180;

        // 計算扇形的路徑點
        const x1 = radius * Math.cos(startAngle);
        const y1 = radius * Math.sin(startAngle);
        const x2 = radius * Math.cos(endAngle);
        const y2 = radius * Math.sin(endAngle);

        // 創建 SVG path 元素
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        // 大弧標誌：對於小於180度的扇形，使用0
        const largeArcFlag = anglePerSection > 180 ? 1 : 0;

        // SVG 路徑：移動到中心 -> 直線到起點 -> 弧線到終點 -> 直線回中心
        const pathData = `M 0 0 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

        path.setAttribute('d', pathData);
        path.setAttribute('fill', option.color);
        path.setAttribute('stroke', 'rgba(212, 175, 55, 0.3)');
        path.setAttribute('stroke-width', '1');

        wheel.appendChild(path);
    });

    // 添加中心金色圓圈
    const centerCircle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerCircle1.setAttribute('cx', '0');
    centerCircle1.setAttribute('cy', '0');
    centerCircle1.setAttribute('r', '35');
    centerCircle1.setAttribute('fill', '#FFD700');
    wheel.appendChild(centerCircle1);

    const centerCircle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerCircle2.setAttribute('cx', '0');
    centerCircle2.setAttribute('cy', '0');
    centerCircle2.setAttribute('r', '20');
    centerCircle2.setAttribute('fill', '#B8860B');
    wheel.appendChild(centerCircle2);

    // 創建數字標籤（使用 SVG text 元素）
    options.forEach((option, index) => {
        // 計算數字位置（在輪盤外圈）
        // 數字位置應該在每個扇形的中心
        const angle = (anglePerSection * index + anglePerSection / 2 - 90) * Math.PI / 180;
        const labelRadius = 240; // SVG 座標系統中的半徑
        const x = labelRadius * Math.cos(angle);
        const y = labelRadius * Math.sin(angle);

        // 創建 SVG text 元素
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#FFD700');
        text.setAttribute('font-size', '20');
        text.setAttribute('font-weight', '900');
        text.setAttribute('stroke', '#000');
        text.setAttribute('stroke-width', '0.5');
        text.textContent = option.text;

        wheel.appendChild(text);
    });
}

// 根據伺服器指定的號碼轉動輪盤
function spinWheelToNumber(winningNumber) {
    if (isSpinning) return;

    isSpinning = true;
    document.getElementById('result').textContent = '';

    // 播放輪盤滾動音效
    playSpinSound();

    const wheel = document.getElementById('wheel');
    const numberOfSections = options.length;
    const anglePerSection = 360 / numberOfSections;

    // 根據開獎號碼找到對應的索引
    const targetIndex = options.findIndex(opt => opt.text === winningNumber);
    if (targetIndex === -1) {
        console.error(`找不到號碼: ${winningNumber}`);
        isSpinning = false;
        return;
    }

    lastWinningNumber = winningNumber;
    console.log(`伺服器指定開獎: index=${targetIndex}, 數字=${winningNumber}`);

    // 計算旋轉角度 (至少旋轉5圈)
    const minSpins = 5;
    const extraRotation = 360 * minSpins;

    // 計算目標角度
    const sectionCenterAngle = targetIndex * anglePerSection + anglePerSection / 2;
    const currentAngle = currentRotation % 360;
    const targetPosition = 360 - sectionCenterAngle;

    let rotationNeeded = targetPosition - currentAngle;
    if (rotationNeeded < 0) {
        rotationNeeded += 360;
    }

    console.log(`開獎號碼: ${winningNumber}, 當前角度: ${currentAngle.toFixed(2)}度, 目標位置: ${targetPosition.toFixed(2)}度`);

    const totalRotation = currentRotation + extraRotation + rotationNeeded;
    wheel.style.transform = `rotate(${totalRotation}deg)`;
    currentRotation = totalRotation;

    // 9秒後顯示結果
    setTimeout(() => {
        document.getElementById('result').textContent = `🎉 開獎號碼: ${winningNumber}`;
        playResultSound(); // 播放開獎音效
        isSpinning = false;
    }, 9000);
}

// 旋轉輪盤 (手動模式，現已改為伺服器控制)
function spinWheel() {
    if (isSpinning) return;

    isSpinning = true;
    document.getElementById('result').textContent = '';

    const wheel = document.getElementById('wheel');
    const numberOfSections = options.length;
    const anglePerSection = 360 / numberOfSections;

    // 隨機選擇一個選項
    const randomIndex = Math.floor(Math.random() * numberOfSections);
    lastWinningNumber = options[randomIndex].text;
    console.log(`隨機選中: index=${randomIndex}, 數字=${lastWinningNumber}`);

    // 計算旋轉角度 (至少旋轉5圈)
    const minSpins = 5;
    const extraRotation = 360 * minSpins;

    // 計算目標角度
    // 選中扇形的中心角度（相對於初始的 01 位置）
    const sectionCenterAngle = randomIndex * anglePerSection + anglePerSection / 2;

    // 計算當前輪盤的實際角度（取餘數，範圍 0-360）
    const currentAngle = currentRotation % 360;

    // 計算需要旋轉到的目標位置（讓選中扇形回到 0 度位置）
    const targetPosition = 360 - sectionCenterAngle;

    // 計算從當前角度到目標位置需要旋轉的角度
    let rotationNeeded = targetPosition - currentAngle;

    // 如果旋轉角度是負數，加上360度讓它變成正向旋轉
    if (rotationNeeded < 0) {
        rotationNeeded += 360;
    }

    console.log(`選中: ${lastWinningNumber}, 當前角度: ${currentAngle.toFixed(2)}度, 目標位置: ${targetPosition.toFixed(2)}度, 需旋轉: ${rotationNeeded.toFixed(2)}度`);

    // 總旋轉角度 = 當前位置 + 至少5圈 + 需要旋轉的角度
    const totalRotation = currentRotation + extraRotation + rotationNeeded;

    // 執行旋轉動畫
    wheel.style.transform = `rotate(${totalRotation}deg)`;

    // 更新當前旋轉角度（保留完整角度，不取餘數）
    currentRotation = totalRotation;

    // 通知伺服器開始轉動
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'spin_start',
            winningNumber: lastWinningNumber
        }));
    }

    // 旋轉結束後顯示結果 (9秒，因為轉動從51秒開始，到59秒結束)
    setTimeout(() => {
        document.getElementById('result').textContent = `🎉 開獎號碼: ${lastWinningNumber}`;
        isSpinning = false;

        // 通知伺服器轉動結束，計算結果
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'spin_end',
                winningNumber: lastWinningNumber
            }));
        }
    }, 9000);
}

// 更新計時器顯示 (由伺服器同步)
function updateTimerFromServer(phase, seconds) {
    const timerSeconds = document.getElementById('timerSeconds');
    const timerStatus = document.getElementById('timerStatus');
    const spinBtn = document.getElementById('spinBtn');
    const gameResult = document.getElementById('gameResult');

    // 更新秒數顯示
    if (seconds !== undefined) {
        currentSeconds = seconds;
        timerSeconds.textContent = seconds.toString().padStart(2, '0');
    }

    // 更新階段
    gamePhase = phase;

    if (phase === 'stop') {
        timerStatus.textContent = '停止期 - 結算中';
        timerStatus.className = 'timer-status stop-period';
        spinBtn.style.display = 'none';

        // 顯示上局結果
        if (lastGameResult) {
            gameResult.style.display = 'block';
        }
    } else if (phase === 'betting') {
        timerStatus.textContent = '投注期 - 開放下注';
        timerStatus.className = 'timer-status betting-period';
        spinBtn.style.display = 'none';
        gameResult.style.display = 'none';
    } else if (phase === 'spinning') {
        timerStatus.textContent = '旋轉期 - 停止下注';
        timerStatus.className = 'timer-status spinning-period';
        spinBtn.style.display = 'none';
        gameResult.style.display = 'none';
    }
}

// WebSocket 連接函數
function connectWebSocket() {
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || 3000;
    ws = new WebSocket(`ws://${host}:${port}`);

    ws.onopen = () => {
        console.log('WebSocket 已連線');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'update') {
            betsData = data.bets;
            if (data.oddEvenBets) {
                oddEvenBetsData = data.oddEvenBets;
            }
            if (data.bigSmallBets) {
                bigSmallBetsData = data.bigSmallBets;
            }
            updateBetsDisplay();
        } else if (data.type === 'new_round') {
            // 新一局開始，重置投注顯示
            betsData = data.bets;
            if (data.oddEvenBets) {
                oddEvenBetsData = data.oddEvenBets;
            } else {
                oddEvenBetsData = { odd: { total: 0, players: [] }, even: { total: 0, players: [] } };
            }
            if (data.bigSmallBets) {
                bigSmallBetsData = data.bigSmallBets;
            } else {
                bigSmallBetsData = { big: { total: 0, players: [] }, small: { total: 0, players: [] } };
            }
            updateBetsDisplay();
            document.getElementById('result').textContent = '';
            console.log('新一局開始，投注已重置');
        } else if (data.type === 'game_result') {
            lastGameResult = data.result;
            displayGameResult(data.result);
            // 顯示開獎號碼
            document.getElementById('result').textContent = `🎉 開獎號碼: ${data.result.winningNumber}`;
        } else if (data.type === 'phase_info' || data.type === 'time_sync') {
            // 從伺服器同步時間和階段
            updateTimerFromServer(data.phase, data.seconds);
        } else if (data.type === 'spin_wheel') {
            // 伺服器通知轉動輪盤
            spinWheelToNumber(data.winningNumber);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket 錯誤:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket 已斷線，3秒後重新連線...');
        setTimeout(connectWebSocket, 3000);
    };
}

// 顯示遊戲結果
function displayGameResult(result) {
    document.getElementById('winningNumber').textContent = result.winningNumber;
    document.getElementById('totalBetsAmount').textContent = `$${result.totalBets.toLocaleString()}`;
    document.getElementById('winnersCount').textContent = result.winnersCount;
    document.getElementById('payoutAmount').textContent = `$${result.totalPayout.toLocaleString()}`;

    const profitElement = document.getElementById('systemProfit');
    const profit = result.totalBets - result.totalPayout;
    profitElement.textContent = `$${profit.toLocaleString()}`;
    profitElement.className = 'result-value ' + (profit >= 0 ? 'win' : 'lose');
}

// 更新投注顯示
function updateBetsDisplay() {
    const grid = document.getElementById('betsGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= 39; i++) {
        const num = i.toString().padStart(2, '0');
        const betInfo = betsData[num] || { total: 0, players: [] };

        const item = document.createElement('div');
        item.className = 'bet-item' + (betInfo.total > 0 ? ' has-bets' : '');
        item.innerHTML = `
            <div class="bet-number">${num}</div>
            <div class="bet-total">$${betInfo.total.toLocaleString()}</div>
            <div class="bet-players">${betInfo.players.length} 人</div>
        `;
        grid.appendChild(item);
    }

    // 更新單雙投注統計
    updateOddEvenDisplay();
}

function updateOddEvenDisplay() {
    const oddStats = document.getElementById('oddStats');
    const evenStats = document.getElementById('evenStats');

    // 單投注
    const oddTotal = oddEvenBetsData.odd ? oddEvenBetsData.odd.total : 0;
    const oddPlayers = oddEvenBetsData.odd ? oddEvenBetsData.odd.players.length : 0;
    document.getElementById('oddTotal').textContent = oddTotal.toLocaleString();
    document.getElementById('oddPlayers').textContent = oddPlayers;
    oddStats.className = 'odd-even-item' + (oddTotal > 0 ? ' has-bets' : '');

    // 雙投注
    const evenTotal = oddEvenBetsData.even ? oddEvenBetsData.even.total : 0;
    const evenPlayers = oddEvenBetsData.even ? oddEvenBetsData.even.players.length : 0;
    document.getElementById('evenTotal').textContent = evenTotal.toLocaleString();
    document.getElementById('evenPlayers').textContent = evenPlayers;
    evenStats.className = 'odd-even-item' + (evenTotal > 0 ? ' has-bets' : '');

    // 大小投注
    updateBigSmallDisplay();
}

function updateBigSmallDisplay() {
    // 小投注
    const smallTotal = bigSmallBetsData.small ? bigSmallBetsData.small.total : 0;
    const smallPlayers = bigSmallBetsData.small ? bigSmallBetsData.small.players.length : 0;
    document.getElementById('smallTotal').textContent = smallTotal.toLocaleString();
    document.getElementById('smallPlayers').textContent = smallPlayers;

    // 大投注
    const bigTotal = bigSmallBetsData.big ? bigSmallBetsData.big.total : 0;
    const bigPlayers = bigSmallBetsData.big ? bigSmallBetsData.big.players.length : 0;
    document.getElementById('bigTotal').textContent = bigTotal.toLocaleString();
    document.getElementById('bigPlayers').textContent = bigPlayers;
}

function resetBets() {
    if (confirm('確定要重置所有投注嗎？')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'reset' }));
        }
    }
}

// 生成 QR Code
function generateQRCode() {
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || 3000;
    const url = `http://${host}:${port}/login.html`;

    new QRCode(document.getElementById('qrcode'), {
        text: url,
        width: 128,
        height: 128,
        colorDark: '#667eea',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    createWheel();
    document.getElementById('spinBtn').addEventListener('click', spinWheel);
    generateQRCode();
    connectWebSocket();
    updateBetsDisplay();
    initSoundControls(); // 初始化音效控制
    // 計時器由伺服器同步，不需要本地計時器
});
