param(
    [string]$HostName = "0.0.0.0",
    [int]$Port = 3001,
    [string]$Token = "",
    [string]$TaskName = "SullyOS Code Workbench Bridge"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $Token -and $env:WORKBENCH_BRIDGE_TOKEN) {
    $Token = $env:WORKBENCH_BRIDGE_TOKEN
}
if (-not $Token) {
    $userTokenFile = Join-Path $env:USERPROFILE ".sullyos-workbench-bridge-token"
    if (Test-Path -LiteralPath $userTokenFile) {
        $Token = (Get-Content -LiteralPath $userTokenFile -Raw).Trim()
    }
}
if (-not $Token) {
    $repoTokenFile = Join-Path $repoRoot ".workbench-bridge-token"
    if (Test-Path -LiteralPath $repoTokenFile) {
        $Token = (Get-Content -LiteralPath $repoTokenFile -Raw).Trim()
    }
}

if (-not $Token -and $HostName -notin @("localhost", "127.0.0.1", "::1")) {
    throw "Refusing to install a non-local Workbench bridge without -Token. Use -Token YOUR_KEY, or set -HostName 127.0.0.1 for local-only debugging."
}

$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$bridgeCommand = "Set-Location -LiteralPath '$repoRoot'; & '$pnpm' workbench:bridge -- --host $HostName --port $Port"
if ($Token) {
    $bridgeCommand += " --token '$Token'"
}
$argsList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-Command",
    $bridgeCommand
)

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($argsList -join " ")
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Start SullyOS Code Workbench CLI Bridge at user logon." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started: $TaskName"
Write-Host "Bridge URL for this computer: http://<this-computer-ip>:$Port"
if ($Token) {
    Write-Host "Bearer token enabled. Use the same Key in SullyOS Code settings."
}
