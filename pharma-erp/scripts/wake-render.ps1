<#
.SYNOPSIS
  Wakes the Render services and waits until they can actually serve a request.

.DESCRIPTION
  Both services run on Render's free instance type, which spins the container
  down after ~15 minutes of inactivity. The first request afterwards pays a cold
  start — measured at 53 seconds on this deployment — and the app cannot survive
  that on its own: the login action allows 20 seconds (apps/web/src/app/platform/
  actions.ts) and every other page just 5 (apps/web/src/lib/api.ts). Worse, the
  retries that pile up while the container boots make Render's edge answer
  "429 Too Many Requests", which reads like a rate limit rather than a cold
  start.

  So the first request of the day has to be made by something patient. This
  script is that something: it holds the request open, reports progress, and
  tells you when the app is genuinely ready.

  Deliberately NOT a background loop. Keeping both services awake around the
  clock costs 2 x ~720 = ~1440 instance-hours a month against a free allowance
  of 750 — the quota would run out mid-month and suspend both services. Run this
  when you sit down to work instead.

.EXAMPLE
  pnpm wake
  .\scripts\wake-render.ps1
  .\scripts\wake-render.ps1 -TimeoutMinutes 10
#>
[CmdletBinding()]
param(
  [string] $ApiUrl = 'https://pharma-erp-5hav.onrender.com',
  [string] $WebUrl = 'https://pharma-erp-web.onrender.com',

  # A cold start is normally under 90s. The default leaves room for a slow one
  # without hanging the terminal indefinitely if the service is genuinely broken.
  [int] $TimeoutMinutes = 5,
  [int] $PollSeconds = 3
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 still negotiates TLS 1.0 by default on some hosts, and
# Render's edge refuses it. Without this the first request fails with a bare
# "could not create SSL/TLS secure channel", which looks nothing like its cause.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RULE = '-' * 62

function Write-Rule { Write-Host $RULE -ForegroundColor DarkGray }

<#
  One attempt. Returns a hashtable rather than throwing, because "not ready yet"
  is the expected case here, not an error: a booting container legitimately
  answers 503, refuses the connection, or holds it open until it times out.
#>
function Test-Endpoint {
  param([string] $Url, [int] $TimeoutSec)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return @{ Ready = $true; Status = [int] $response.StatusCode; Body = $response.Content }
  } catch {
    $status = 0

    # 5xx arrives as a terminating error in 5.1, with the real response hanging
    # off the exception. A connection failure has no response at all.
    if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $_.Exception.Response) {
      try { $status = [int] $_.Exception.Response.StatusCode } catch { $status = 0 }
    }

    return @{ Ready = $false; Status = $status; Body = $null }
  }
}

<#
  Polls one service until it answers, printing a single self-updating progress
  line. Returns the final response body, or $null if the timeout was reached.
#>
function Wait-Service {
  param([string] $Name, [string] $Url, [int] $TimeoutMinutes, [int] $PollSeconds)

  $clock = [Diagnostics.Stopwatch]::StartNew()
  $deadline = [TimeSpan]::FromMinutes($TimeoutMinutes)

  # A short first probe, purely so the script can say something before the long
  # wait rather than after it. A warm service answers well inside this budget;
  # a cold one cannot, and that is the signal to announce the wait.
  $result = Test-Endpoint -Url $Url -TimeoutSec 5

  if ($result.Ready) {
    Write-Host ("  [{0}] already running" -f $Name) -ForegroundColor Green
    return $result.Body
  }

  Write-Host ("  [{0}] COLD - please wait, the service is starting ..." -f $Name) -ForegroundColor Yellow

  while ($true) {
    # Printed BEFORE the attempt, so the counter is on screen while the request
    # is in flight rather than updating only after it returns. `r rewrites the
    # same line, so a two-minute wait does not scroll the terminal.
    $note = ''
    if ($result.Status -ne 0) { $note = " (HTTP $($result.Status))" }

    Write-Host ("`r      waiting {0,3}s{1}    " -f [Math]::Round($clock.Elapsed.TotalSeconds), $note) -NoNewline -ForegroundColor DarkYellow

    # Kept short on purpose. Render may hold the connection open for the whole
    # boot, and a 60s budget would freeze the counter for a minute; aborting and
    # retrying costs nothing and keeps the display moving.
    $result = Test-Endpoint -Url $Url -TimeoutSec 10

    if ($result.Ready) {
      Write-Host ''
      Write-Host ("  [{0}] ready in {1}s" -f $Name, [Math]::Round($clock.Elapsed.TotalSeconds)) -ForegroundColor Green
      return $result.Body
    }

    if ($clock.Elapsed -gt $deadline) {
      Write-Host ''
      Write-Host ("  [{0}] TIMED OUT after {1} minutes" -f $Name, $TimeoutMinutes) -ForegroundColor Red
      return $null
    }

    Start-Sleep -Seconds $PollSeconds
  }
}

Write-Host ''
Write-Rule
Write-Host '  Pharma ERP - waking Render services' -ForegroundColor Cyan
Write-Rule
Write-Host ("  API  {0}" -f $ApiUrl) -ForegroundColor DarkGray
Write-Host ("  Web  {0}" -f $WebUrl) -ForegroundColor DarkGray
Write-Host ''

# The API first, and on /health/ready rather than /health: it returns 503 until
# Postgres actually answers, so a 200 here means the stack can serve a login —
# not merely that a process is listening.
$apiBody = Wait-Service -Name 'API' -Url "$ApiUrl/health/ready" -TimeoutMinutes $TimeoutMinutes -PollSeconds $PollSeconds

if ($apiBody) {
  try {
    $health = $apiBody | ConvertFrom-Json
    $db = $health.checks.database

    Write-Host ("       database {0}, {1}ms | uptime {2}s | v{3}" -f `
        $db.status, $db.latencyMs, [Math]::Round($health.uptimeSeconds), $health.version) -ForegroundColor DarkGray
  } catch {
    # A 200 that is not the health JSON still means something answered; the
    # detail line is a nicety, not a reason to fail the run.
    Write-Host '       (health response was not the expected JSON)' -ForegroundColor DarkGray
  }
}

$webBody = Wait-Service -Name 'Web' -Url "$WebUrl/platform/login" -TimeoutMinutes $TimeoutMinutes -PollSeconds $PollSeconds

Write-Host ''
Write-Rule

if ($apiBody -and $webBody) {
  Write-Host '  CONTINUE - both services are up.' -ForegroundColor Green
  Write-Rule
  Write-Host ("  Sign in : {0}/platform/login" -f $WebUrl)
  Write-Host '  They stay warm for ~15 minutes after the last request.'
  Write-Host ''
  exit 0
}

Write-Host '  NOT READY - at least one service did not come up.' -ForegroundColor Red
Write-Rule
Write-Host '  Check the service logs in the Render dashboard. A free instance that'
Write-Host '  never binds a port has no instance behind it, and the edge answers'
Write-Host '  404 or 429 rather than anything mentioning configuration.'
Write-Host ''
exit 1
