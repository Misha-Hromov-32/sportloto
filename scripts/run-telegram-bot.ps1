# Запуск Telegram-бота «Спорт и точка» на этом компьютере. Сначала один раз: scripts\set-telegram-bot.ps1
#   scripts\run-telegram-bot.ps1             — запустить (окно можно свернуть)
#   scripts\run-telegram-bot.ps1 -Install    — запускать при входе в Windows (Планировщик заданий)
#   scripts\run-telegram-bot.ps1 -Uninstall  — убрать автозапуск
param(
    [switch]$Install,
    [switch]$Uninstall,
    [string]$SiteUrl = 'https://sport.up-point.tech'
)
$ErrorActionPreference = 'Stop'

$taskName = 'SportTelegramBot'
$root = Join-Path $env:LOCALAPPDATA 'sport-i-tochka'
$repo = Split-Path -Parent $PSScriptRoot

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Output 'Автозапуск бота убран.'
    } else {
        Write-Output 'Автозапуск не был настроен.'
    }
    return
}

if ($Install) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$PSCommandPath`" -SiteUrl `"$SiteUrl`""
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Description 'Telegram-бот «Спорт и точка»' -Force | Out-Null
    Write-Output 'Готово: бот будет запускаться при входе в Windows. Запустить сейчас: Start-ScheduledTask SportTelegramBot'
    return
}

function Read-Secret([string]$Name) {
    $path = Join-Path $root $Name
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    $secure = Get-Content -LiteralPath $path | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$env:TELEGRAM_BOT_TOKEN = Read-Secret 'telegram-bot.sec'
if (-not $env:TELEGRAM_BOT_TOKEN) { throw 'Ключ бота не найден. Сначала запустите scripts\set-telegram-bot.ps1' }
$env:BOT_API_SECRET = Read-Secret 'bot-api-secret.sec'
$env:TELEGRAM_PROXY = Read-Secret 'telegram-proxy.sec'
$env:SITE_URL = $SiteUrl
$env:PUBLIC_SITE_URL = $SiteUrl
$env:BOT_DB_PATH = Join-Path $root 'telegram-bot.sqlite'
$env:PYTHONUTF8 = '1'

$uv = Get-Command uv -ErrorAction SilentlyContinue
Set-Location -LiteralPath $repo
Write-Output 'Telegram-бот запущен. Окно можно свернуть; чтобы остановить, закройте его.'
while ($true) {
    if ($uv) {
        & uv run --project bots python -m bots.telegram
    } else {
        & python -m uv run --project bots python -m bots.telegram
    }
    if ($LASTEXITCODE -eq 2) { break }
    Write-Output 'Бот остановился. Перезапуск через 10 секунд...'
    Start-Sleep -Seconds 10
}
