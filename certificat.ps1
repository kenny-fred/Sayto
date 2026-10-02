# ============================================
# Gestionnaire de certificats mkcert
# ============================================

$CertDir = "C:\Users\kenny\Documents\Licence\Etudes\human computer interface\tools"
$OutputCert = "cert.pem"
$OutputKey = "key.pem"
$IpFile = Join-Path $CertDir "cert-ips.json"

# Charger les IPs existantes
$defaultIps = @("localhost", "127.0.0.1", "::1")
$existingIps = @()

function Load-Ips {
    $script:existingIps = @()
    if (Test-Path $IpFile) {
        $data = Get-Content $IpFile -Raw | ConvertFrom-Json
        $script:existingIps = $data.ips
    } else {
        $script:existingIps = $defaultIps
    }
}

function Save-Ips {
    $ipData = @{ ips = $script:existingIps }
    $ipData | ConvertTo-Json | Set-Content $IpFile -Encoding UTF8
}

function Show-Ips {
    Write-Host ""
    Write-Host "IPs actuelles dans le certificat :" -ForegroundColor Cyan
    foreach ($ip in $script:existingIps) {
        Write-Host "   * $ip" -ForegroundColor White
    }
}

function Generate-Cert {
    # Supprimer l'ancien certificat
    $oldCert = Join-Path $CertDir $OutputCert
    $oldKey = Join-Path $CertDir $OutputKey
    if (Test-Path $oldCert) { Remove-Item $oldCert -Force }
    if (Test-Path $oldKey) { Remove-Item $oldKey -Force }

    Write-Host ""
    Write-Host "Generation du certificat avec les IPs :" -ForegroundColor Cyan
    foreach ($ip in $script:existingIps) {
        Write-Host "   * $ip" -ForegroundColor White
    }

    Set-Location $CertDir
    $certFile = Join-Path $CertDir $OutputCert
    $keyFile = Join-Path $CertDir $OutputKey
    $mkcertArgs = @("-cert-file", $certFile, "-key-file", $keyFile) + $script:existingIps

    $argsString = ""
    foreach ($arg in $mkcertArgs) {
        $argsString = $argsString + " " + $arg
    }
    Write-Host ""
    Write-Host "Execution : mkcert $argsString" -ForegroundColor DarkGray

    & mkcert $mkcertArgs

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Certificat genere avec succes !" -ForegroundColor Green
        Write-Host "   Fichier : $OutputCert" -ForegroundColor White
        Write-Host "   Cle     : $OutputKey" -ForegroundColor White
        Write-Host ""
        Write-Host "Copie ces fichiers dans le dossier 'certs/' de ton projet." -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "Erreur lors de la generation du certificat." -ForegroundColor Red
    }
}

function Add-Ip {
    $newIp = Read-Host "Entre l'IP a ajouter (ex: 192.168.1.100)"
    $newIp = $newIp.Trim()
    
    if ($script:existingIps -contains $newIp) {
        Write-Host ""
        Write-Host "L'IP '$newIp' est deja dans le certificat !" -ForegroundColor Red
        return
    }
    
    $script:existingIps += $newIp
    Save-Ips
    Write-Host ""
    Write-Host "IP '$newIp' ajoutee." -ForegroundColor Green
    Generate-Cert
}

function Remove-Ip {
    if ($script:existingIps.Count -eq 0) {
        Write-Host ""
        Write-Host "Aucune IP a retirer." -ForegroundColor Red
        return
    }
    
    Write-Host ""
    Write-Host "IPs disponibles :" -ForegroundColor Cyan
    for ($i = 0; $i -lt $script:existingIps.Count; $i++) {
        Write-Host "  [$i] $($script:existingIps[$i])"
    }
    
    $index = Read-Host "Entre le numero de l'IP a retirer"
    
    if ($index -match '^\d+$' -and [int]$index -ge 0 -and [int]$index -lt $script:existingIps.Count) {
        $removed = $script:existingIps[[int]$index]
        
        if ($removed -eq "localhost" -or $removed -eq "127.0.0.1" -or $removed -eq "::1") {
            Write-Host ""
            Write-Host "Impossible de retirer '$removed' (IP critique)." -ForegroundColor Yellow
            return
        }
        
        $newIps = @()
        foreach ($ip in $script:existingIps) {
            if ($ip -ne $removed) {
                $newIps += $ip
            }
        }
        $script:existingIps = $newIps
        Save-Ips
        Write-Host ""
        Write-Host "IP '$removed' retiree." -ForegroundColor Green
        Generate-Cert
    } else {
        Write-Host ""
        Write-Host "Index invalide." -ForegroundColor Red
    }
}

# ============ MENU PRINCIPAL ============

Load-Ips

while ($true) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Blue
    Write-Host "  GESTIONNAIRE DE CERTIFICAT MKCERT" -ForegroundColor Blue
    Write-Host "========================================" -ForegroundColor Blue
    Write-Host ""
    Write-Host "Que veux-tu faire ?" -ForegroundColor Yellow
    Write-Host "  [1] Ajouter une IP au certificat"
    Write-Host "  [2] Retirer une IP du certificat"
    Write-Host "  [3] Regenerer avec les IPs actuelles"
    Write-Host "  [4] Voir les IPs actuelles"
    Write-Host "  [5] Quitter"
    
    $choice = Read-Host "Ton choix (1-5)"
    
    if ($choice -eq "1") {
        Add-Ip
    }
    elseif ($choice -eq "2") {
        Remove-Ip
    }
    elseif ($choice -eq "3") {
        Generate-Cert
    }
    elseif ($choice -eq "4") {
        Show-Ips
    }
    elseif ($choice -eq "5") {
        Write-Host ""
        Write-Host "Au revoir !" -ForegroundColor Green
        break
    }
    else {
        Write-Host ""
        Write-Host "Choix invalide." -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Appuie sur une touche pour continuer..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}