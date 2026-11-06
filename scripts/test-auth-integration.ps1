$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousTestDatabaseUrl = [Environment]::GetEnvironmentVariable("AUTH_TEST_DATABASE_URL", "Process")
$locationPushed = $false
$npmExitCode = 0

try {
  $privateEnvPath = Join-Path $root ".env.postgres.local"
  if (-not (Test-Path -LiteralPath $privateEnvPath)) {
    throw "Run scripts/setup-local-postgres.ps1 first."
  }

  foreach ($line in Get-Content -LiteralPath $privateEnvPath) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$' -and $Matches[1] -in @("DATABASE_URL", "AUTH_TEST_DATABASE_URL")) {
      Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2]
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:AUTH_TEST_DATABASE_URL)) {
    throw "AUTH_TEST_DATABASE_URL is not configured in .env.postgres.local."
  }
  $testDatabase = [Uri]$env:AUTH_TEST_DATABASE_URL
  if ($testDatabase.Host -notin @("127.0.0.1", "localhost", "::1") -or -not $testDatabase.AbsolutePath.TrimStart('/').EndsWith("_test")) {
    throw "AUTH_TEST_DATABASE_URL must point to a local database with a name ending in _test."
  }

  Push-Location $root
  $locationPushed = $true
  & npm run test:integration
  $npmExitCode = $LASTEXITCODE
}
finally {
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  [Environment]::SetEnvironmentVariable("AUTH_TEST_DATABASE_URL", $previousTestDatabaseUrl, "Process")
  if ($locationPushed) { Pop-Location }
}
if ($npmExitCode -ne 0) { exit $npmExitCode }
