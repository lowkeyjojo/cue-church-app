# Installs Cue on Windows:
#
#   irm https://raw.githubusercontent.com/lowkeyjojo/cue-church-app/main/install.ps1 | iex
#
# It downloads the newest Cue-windows-setup.exe from the Releases page, checks
# it against the published SHA-256, installs it for the current user (no
# administrator prompt) and opens Cue. From then on Cue keeps itself up to
# date. It changes no security settings.
#
# For testing:
#   $env:CUE_INSTALL_FROM = '<folder>'   use the Cue-windows-setup.exe and SHA256SUMS.txt in it instead of downloading
#   $env:CUE_INSTALL_NO_LAUNCH = '1'     don't open Cue afterwards
# The checksum is always checked.
#
# Works in Windows PowerShell 5.1 and later. Kept to plain ASCII, so it reads
# the same however it was fetched. Everything runs inside a script block, so
# nothing is left behind in the PowerShell session it was pasted into.

& {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell draws a progress bar that makes downloads many times slower.
  $ProgressPreference = 'SilentlyContinue'

  $base = 'https://github.com/lowkeyjojo/cue-church-app/releases/latest/download'
  $name = 'Cue-windows-setup.exe'
  $sumsName = 'SHA256SUMS.txt'
  $help = 'https://github.com/lowkeyjojo/cue-church-app#install'

  if ($env:OS -ne 'Windows_NT') {
    throw "Cue was not installed: this installer is for Windows. For a Mac, see $help"
  }

  # Windows PowerShell 5.1 may not offer TLS 1.2 by itself, and GitHub accepts nothing older.
  try {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch {
    # Newer PowerShell versions negotiate TLS without this.
  }

  $work = $null
  try {
    if ($env:CUE_INSTALL_FROM) {
      $installer = Join-Path $env:CUE_INSTALL_FROM $name
      $sums = Join-Path $env:CUE_INSTALL_FROM $sumsName
      if (-not (Test-Path -LiteralPath $installer) -or -not (Test-Path -LiteralPath $sums)) {
        throw "Cue was not installed: $($env:CUE_INSTALL_FROM) needs both $name and $sumsName"
      }
      Write-Host "Using $installer"
    } else {
      $work = Join-Path ([IO.Path]::GetTempPath()) ('cue-install-' + [Guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $work | Out-Null
      $installer = Join-Path $work $name
      $sums = Join-Path $work $sumsName
      Write-Host 'Downloading Cue...'
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$sumsName" -OutFile $sums
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $installer
      } catch {
        throw "Cue was not installed: the download didn't finish ($($_.Exception.Message)). Check the internet connection and run this again."
      }
    }

    Write-Host 'Checking the download...'
    # Lines look like "<hash>  <name>" or "<hash> *<name>".
    $expected = $null
    foreach ($line in (Get-Content -LiteralPath $sums)) {
      $parts = $line.Trim() -split '\s+', 2
      if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -ceq $name) {
        $expected = $parts[0].ToLowerInvariant()
        break
      }
    }
    $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $expected -or $expected -notmatch '^[0-9a-f]{64}$' -or $actual -cne $expected) {
      # A download that can't be trusted is not kept. (Files given with CUE_INSTALL_FROM are left alone.)
      if ($work) { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }
      throw "Cue was not installed: $name doesn't match its published checksum, so it was not run. Run this again; if it keeps happening, see $help"
    }

    if (Get-Process -Name Cue -ErrorAction SilentlyContinue) {
      Write-Host 'Cue is open: it closes while the new version is installed.'
    }
    Write-Host 'Installing Cue...'
    # /S: no questions. Cue installs for this user only, so Windows doesn't ask for an administrator.
    $process = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru
    $null = $process.Handle # Windows PowerShell forgets the exit code without this
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "Cue was not installed: the installer stopped with code $($process.ExitCode)."
    }

    $programs = Join-Path $env:LOCALAPPDATA 'Programs'
    $exe = $null
    foreach ($attempt in 1..60) {
      $usual = Join-Path $programs 'cue\Cue.exe'
      if (Test-Path -LiteralPath $usual) {
        $exe = $usual
        break
      }
      $found = Get-ChildItem -Path $programs -Filter 'Cue.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($found) {
        $exe = $found.FullName
        break
      }
      Start-Sleep -Seconds 1
    }
    if (-not $exe) {
      throw "Cue was not installed: the installer finished, but Cue.exe is not in $programs."
    }

    if ($env:CUE_INSTALL_NO_LAUNCH -eq '1') {
      Write-Host "Cue is installed: $exe"
    } else {
      Start-Process -FilePath $exe
      Write-Host 'Cue is installed and is opening. It keeps itself up to date from here.'
    }
  } finally {
    if ($work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  }
}
