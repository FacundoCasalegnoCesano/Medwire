$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$privateEnvPath = Join-Path $root ".env.postgres.local"
$appEnvPath = Join-Path $root ".env"
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$psql = Join-Path $pgBin "psql.exe"
$pgIsReady = Join-Path $pgBin "pg_isready.exe"
$previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
$previousAppPassword = [Environment]::GetEnvironmentVariable("MENDWIRE_APP_PASSWORD", "Process")

if (-not (Test-Path -LiteralPath $privateEnvPath)) {
  throw "Create .env.postgres.local first and fill POSTGRES_ADMIN_PASSWORD locally."
}
if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $pgIsReady)) {
  throw "PostgreSQL 18 client tools were not found in the expected installation directory."
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $privateEnvPath) {
  if ($line -match '^\s*([A-Z][A-Z0-9_]*)=(.*)$') {
    $values[$Matches[1]] = $Matches[2]
  }
}
$adminPassword = $values["POSTGRES_ADMIN_PASSWORD"]
if ([string]::IsNullOrWhiteSpace($adminPassword)) {
  throw "Fill POSTGRES_ADMIN_PASSWORD in .env.postgres.local, then rerun this script."
}

$ready = & $pgIsReady -h 127.0.0.1 -p 5432 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL is not accepting local connections on 127.0.0.1:5432."
}

function Invoke-LocalPsql([string]$InputSql, [string]$Database = "postgres") {
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $psql
  $start.Arguments = "--no-psqlrc --tuples-only --no-align --quiet --host 127.0.0.1 --port 5432 --username postgres --dbname $Database --set ON_ERROR_STOP=1 --file -"
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables["PGPASSWORD"] = $adminPassword
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.Write($InputSql)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) {
    throw "PostgreSQL setup command failed (exit $($process.ExitCode)); no secret values were printed."
  }
  return $stdout.Trim()
}

$locationPushed = $false
try {
  $existingRole = Invoke-LocalPsql "SELECT 1 FROM pg_roles WHERE rolname = 'mendwire';"
  $existingAppDb = Invoke-LocalPsql "SELECT 1 FROM pg_database WHERE datname = 'mendwire';"
  $existingTestDb = Invoke-LocalPsql "SELECT 1 FROM pg_database WHERE datname = 'mendwire_test';"
  if ($existingRole -or $existingAppDb -or $existingTestDb) {
    throw "A mendwire role or database already exists. Setup stopped without changing PostgreSQL objects."
  }

  $randomBytes = [byte[]]::new(36)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
  $appPassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $encodedPassword = [Uri]::EscapeDataString($appPassword)
  $appUrl = "postgresql://mendwire:$encodedPassword@127.0.0.1:5432/mendwire?schema=public"
  $testUrl = "postgresql://mendwire:$encodedPassword@127.0.0.1:5432/mendwire_test?schema=public"

  $env:MENDWIRE_APP_PASSWORD = $appPassword
  $sql = @"
\getenv app_password MENDWIRE_APP_PASSWORD
CREATE ROLE mendwire LOGIN PASSWORD :'app_password';
CREATE DATABASE mendwire OWNER mendwire;
CREATE DATABASE mendwire_test OWNER mendwire;
"@
  [void](Invoke-LocalPsql $sql)

  $privateLines = @(
    "POSTGRES_ADMIN_PASSWORD=",
    "DATABASE_URL=$appUrl",
    "AUTH_TEST_DATABASE_URL=$testUrl"
  )
  Set-Content -LiteralPath $privateEnvPath -Value $privateLines -Encoding utf8

  $appLines = @(Get-Content -LiteralPath $appEnvPath -ErrorAction SilentlyContinue)
  $databaseLineFound = $false
  $testLineFound = $false
  $appLines = @($appLines | ForEach-Object {
    if ($_ -match '^DATABASE_URL=') { $databaseLineFound = $true; "DATABASE_URL=$appUrl" }
    elseif ($_ -match '^AUTH_TEST_DATABASE_URL=') { $testLineFound = $true; "AUTH_TEST_DATABASE_URL=$testUrl" }
    else { $_ }
  })
  if (-not $databaseLineFound) { $appLines += "DATABASE_URL=$appUrl" }
  if (-not $testLineFound) { $appLines += "AUTH_TEST_DATABASE_URL=$testUrl" }
  Set-Content -LiteralPath $appEnvPath -Value $appLines -Encoding utf8

  Push-Location $root
  $locationPushed = $true
  $env:DATABASE_URL = $appUrl
  & npm run db:migrate
  if ($LASTEXITCODE -ne 0) { throw "Application database migration failed." }
  $env:DATABASE_URL = $testUrl
  & npm run db:migrate
  if ($LASTEXITCODE -ne 0) { throw "Integration database migration failed." }

  Write-Output "Created dedicated local mendwire and mendwire_test databases and applied migrations."
  Write-Output "Connection secrets are stored only in ignored local environment files."
}
finally {
  [Environment]::SetEnvironmentVariable("MENDWIRE_APP_PASSWORD", $previousAppPassword, "Process")
  [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
  if ($locationPushed) { Pop-Location }
  if (Test-Path -LiteralPath $privateEnvPath) {
    $privateLines = @(Get-Content -LiteralPath $privateEnvPath)
    $privateLines = @($privateLines | ForEach-Object {
      if ($_ -match '^POSTGRES_ADMIN_PASSWORD=') { 'POSTGRES_ADMIN_PASSWORD=' } else { $_ }
    })
    Set-Content -LiteralPath $privateEnvPath -Value $privateLines -Encoding utf8
  }
}
