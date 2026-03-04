# CMDB Local Agent — PowerShell puro, sem instalacao, sem admin
# Uso: clique direito → "Executar com PowerShell"
# Para iniciar automaticamente: coloque um atalho em:
#   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

$PORT     = 27420
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$PORT/")
$listener.Start()

Write-Host "CMDB Agent rodando em http://127.0.0.1:$PORT" -ForegroundColor Green
Write-Host "Minimize esta janela. Nao feche." -ForegroundColor Yellow

function Send-Response($ctx, $body = "", $status = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $ctx.Response.StatusCode = $status
    $ctx.Response.ContentType = "application/json"
    $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $ctx.Response.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
    $ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

    $ctx.Response.ContentLength64 = $bytes.Length

    if ($bytes.Length -gt 0) {
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }

    $ctx.Response.OutputStream.Close()
}

function Open-RDP($data) {
    $host_    = $data.host
    $port_    = if ($data.port -and $data.port -ne "3389") { $data.port } else { $null }
    $user     = $data.user
    $domain   = $data.domain
    $gw       = $data.gateway
    $gwUser   = if ($data.gatewayUser) { $data.gatewayUser } else { $user }
    $gwPass   = $data.gatewayPass
    $password = $data.password

    $rdpHost  = if ($port_) { "${host_}:${port_}" } else { $host_ }
    $fullUser = if ($domain) { "$domain\$user" } else { $user }

    # Injeta credenciais via cmdkey (sem permanencia — apenas sessao atual)
    if ($password -and $user) {
        & cmdkey /add:"TERMSRV/$rdpHost"  /user:$fullUser  /pass:$password | Out-Null
        & cmdkey /add:"TERMSRV/$host_"    /user:$fullUser  /pass:$password | Out-Null
    }
    if ($gw -and $gwPass) {
        & cmdkey /add:$gw                 /user:$gwUser    /pass:$gwPass   | Out-Null
        & cmdkey /add:"TERMSRV/$gw"       /user:$gwUser    /pass:$gwPass   | Out-Null
    }

    # Gera .rdp temporario
    $rdp = @"
full address:s:$rdpHost
username:s:$fullUser
prompt for credentials:i:$(if ($password) { "0" } else { "1" })
administrative session:i:0
authentication level:i:2
enablecredsspsupport:i:1
negotiate security layer:i:1
autoreconnection enabled:i:1
compression:i:1
connection type:i:7
networkautodetect:i:1
bandwidthautodetect:i:1
"@
    if ($gw) {
        $rdp += @"
gatewayhostname:s:$gw
gatewayusagemethod:i:1
gatewayprofileusagemethod:i:1
gatewaycredentialssource:i:0
gatewayusername:s:$gwUser
promptcredentialonce:i:1
"@
    }

    $tmpFile = [System.IO.Path]::GetTempFileName() -replace "\.tmp$", ".rdp"
    [System.IO.File]::WriteAllText($tmpFile, $rdp)
    Start-Process mstsc.exe $tmpFile

    # Remove credenciais apos 30s (opcional — mais seguro)
    Start-Job -ScriptBlock {
        param($f, $h, $u, $g, $gu)
        Start-Sleep 30
        Remove-Item $f -ErrorAction SilentlyContinue
        & cmdkey /delete:"TERMSRV/$h"  | Out-Null
        & cmdkey /delete:$h            | Out-Null
        if ($g) { & cmdkey /delete:"TERMSRV/$g" | Out-Null }
    } -ArgumentList $tmpFile, $rdpHost, $fullUser, $gw, $gwUser | Out-Null
}

function Open-SSH($data) {
    $host_      = $data.host
    $port_      = if ($data.port) { $data.port } else { 22 }
    $user       = $data.user
    $jump       = $data.sshJump
    $jumpUser   = $data.sshJumpUser

    if ($jump) {
        $jumpTarget = if ($jumpUser) { "${jumpUser}@${jump}" } else { $jump }
        $innerCmd   = "ssh -t -p $port_ ${user}@${host_}"
        $cmd        = "ssh -t $jumpTarget `"$innerCmd`""
    } else {
        $userPart = if ($user) { "${user}@" } else { "" }
        $portPart = if ($port_ -ne 22) { " -p $port_" } else { "" }
        $cmd      = "ssh${portPart} ${userPart}${host_}"
    }

    # Tenta Windows Terminal primeiro, senao cmd
    $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($wt) {
        Start-Process wt.exe "new-tab -- $cmd"
    } else {
        Start-Process cmd.exe "/k $cmd"
    }
}

while ($listener.IsListening) {
    try {
        $ctx  = $listener.GetContext()
        $req  = $ctx.Request
        $url  = $req.Url.AbsolutePath

        if ($req.HttpMethod -eq "OPTIONS") {
			Send-Response $ctx "" 204
			continue
		}

        if ($url -eq "/health") {
            Send-Response $ctx '{"ok":true,"version":"2.0","type":"powershell"}'
            continue
        }

        if ($req.HttpMethod -eq "POST") {
            $body   = (New-Object System.IO.StreamReader($req.InputStream)).ReadToEnd()
            $data   = $body | ConvertFrom-Json

            switch ($url) {
                "/rdp" {
                    Open-RDP $data
                    Send-Response $ctx '{"ok":true}'
                }
                "/ssh" {
                    Open-SSH $data
                    Send-Response $ctx '{"ok":true}'
                }
                default {
                    Send-Response $ctx '{"ok":false,"error":"Unknown endpoint"}' 404
                }
            }
        } else {
            Send-Response $ctx '{"ok":false,"error":"Method not allowed"}' 405
        }
    } catch {
        Write-Host "Erro: $_" -ForegroundColor Red
    }
}
