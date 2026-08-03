param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('audit', 'ensure', 'remove')]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$RuleName,
  [Parameter(Mandatory = $true)]
  [string]$RuleDescription,
  [Parameter(Mandatory = $true)]
  [string]$ProgramPath,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 65535)]
  [int]$Port
)

$ErrorActionPreference = 'Stop'

function Test-StableInstalledProgram {
  param([string]$Candidate)
  $fullPath = [System.IO.Path]::GetFullPath($Candidate)
  $normalized = $fullPath.Replace('/', '\\').ToLowerInvariant()
  if (-not $normalized.EndsWith('.exe')) { return $false }
  foreach ($fragment in @('\\temp\\', '\\tmp\\', '\\win-unpacked\\', '\\node_modules\\.cache\\')) {
    if ($normalized.Contains($fragment)) { return $false }
  }
  return Test-Path -LiteralPath $fullPath -PathType Leaf
}

function Get-ManagedRuleState {
  $rules = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
  if ($rules.Count -eq 0) {
    return @{ managed = $false; state = 'missing'; ruleName = $RuleName }
  }
  if ($rules.Count -ne 1) {
    return @{ managed = $false; state = 'conflict'; ruleName = $RuleName; reason = 'RULE_COUNT' }
  }
  $rule = $rules[0]
  if ($rule.Description -ne $RuleDescription) {
    return @{ managed = $false; state = 'conflict'; ruleName = $RuleName; reason = 'DESCRIPTION' }
  }
  $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
  $portFilter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule
  $addressFilter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule
  $programOk = [string]::Equals($application.Program, [System.IO.Path]::GetFullPath($ProgramPath), [System.StringComparison]::OrdinalIgnoreCase)
  $protocolOk = ("$($portFilter.Protocol)" -eq 'TCP' -or "$($portFilter.Protocol)" -eq '6')
  $portOk = "$($portFilter.LocalPort)" -eq "$Port"
  $addressOk = "$($addressFilter.RemoteAddress)" -eq 'LocalSubnet'
  $profileOk = ("$($rule.Profile)" -eq 'Private' -or "$($rule.Profile)" -eq '2')
  $enabledOk = "$($rule.Enabled)" -eq 'True'
  $directionOk = "$($rule.Direction)" -eq 'Inbound'
  $actionOk = "$($rule.Action)" -eq 'Allow'
  if (-not ($programOk -and $protocolOk -and $portOk -and $addressOk -and $profileOk -and $enabledOk -and $directionOk -and $actionOk)) {
    return @{ managed = $false; state = 'conflict'; ruleName = $RuleName; reason = 'RULE_PROPERTIES' }
  }
  return @{ managed = $true; state = 'enabled'; ruleName = $RuleName; localPort = $Port }
}

try {
  if (-not (Test-StableInstalledProgram -Candidate $ProgramPath)) {
    throw 'WINDOWS_FIREWALL_STABLE_INSTALL_REQUIRED'
  }

  $state = Get-ManagedRuleState
  if ($Mode -eq 'audit') {
    $state | ConvertTo-Json -Compress
    exit 0
  }
  if ($Mode -eq 'ensure') {
    if ($state.state -eq 'conflict') {
      return @{ managed = $false; state = 'conflict'; ruleName = $RuleName } | ConvertTo-Json -Compress
    }
    if ($state.state -eq 'missing') {
      New-NetFirewallRule -DisplayName $RuleName -Description $RuleDescription -Direction Inbound -Action Allow -Enabled True -Program $ProgramPath -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Private | Out-Null
    }
    Get-ManagedRuleState | ConvertTo-Json -Compress
    exit 0
  }
  if ($state.managed -ne $true) {
    $state | ConvertTo-Json -Compress
    exit 0
  }
  $rule = @(Get-NetFirewallRule -DisplayName $RuleName)[0]
  Remove-NetFirewallRule -Name $rule.Name
  @{ managed = $false; state = 'removed'; ruleName = $RuleName } | ConvertTo-Json -Compress
  exit 0
} catch {
  @{ managed = $false; state = 'error'; error = $_.Exception.Message; ruleName = $RuleName } | ConvertTo-Json -Compress
  exit 1
}
