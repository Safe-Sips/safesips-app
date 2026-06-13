$env:Path += ";$env:USERPROFILE\.bun\bin;$env:LOCALAPPDATA\Programs\CodeRabbit\bin"

Write-Host "Signing in to CodeRabbit CLI..." -ForegroundColor Cyan
Write-Host "A browser window will open. Sign in with your CodeRabbit account.`n"

coderabbit auth login

Write-Host "`nAuth status:" -ForegroundColor Cyan
coderabbit auth status

Write-Host "`nPress Enter to close."
Read-Host
