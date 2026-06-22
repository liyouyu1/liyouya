param(
  [string]$Message = "Update project"
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
  throw "No current Git branch was found."
}

$status = & git status --porcelain
if ($status) {
  Invoke-Git @("add", ".")

  $staged = & git diff --cached --name-only
  if ($staged) {
    Invoke-Git @("commit", "-m", $Message)
  }
}

Invoke-Git @("push")
Invoke-Git @("status", "-sb")
