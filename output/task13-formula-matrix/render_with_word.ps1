$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$output = Join-Path $root 'word-pdf-renders'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$word = $null
$createdWord = $false
try {
  try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application') }
  catch { $word = New-Object -ComObject Word.Application; $createdWord = $true }
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  foreach ($source in Get-ChildItem -LiteralPath $root -Filter *.docx) {
    $document = $null
    $openedHere = $false
    try {
      Write-Output "opening $($source.Name)"
      foreach ($candidate in $word.Documents) {
        if ($candidate.FullName -eq $source.FullName) { $document = $candidate; break }
      }
      if ($null -eq $document) {
        $document = $word.Documents.Open($source.FullName, $false, $true, $false)
        $openedHere = $true
      }
      $target = Join-Path $output ($source.BaseName + '.pdf')
      $document.ExportAsFixedFormat($target, 17)
      [pscustomobject]@{ Source = $source.Name; Pdf = $target; Bytes = (Get-Item -LiteralPath $target).Length }
    }
    finally {
      if ($openedHere -and $null -ne $document) { $document.Close(0) }
    }
  }
}
finally {
  if ($createdWord -and $null -ne $word) { $word.Quit() }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
