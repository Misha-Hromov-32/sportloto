# Остановить мост и убрать его из автозапуска.
$name = 'SportBridge'
Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Write-Output "Мост остановлен и удалён из автозапуска."
