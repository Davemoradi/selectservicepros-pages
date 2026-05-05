# Phase 0.4 verification: Stripe customer race condition fix.
#
# POSTs to /api/create-checkout-session twice with the same email
# (Pro then Elite) and inspects whether the second session reuses
# the first's customer (fix engaged) or creates a duplicate (bug
# present). See docs/V2-PLAN.md section 0.4 and api/create-checkout-session.js.
#
# Run: powershell -File scripts\test-0.4-race.ps1

# Refresh PATH so winget-installed stripe.exe is on PATH for this shell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$email = "test-race-may05-$ts@example.com"
$endpoint = 'https://www.selectservicepros.com/api/create-checkout-session'
Write-Output "Test email: $email"
Write-Output ''

# POST 1: Pro
Write-Output '=== POST 1 (Pro) ==='
$body1 = @{ planId = 'pro'; email = $email; name = 'Test Race'; phone = '5555551234'; companyName = 'Test Co' } | ConvertTo-Json -Compress
$resp1 = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $body1
$sid1 = ($resp1.clientSecret -split '_secret_')[0]
Write-Output "  Session 1 ID: $sid1"
Write-Output ''

# POST 2: Elite (same email)
Write-Output '=== POST 2 (Elite, same email) ==='
$body2 = @{ planId = 'elite'; email = $email; name = 'Test Race'; phone = '5555551234'; companyName = 'Test Co' } | ConvertTo-Json -Compress
$resp2 = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $body2
$sid2 = ($resp2.clientSecret -split '_secret_')[0]
Write-Output "  Session 2 ID: $sid2"
Write-Output ''

# Customer count for the test email
Write-Output "=== Customers in Stripe (test mode) for $email ==="
stripe customers search --query "email:'$email'"
Write-Output ''

# Session 1 details (just the fields that distinguish the two code paths)
Write-Output '=== Session 1 (Pro) - relevant fields ==='
$s1 = stripe checkout sessions retrieve $sid1 | ConvertFrom-Json
$s1 | Select-Object id, customer, customer_email, mode, status, livemode, payment_status | Format-List
Write-Output ''

# Session 2 details
Write-Output '=== Session 2 (Elite) - relevant fields ==='
$s2 = stripe checkout sessions retrieve $sid2 | ConvertFrom-Json
$s2 | Select-Object id, customer, customer_email, mode, status, livemode, payment_status | Format-List
