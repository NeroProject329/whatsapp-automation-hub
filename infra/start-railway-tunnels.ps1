$ErrorActionPreference = 'Stop'
$runtime = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../.runtime')).Path
$config = Join-Path $runtime 'railway-ssh.conf'
if (!(Test-Path -LiteralPath $config -PathType Leaf)) {
    throw 'Configuração SSH da Railway ausente em .runtime/railway-ssh.conf.'
}

$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$tunnels = @{
    'hub-railway-postgres' = 55433
    'hub-railway-redis' = 56380
}
foreach ($alias in $tunnels.Keys) {
    $port = $tunnels[$alias]
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listener.Count -gt 0) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
        if ($listener.Count -ne 1 -or $listener[0].LocalAddress -ne '127.0.0.1' -or
            $owner.ExecutablePath -ne $ssh -or !$owner.CommandLine.Contains($config) -or
            !$owner.CommandLine.EndsWith($alias)) {
            throw "A porta $port está ocupada por outro processo."
        }
        continue
    }
    $log = Join-Path $runtime ($alias + '.log')
    $process = Start-Process -FilePath $ssh -ArgumentList @('-F', ('"' + $config + '"'), '-N', $alias) `
        -WindowStyle Hidden -RedirectStandardError $log -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 24; $attempt++) {
        if ($process.HasExited) { break }
        if (Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $port -OwningProcess $process.Id -ErrorAction SilentlyContinue) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (!$ready) { throw "Não foi possível abrir o túnel $alias. Veja $log." }
}
Write-Output 'Túneis locais do PostgreSQL e do Redis disponíveis.'
