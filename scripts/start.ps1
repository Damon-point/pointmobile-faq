# Solution Buffer 를 이 PC 에서 띄운다(사내망 3070) — 웹에 올리기 전 · 올린 뒤 비교용.
# 화면과 API 가 한 Next.js 앱이다(web/). 설정은 web\.env.local, DB 는 DATABASE_URL(로컬 PostgreSQL 또는 Supabase).
# 5분 주기 작업은 Vercel Cron 이 부른다. 이 PC 에서 띄운 경우에는 아래 반복 작업이 대신 부른다.
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root "web"
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

$p = (Get-NetTCPConnection -LocalPort 3070 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($p) { Stop-Process -Id $p -Force }

# DATABASE_URL 이 로컬 PostgreSQL(127.0.0.1)이면, 꺼져 있을 때 먼저 켜고 접속을 받을 때까지 기다린다.
$envFile = Join-Path $web ".env.local"
if (-not (Test-Path $envFile)) { throw "web\.env.local 이 없습니다 — web\.env.example 을 보고 만드세요" }
$dbUrl = (Get-Content $envFile | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1) -replace "^DATABASE_URL=", ""
if ($dbUrl -match "@(127\.0\.0\.1|localhost):5432/") {
    $pgBin = "C:\Users\POINTMOBILE\pgsql\bin"
    $pgData = "C:\Users\POINTMOBILE\pgdata\twnext"
    if (-not (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath (Join-Path $pgBin "pg_ctl.exe") -ArgumentList "-D `"$pgData`" -l `"$pgData\startup.log`" start" -WindowStyle Hidden
    }
    for ($i = 0; $i -lt 120; $i++) {
        & (Join-Path $pgBin "pg_isready.exe") -h 127.0.0.1 -p 5432 -q
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 이 접속을 받지 않습니다 — $pgData\log 를 보세요" }
}

if (-not (Test-Path (Join-Path $web ".next\BUILD_ID"))) {
    Push-Location $web; npx next build; Pop-Location
}
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx next start -p 3070 -H 0.0.0.0" `
    -WorkingDirectory $web -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "web.out.log") -RedirectStandardError (Join-Path $logs "web.err.log")

# 5분마다 주기 작업(Redmine 수집 → SB 초안 → 검토 요청)을 부른다 — Vercel Cron 과 같은 일.
# 다시 띄울 때마다 반복 작업이 하나씩 쌓이지 않게, 전에 띄운 것을 먼저 끈다.
$tickPid = Join-Path $logs "tick.pid"
if (Test-Path $tickPid) {
    Stop-Process -Id ([int](Get-Content $tickPid)) -Force -ErrorAction SilentlyContinue
    Remove-Item $tickPid -Force
}
$cronSecret = (Get-Content $envFile | Where-Object { $_ -like "CRON_SECRET=*" } | Select-Object -First 1) -replace "^CRON_SECRET=", ""
if ($cronSecret) {
    $tick = "while(`$true){ Start-Sleep -Seconds 300; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 310 -Headers @{Authorization='Bearer $cronSecret'} http://127.0.0.1:3070/api/cron/tick | Out-Null } catch {} }"
    $tp = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -WindowStyle Hidden -Command $tick" -WindowStyle Hidden -PassThru
    Set-Content -Path $tickPid -Value $tp.Id
}
"started: http://192.168.121.35:3070"
