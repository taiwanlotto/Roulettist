// MySQL 資料庫連接
const mysql = require('mysql2/promise');

// MySQL 連線設定
const dbConfig = {
    host: '127.0.0.1',
    user: 'root',
    password: 'win16888@',
    database: 'roulettist',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool = null;

// 計算期數 (格式: MMDDHHMM, 期數為當天的第幾分鐘+1)
function calculateRoundNumber() {
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours();
    const minute = now.getMinutes();
    const roundNum = hour * 60 + minute + 1; // 從第1期開始
    return `${month}${day}${roundNum.toString().padStart(4, '0')}`;
}

// 取得今天日期字串 YYYY-MM-DD
function getTodayDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

// 初始化資料庫連線池
async function initDatabase() {
    try {
        // 先建立不指定資料庫的連線來建立資料庫
        const tempConnection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });

        // 建立資料庫（如果不存在）
        await tempConnection.execute(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await tempConnection.end();

        // 建立連線池
        pool = mysql.createPool(dbConfig);

        // 建立會員資料表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(100) NOT NULL,
                balance DECIMAL(15, 2) DEFAULT 10000,
                status ENUM('active', 'inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 建立押注記錄表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS bet_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                member_id INT NOT NULL,
                round_number VARCHAR(20) NOT NULL,
                bet_type ENUM('number', 'oddeven', 'bigsmall', 'color') NOT NULL,
                bet_target VARCHAR(10) NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                winning_number VARCHAR(5) DEFAULT NULL,
                profit DECIMAL(15, 2) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_member_id (member_id),
                INDEX idx_round_number (round_number),
                INDEX idx_created_at (created_at),
                FOREIGN KEY (member_id) REFERENCES members(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 如果資料表已存在，嘗試修改 bet_type 欄位以支援 color
        try {
            await pool.execute(`
                ALTER TABLE bet_records MODIFY COLUMN bet_type ENUM('number', 'oddeven', 'bigsmall', 'color') NOT NULL
            `);
        } catch (alterError) {
            // 如果已經是正確的類型，忽略錯誤
        }

        // 建立開獎記錄表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS game_results (
                id INT AUTO_INCREMENT PRIMARY KEY,
                round_number VARCHAR(20) NOT NULL UNIQUE,
                winning_number VARCHAR(5) NOT NULL,
                total_bets DECIMAL(15, 2) DEFAULT 0,
                total_payout DECIMAL(15, 2) DEFAULT 0,
                system_profit DECIMAL(15, 2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_round_number (round_number),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 建立充值記錄表
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS recharge_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                member_id INT NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                balance_before DECIMAL(15, 2) NOT NULL,
                balance_after DECIMAL(15, 2) NOT NULL,
                operator VARCHAR(50) DEFAULT 'admin',
                remark VARCHAR(255) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_member_id (member_id),
                INDEX idx_created_at (created_at),
                FOREIGN KEY (member_id) REFERENCES members(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 檢查是否有會員資料，沒有則初始化
        const [rows] = await pool.execute('SELECT COUNT(*) as count FROM members');
        if (rows[0].count === 0) {
            // 初始化 100 個測試會員
            const initialMembers = [];
            for (let i = 1; i <= 100; i++) {
                const num = i.toString().padStart(3, '0');
                const balance = 10000 + Math.floor(Math.random() * 20000); // 10000-30000 隨機餘額
                initialMembers.push([`player${num}`, '1234', `玩家${num}`, balance]);
            }

            for (const member of initialMembers) {
                await pool.execute(
                    'INSERT INTO members (username, password, name, balance) VALUES (?, ?, ?, ?)',
                    member
                );
            }
            console.log('資料庫初始化完成，已建立 100 個會員帳號');
        }

        // 清除超過2週的押注記錄
        await cleanOldRecords();

        console.log('MySQL 資料庫連線成功');
    } catch (error) {
        console.error('MySQL 資料庫連線失敗:', error.message);
        throw error;
    }
}

// 清除超過2週的押注記錄
async function cleanOldRecords() {
    try {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const dateStr = twoWeeksAgo.toISOString().split('T')[0];

        const [result] = await pool.execute(
            'DELETE FROM bet_records WHERE DATE(created_at) < ?',
            [dateStr]
        );

        if (result.affectedRows > 0) {
            console.log(`已清除 ${result.affectedRows} 筆超過2週的押注記錄`);
        }

        // 也清除開獎記錄
        const [result2] = await pool.execute(
            'DELETE FROM game_results WHERE DATE(created_at) < ?',
            [dateStr]
        );

        if (result2.affectedRows > 0) {
            console.log(`已清除 ${result2.affectedRows} 筆超過2週的開獎記錄`);
        }
    } catch (error) {
        console.error('清除舊記錄錯誤:', error);
    }
}

// 會員登入驗證
async function login(username, password) {
    try {
        const [rows] = await pool.execute(
            'SELECT id, username, name, balance, status FROM members WHERE username = ? AND password = ?',
            [username, password]
        );

        if (rows.length > 0 && rows[0].status === 'active') {
            const member = rows[0];
            return {
                success: true,
                member: {
                    id: member.id,
                    username: member.username,
                    name: member.name,
                    balance: parseFloat(member.balance)
                }
            };
        }

        return { success: false, message: '帳號或密碼錯誤' };
    } catch (error) {
        console.error('登入查詢錯誤:', error);
        return { success: false, message: '系統錯誤' };
    }
}

// 取得會員資料
async function getMember(memberId) {
    try {
        const [rows] = await pool.execute(
            'SELECT id, username, name, balance, status FROM members WHERE id = ?',
            [memberId]
        );

        if (rows.length > 0) {
            const member = rows[0];
            return {
                id: member.id,
                username: member.username,
                name: member.name,
                balance: parseFloat(member.balance),
                status: member.status
            };
        }

        return null;
    } catch (error) {
        console.error('取得會員資料錯誤:', error);
        return null;
    }
}

// 更新會員餘額
async function updateBalance(memberId, amount) {
    try {
        // 先取得當前餘額
        const [rows] = await pool.execute(
            'SELECT balance FROM members WHERE id = ?',
            [memberId]
        );

        if (rows.length === 0) {
            return { success: false, message: '會員不存在' };
        }

        const currentBalance = parseFloat(rows[0].balance);
        const newBalance = currentBalance + amount;

        // 更新餘額
        await pool.execute(
            'UPDATE members SET balance = ? WHERE id = ?',
            [newBalance, memberId]
        );

        return { success: true, balance: newBalance };
    } catch (error) {
        console.error('更新餘額錯誤:', error);
        return { success: false, message: '系統錯誤' };
    }
}

// 檢查餘額是否足夠
async function checkBalance(memberId, amount) {
    try {
        const [rows] = await pool.execute(
            'SELECT balance FROM members WHERE id = ?',
            [memberId]
        );

        if (rows.length > 0) {
            return parseFloat(rows[0].balance) >= amount;
        }

        return false;
    } catch (error) {
        console.error('檢查餘額錯誤:', error);
        return false;
    }
}

// 取得所有會員
async function getAllMembers() {
    try {
        const [rows] = await pool.execute(
            'SELECT id, username, name, balance, status FROM members ORDER BY id'
        );
        return rows.map(row => ({
            ...row,
            balance: parseFloat(row.balance)
        }));
    } catch (error) {
        console.error('取得所有會員錯誤:', error);
        return [];
    }
}

// 新增押注記錄
async function addBetRecord(memberId, roundNumber, betType, betTarget, amount) {
    try {
        await pool.execute(
            'INSERT INTO bet_records (member_id, round_number, bet_type, bet_target, amount) VALUES (?, ?, ?, ?, ?)',
            [memberId, roundNumber, betType, betTarget, amount]
        );
        return { success: true };
    } catch (error) {
        console.error('新增押注記錄錯誤:', error);
        return { success: false, message: '系統錯誤' };
    }
}

// 取得號碼對應的顏色
function getNumberColor(num) {
    const n = parseInt(num);
    const colorIndex = n % 3;
    if (colorIndex === 0) return 'blue';  // 3,6,9,12,15,18...
    if (colorIndex === 1) return 'green'; // 1,4,7,10,13,16...
    return 'red'; // colorIndex === 2 (2,5,8,11,14,17...)
}

// 更新押注記錄的開獎結果
async function updateBetRecordResult(roundNumber, winningNumber) {
    try {
        console.log(`[DB] 更新押注結果 - 期數: ${roundNumber}, 開獎號碼: ${winningNumber}`);

        // 取得該期所有押注
        const [bets] = await pool.execute(
            'SELECT id, bet_type, bet_target, amount FROM bet_records WHERE round_number = ?',
            [roundNumber]
        );

        console.log(`[DB] 找到 ${bets.length} 筆該期押注記錄`);

        const winNum = parseInt(winningNumber);
        const isOdd = winNum % 2 === 1;
        const isBig = winNum >= 20 && winNum <= 38;
        const isSmall = winNum >= 1 && winNum <= 19;
        const winningColor = getNumberColor(winNum);

        for (const bet of bets) {
            let profit = 0;

            if (bet.bet_type === 'number') {
                // 號碼投注
                if (bet.bet_target === winningNumber) {
                    profit = bet.amount * 35; // 贏得35倍
                } else {
                    profit = -bet.amount; // 輸掉本金
                }
            } else if (bet.bet_type === 'oddeven') {
                // 單雙投注
                if (winNum === 39) {
                    profit = -bet.amount; // 39莊家通殺
                } else if ((bet.bet_target === 'odd' && isOdd) || (bet.bet_target === 'even' && !isOdd)) {
                    profit = bet.amount; // 贏得1倍
                } else {
                    profit = -bet.amount; // 輸掉本金
                }
            } else if (bet.bet_type === 'bigsmall') {
                // 大小投注
                if (winNum === 39) {
                    profit = -bet.amount; // 39莊家通殺
                } else if ((bet.bet_target === 'big' && isBig) || (bet.bet_target === 'small' && isSmall)) {
                    profit = bet.amount; // 贏得1倍
                } else {
                    profit = -bet.amount; // 輸掉本金
                }
            } else if (bet.bet_type === 'color') {
                // 顏色投注（1賠1.8）
                if (bet.bet_target === winningColor) {
                    profit = bet.amount * 1.8; // 贏得1.8倍
                } else {
                    profit = -bet.amount; // 輸掉本金
                }
            }

            // 更新押注記錄
            await pool.execute(
                'UPDATE bet_records SET winning_number = ?, profit = ? WHERE id = ?',
                [winningNumber, profit, bet.id]
            );
            console.log(`[DB] 更新押注 ID ${bet.id}: 類型=${bet.bet_type}, 目標=${bet.bet_target}, 損益=${profit}`);
        }

        console.log(`[DB] 押注結果更新完成，共 ${bets.length} 筆`);
        return { success: true };
    } catch (error) {
        console.error('更新押注結果錯誤:', error);
        return { success: false, message: '系統錯誤' };
    }
}

// 儲存開獎結果
async function saveGameResult(roundNumber, winningNumber, totalBets, totalPayout, systemProfit) {
    try {
        await pool.execute(
            'INSERT INTO game_results (round_number, winning_number, total_bets, total_payout, system_profit) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE winning_number = ?, total_bets = ?, total_payout = ?, system_profit = ?',
            [roundNumber, winningNumber, totalBets, totalPayout, systemProfit, winningNumber, totalBets, totalPayout, systemProfit]
        );
        return { success: true };
    } catch (error) {
        console.error('儲存開獎結果錯誤:', error);
        return { success: false, message: '系統錯誤' };
    }
}

// 取得會員押注記錄（可指定天數範圍）
async function getMemberBetRecords(memberId, days = 14) {
    try {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];

        const [rows] = await pool.execute(`
            SELECT
                br.id,
                br.round_number,
                br.bet_type,
                br.bet_target,
                br.amount,
                br.winning_number,
                br.profit,
                br.created_at
            FROM bet_records br
            WHERE br.member_id = ? AND DATE(br.created_at) >= ?
            ORDER BY br.created_at DESC
        `, [memberId, dateLimitStr]);

        return rows.map(row => ({
            ...row,
            amount: parseFloat(row.amount),
            profit: row.profit ? parseFloat(row.profit) : null
        }));
    } catch (error) {
        console.error('取得會員押注記錄錯誤:', error);
        return [];
    }
}

// 取得所有押注記錄（管理員用，可指定天數範圍）
async function getAllBetRecords(days = 14) {
    try {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];

        const [rows] = await pool.execute(`
            SELECT
                br.id,
                br.member_id,
                m.username,
                m.name as member_name,
                br.round_number,
                br.bet_type,
                br.bet_target,
                br.amount,
                br.winning_number,
                br.profit,
                br.created_at
            FROM bet_records br
            JOIN members m ON br.member_id = m.id
            WHERE DATE(br.created_at) >= ?
            ORDER BY br.created_at DESC
        `, [dateLimitStr]);

        return rows.map(row => ({
            ...row,
            amount: parseFloat(row.amount),
            profit: row.profit ? parseFloat(row.profit) : null
        }));
    } catch (error) {
        console.error('取得所有押注記錄錯誤:', error);
        return [];
    }
}

// 取得會員損益統計
async function getMemberProfitStats(memberId, days = 14) {
    try {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];

        const [rows] = await pool.execute(`
            SELECT
                COUNT(*) as total_bets,
                SUM(amount) as total_amount,
                SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as win_count,
                SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as lose_count,
                SUM(CASE WHEN profit IS NOT NULL THEN profit ELSE 0 END) as total_profit
            FROM bet_records
            WHERE member_id = ? AND DATE(created_at) >= ?
        `, [memberId, dateLimitStr]);

        if (rows.length > 0) {
            return {
                totalBets: rows[0].total_bets || 0,
                totalAmount: parseFloat(rows[0].total_amount) || 0,
                winCount: rows[0].win_count || 0,
                loseCount: rows[0].lose_count || 0,
                totalProfit: parseFloat(rows[0].total_profit) || 0
            };
        }

        return { totalBets: 0, totalAmount: 0, winCount: 0, loseCount: 0, totalProfit: 0 };
    } catch (error) {
        console.error('取得會員損益統計錯誤:', error);
        return { totalBets: 0, totalAmount: 0, winCount: 0, loseCount: 0, totalProfit: 0 };
    }
}

// 取得系統損益統計（管理員用）
// days = 0 表示只取當天
async function getSystemProfitStats(days = 14) {
    try {
        // 計算日期範圍
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let dateLimitStr;
        if (days === 0) {
            // 只取當天
            dateLimitStr = todayStr;
        } else {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);
            dateLimitStr = dateLimit.toISOString().split('T')[0];
        }

        const [rows] = await pool.execute(`
            SELECT
                COUNT(DISTINCT round_number) as total_rounds,
                SUM(total_bets) as total_bets,
                SUM(total_payout) as total_payout,
                SUM(system_profit) as total_profit
            FROM game_results
            WHERE DATE(created_at) >= ?
        `, [dateLimitStr]);

        if (rows.length > 0) {
            return {
                totalRounds: rows[0].total_rounds || 0,
                totalBets: parseFloat(rows[0].total_bets) || 0,
                totalPayout: parseFloat(rows[0].total_payout) || 0,
                totalProfit: parseFloat(rows[0].total_profit) || 0
            };
        }

        return { totalRounds: 0, totalBets: 0, totalPayout: 0, totalProfit: 0 };
    } catch (error) {
        console.error('取得系統損益統計錯誤:', error);
        return { totalRounds: 0, totalBets: 0, totalPayout: 0, totalProfit: 0 };
    }
}

// 會員充值
async function rechargeMember(memberId, amount, operator = 'admin', remark = '') {
    try {
        // 取得當前餘額
        const [rows] = await pool.execute(
            'SELECT balance FROM members WHERE id = ?',
            [memberId]
        );

        if (rows.length === 0) {
            return { success: false, message: '會員不存在' };
        }

        const balanceBefore = parseFloat(rows[0].balance);
        const balanceAfter = balanceBefore + amount;

        // 更新餘額
        await pool.execute(
            'UPDATE members SET balance = ? WHERE id = ?',
            [balanceAfter, memberId]
        );

        // 新增充值記錄
        await pool.execute(
            'INSERT INTO recharge_records (member_id, amount, balance_before, balance_after, operator, remark) VALUES (?, ?, ?, ?, ?, ?)',
            [memberId, amount, balanceBefore, balanceAfter, operator, remark]
        );

        return { success: true, balanceBefore, balanceAfter };
    } catch (error) {
        console.error('充值錯誤:', error);
        return { success: false, message: '系統錯誤' };
    }
}

// 取得充值記錄
async function getRechargeRecords(memberId = null, days = 14) {
    try {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];

        let query = `
            SELECT
                rr.id,
                rr.member_id,
                m.username,
                m.name as member_name,
                rr.amount,
                rr.balance_before,
                rr.balance_after,
                rr.operator,
                rr.remark,
                rr.created_at
            FROM recharge_records rr
            JOIN members m ON rr.member_id = m.id
            WHERE DATE(rr.created_at) >= ?
        `;
        const params = [dateLimitStr];

        if (memberId) {
            query += ' AND rr.member_id = ?';
            params.push(memberId);
        }

        query += ' ORDER BY rr.created_at DESC';

        const [rows] = await pool.execute(query, params);

        return rows.map(row => ({
            ...row,
            amount: parseFloat(row.amount),
            balance_before: parseFloat(row.balance_before),
            balance_after: parseFloat(row.balance_after)
        }));
    } catch (error) {
        console.error('取得充值記錄錯誤:', error);
        return [];
    }
}

// 取得開獎記錄
async function getGameResults(days = 14) {
    try {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];

        const [rows] = await pool.execute(`
            SELECT
                id,
                round_number,
                winning_number,
                total_bets,
                total_payout,
                system_profit,
                created_at
            FROM game_results
            WHERE DATE(created_at) >= ?
            ORDER BY created_at DESC
        `, [dateLimitStr]);

        return rows.map(row => ({
            ...row,
            total_bets: parseFloat(row.total_bets),
            total_payout: parseFloat(row.total_payout),
            system_profit: parseFloat(row.system_profit)
        }));
    } catch (error) {
        console.error('取得開獎記錄錯誤:', error);
        return [];
    }
}

module.exports = {
    initDatabase,
    getAllMembers,
    login,
    getMember,
    updateBalance,
    checkBalance,
    calculateRoundNumber,
    addBetRecord,
    updateBetRecordResult,
    saveGameResult,
    getMemberBetRecords,
    getAllBetRecords,
    getMemberProfitStats,
    getSystemProfitStats,
    rechargeMember,
    getRechargeRecords,
    getGameResults,
    cleanOldRecords
};
