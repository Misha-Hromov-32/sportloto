# Настройка Telegram-бота «Спорт и точка» на этом компьютере.
# Ключ бота из @BotFather и секрет привязки сохраняются зашифрованными в профиле Windows
# (%LOCALAPPDATA%\sport-i-tochka), прочитать их может только текущий пользователь.
# Запуск бота после настройки: scripts\run-telegram-bot.ps1
param(
    [string]$Server = $env:SPORT_SERVER,
    [string]$RemoteEnv = '/srv/sport/deploy/.env',
    [string]$DefaultUsername = 'sport_stoloto_bot'
)
$ErrorActionPreference = 'Stop'
if (-not $Server) { throw 'Не указан сервер. Задайте переменную SPORT_SERVER или параметр -Server в виде пользователь@адрес.' }

$root = Join-Path $env:LOCALAPPDATA 'sport-i-tochka'
New-Item -ItemType Directory -Path $root -Force | Out-Null

function Save-Secret([string]$Name, [string]$Value) {
    $path = Join-Path $root $Name
    if (-not $Value) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        return
    }
    ConvertTo-SecureString -String $Value -AsPlainText -Force | ConvertFrom-SecureString |
        Set-Content -LiteralPath $path -Encoding ASCII
}

function Get-Plain([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# Команды на сервере уходят через stdin, а не в строке запуска: ключи не видны в списке процессов.
function Invoke-Remote([string]$Script) {
    $Script | ssh $Server "tr -d '\r' | bash -s"
    if ($LASTEXITCODE -ne 0) { throw 'Команда на сервере не выполнилась. Проверьте доступ по SSH.' }
}

$setVar = @"
f='$RemoteEnv'
set_var() { grep -v "^`$1=" "`$f" > "`$f.tmp" || true; printf '%s=%s\n' "`$1" "`$2" >> "`$f.tmp"; cat "`$f.tmp" > "`$f"; rm -f "`$f.tmp"; }
"@

# 1. Ключ бота
$token = Get-Plain (Read-Host 'Вставьте ключ бота из @BotFather' -AsSecureString)
if ($token -notmatch '^\d+:[A-Za-z0-9_-]{30,}$') { throw 'Это не похоже на ключ бота. Скопируйте его из сообщения @BotFather целиком.' }
Save-Secret 'telegram-bot.sec' $token
$token = $null

# 2. Прокси (в России api.telegram.org бывает недоступен)
$proxy = Read-Host 'Прокси для Telegram, например socks5://127.0.0.1:1080 (Enter — без прокси)'
if ($proxy -and $proxy -notmatch '^(http|https|socks5|socks5h)://') { throw 'Адрес прокси должен начинаться с http://, https:// или socks5://' }
Save-Secret 'telegram-proxy.sec' $proxy

# 3. Секрет привязки — с сервера; если его там ещё нет, создаём
Write-Output 'Беру секрет привязки с сервера...'
$secret = (ssh $Server "grep '^BOT_API_SECRET=' $RemoteEnv | cut -d= -f2-")
if ($LASTEXITCODE -gt 1) { throw 'Не удалось прочитать настройки сервера. Проверьте доступ по SSH.' }
$secret = "$secret".Trim()
$restartNeeded = $false
if (-not $secret) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    Invoke-Remote "$setVar`nset_var BOT_API_SECRET '$secret'"
    $restartNeeded = $true
    Write-Output 'На сервере не было секрета привязки: создал и записал его.'
}
Save-Secret 'bot-api-secret.sec' $secret
$secret = $null

# 4. Ник бота — сайт строит по нему ссылку t.me/<ник>?start=<код>
$username = (Read-Host "Ник бота без @ (Enter — $DefaultUsername)").Trim().TrimStart('@')
if (-not $username) { $username = $DefaultUsername }
if ($username -notmatch '^[A-Za-z0-9_]{5,32}$') { throw 'Ник может состоять из латинских букв, цифр и _' }
$current = (ssh $Server "grep '^TELEGRAM_BOT_USERNAME=' $RemoteEnv | cut -d= -f2-")
if ("$current".Trim() -ne $username) {
    Invoke-Remote "$setVar`nset_var TELEGRAM_BOT_USERNAME '$username'"
    $restartNeeded = $true
    Write-Output "На сервере записан ник бота: $username"
}

Write-Output "Готово. Ключи сохранены в $root"
if ($restartNeeded) {
    $answer = Read-Host 'Чтобы сайт увидел изменения, нужно перезапустить его. Перезапустить сейчас? (y/N)'
    if ($answer -match '^(y|д)') {
        ssh $Server 'cd /srv/sport && docker compose -f deploy/docker-compose.yml up -d backend vk-bot'
    } else {
        Write-Output "Перезапустите позже: ssh $Server `"cd /srv/sport && docker compose -f deploy/docker-compose.yml up -d backend vk-bot`""
    }
}
Write-Output 'Запуск бота: scripts\run-telegram-bot.ps1   Автозапуск при входе в Windows: scripts\run-telegram-bot.ps1 -Install'
