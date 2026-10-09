# Replays one fixed sequence of Code tab states at the current emulator size and saves or
# compares a layout fingerprint at each step, so a narrow-screen change can be proven to
# leave the desktop layout exactly as it was.
#
#   powershell -File tools/scratch/code-desk-regress.ps1 save|compare
param([string]$Mode = 'compare')
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..\..')

node tools/scratch/code-fixture.cjs cleanup | Out-Null
Start-Sleep -Seconds 3
node tools/scratch/layout-fingerprint.cjs $Mode desk-landing

node tools/scratch/code-fixture.cjs chat | Out-Null
Start-Sleep -Seconds 8
node tools/scratch/layout-fingerprint.cjs $Mode desk-chat

node tools/scratch/code-fixture.cjs seed | Out-Null
node tools/scratch/code-fixture.cjs inject | Out-Null
Start-Sleep -Seconds 10
node tools/scratch/layout-fingerprint.cjs $Mode desk-ws-preview

node tools/scratch/dom-click.cjs "button[aria-label=Code]" 0 | Out-Null
Start-Sleep -Seconds 2
node tools/scratch/layout-fingerprint.cjs $Mode desk-ws-code

node tools/scratch/dom-click.cjs "div.cursor-pointer" 0 --label=App.tsx | Out-Null
Start-Sleep -Seconds 2
node tools/scratch/layout-fingerprint.cjs $Mode desk-ws-code-file

node tools/scratch/code-fixture.cjs cleanup
