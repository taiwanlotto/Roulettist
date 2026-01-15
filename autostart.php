<?php
// 檢查 Node.js 伺服器是否運行中
$socket = @fsockopen('localhost', 3000, $errno, $errstr, 1);

if ($socket) {
    // 伺服器已運行，直接跳轉
    fclose($socket);
    header('Location: http://localhost:3000');
    exit;
} else {
    // 伺服器未運行，啟動它
    $dir = __DIR__;

    // Windows 環境下啟動 Node.js
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        pclose(popen("start /B node \"{$dir}\\server.js\"", "r"));
    } else {
        exec("cd {$dir} && node server.js > /dev/null 2>&1 &");
    }

    // 等待伺服器啟動
    sleep(2);

    // 跳轉到主頁
    header('Location: http://localhost:3000');
    exit;
}
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>啟動中...</title>
    <meta http-equiv="refresh" content="3;url=http://localhost:3000">
</head>
<body>
    <h1>正在啟動伺服器...</h1>
    <p>請稍候，將自動跳轉...</p>
</body>
</html>
