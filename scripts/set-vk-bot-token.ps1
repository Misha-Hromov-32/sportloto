# Ключ сообщества VK для VK-бота «Спорт и точка» (сервис vk-bot на сервере).
# Ключ вводится скрыто и сразу уходит в deploy/.env на сервере по SSH, на этом компьютере не сохраняется.
# Если на сервере ещё нет BOT_STORE_KEY (шифрование ключей людей) и BOT_API_SECRET (секрет привязки), скрипт их создаст.
param(
    [string]$Server = $env:SPORT_SERVER,
    [string]$RemoteDir = '/srv/sport'
)
$ErrorActionPreference = 'Stop'
if (-not $Server) { throw 'Не указан сервер. Задайте переменную SPORT_SERVER или параметр -Server в виде пользователь@адрес.' }

$secure = Read-Host 'Вставьте ключ сообщества VK (Управление → Работа с API → Ключи доступа)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$token = "$token".Trim()
if ($token -notmatch '^[A-Za-z0-9._-]{40,}$') { throw 'Это не похоже на ключ сообщества. Скопируйте его целиком.' }

# Команды уходят через stdin: ключ не виден в списке процессов сервера и не печатается.
$script = @"
set -e
f='$RemoteDir/deploy/.env'
set_var() { grep -v "^`$1=" "`$f" > "`$f.tmp" || true; printf '%s=%s\n' "`$1" "`$2" >> "`$f.tmp"; cat "`$f.tmp" > "`$f"; rm -f "`$f.tmp"; }
set_var VK_GROUP_TOKEN '$token'
if ! grep -q '^BOT_STORE_KEY=.' "`$f"; then set_var BOT_STORE_KEY "`$(head -c 32 /dev/urandom | base64 | tr '+/' '-_')"; echo 'store-key-created'; fi
if ! grep -q '^BOT_API_SECRET=.' "`$f"; then set_var BOT_API_SECRET "`$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; echo 'secret-created'; fi
echo 'ok'
"@
$output = $script | ssh $Server "tr -d '\r' | bash -s"
$token = $null
$script = $null
if ($LASTEXITCODE -ne 0 -or ($output -notcontains 'ok')) { throw 'Не удалось записать ключ на сервере. Проверьте доступ по SSH.' }
if ($output -contains 'store-key-created') { Write-Output 'Создан ключ шифрования базы бота (BOT_STORE_KEY).' }
if ($output -contains 'secret-created') {
    Write-Output 'Создан секрет привязки (BOT_API_SECRET). Сайт нужно перезапустить вместе с ботом, а на ПК с Telegram-ботом снова запустить scripts\set-telegram-bot.ps1.'
}
Write-Output 'Ключ сообщества записан в deploy/.env на сервере.'

$restart = "cd $RemoteDir && docker compose -f deploy/docker-compose.yml up -d --build backend vk-bot"
$answer = Read-Host 'Перезапустить VK-бота сейчас? (y/N)'
if ($answer -match '^(y|д)') {
    ssh $Server $restart
    Write-Output "Журнал бота: ssh $Server `"cd $RemoteDir && docker compose -f deploy/docker-compose.yml logs -f vk-bot`""
} else {
    Write-Output "Перезапустите позже: ssh $Server `"$restart`""
}
