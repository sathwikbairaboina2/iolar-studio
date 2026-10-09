# Starts one docker/compose.yml service, bringing Docker Desktop up first when its engine is not
# running — otherwise the Plugins page's Start button fails with "cannot connect to the docker API".
param([Parameter(Mandatory = $true)][string]$Service)

function Test-Engine { docker info *> $null; return $LASTEXITCODE -eq 0 }

if (-not (Test-Engine)) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $desktop)) { Write-Error "Docker Desktop not found at $desktop"; exit 1 }
  Start-Process $desktop
  for ($i = 0; $i -lt 60 -and -not (Test-Engine); $i++) { Start-Sleep -Seconds 3 }
  if (-not (Test-Engine)) { Write-Error 'Docker Desktop did not come up within 3 minutes'; exit 1 }
}

docker compose -f docker/compose.yml up -d $Service
exit $LASTEXITCODE
