# Мост помощника запускается при входе в Windows и перезапускается, если упал.
# Запуск: powershell -ExecutionPolicy Bypass -File install-autostart.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $here 'config.json'))) {
    throw "Нет config.json. Скопируйте config.example.json в config.json и вставьте ключ моста из админки."
}
$name = 'SportBridge'
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$(Join-Path $here 'codex-bridge.mjs')`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Мост помощника «Спорт и точка» (Codex)' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Output "Мост установлен и запущен: задача планировщика $name. Журнал: $(Join-Path $here 'logs\bridge.log')"
