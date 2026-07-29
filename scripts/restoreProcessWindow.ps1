param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ProcessId
)

$ErrorActionPreference = 'Stop'
$process = Get-Process -Id $ProcessId -ErrorAction Stop
$windowHandle = [IntPtr]$process.MainWindowHandle
if ($windowHandle -eq [IntPtr]::Zero) {
  exit 3
}

if (-not ('GewuWindowActivation.NativeMethods' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace GewuWindowActivation {
  public static class NativeMethods {
    public const int SW_RESTORE = 9;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
  }
}
'@
}

[GewuWindowActivation.NativeMethods]::ShowWindowAsync(
  $windowHandle,
  [GewuWindowActivation.NativeMethods]::SW_RESTORE
) | Out-Null
Start-Sleep -Milliseconds 150
[GewuWindowActivation.NativeMethods]::SetForegroundWindow($windowHandle) | Out-Null

$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($ProcessId)) {
  exit 4
}

Start-Sleep -Milliseconds 150
