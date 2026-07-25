param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$dll = Join-Path $PSScriptRoot 'openxml-sdk\package\lib\net46\DocumentFormat.OpenXml.dll'
Add-Type -Path $dll
$document = [DocumentFormat.OpenXml.Packaging.WordprocessingDocument]::Open((Resolve-Path $Path).Path, $false)
try {
  $validator = New-Object DocumentFormat.OpenXml.Validation.OpenXmlValidator([DocumentFormat.OpenXml.FileFormatVersions]::Office2019)
  $errors = @($validator.Validate($document))
  [pscustomobject]@{ Count = $errors.Count; Errors = @($errors | Select-Object -First 100 | ForEach-Object {
    [pscustomobject]@{
      Id = $_.Id
      Description = $_.Description
      Part = $_.Part.Uri.ToString()
      Path = $_.Path.XPath
      Node = if ($_.Node) { $_.Node.OuterXml.Substring(0, [Math]::Min(500, $_.Node.OuterXml.Length)) } else { '' }
    }
  }) } | ConvertTo-Json -Depth 6
}
finally {
  $document.Dispose()
}
