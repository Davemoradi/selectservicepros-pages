# Phase 0.4 verification (with precreate): Stripe customer race condition fix.
#
# Pre-creates a Stripe Customer for the test email, then POSTs to
# /api/create-checkout-session twice with that email (Pro then Elite).
# The fix in api/create-checkout-session.js should look up the existing
# customer and route BOTH sessions through `customer: <cus_id>` instead
# of creating duplicates via `customer_email`.
#
# Pass criteria:
#   - Customer count for the email stays at 1 (no duplicate)
#   - Both sessions reference the precreated customer ID
#
# Run: powershell -File scripts\test-0.4-race-with-precreate.ps1

# Refresh PATH so winget-installed stripe.exe is on PATH for this shell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

$ts = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$email = "test-race-may05-precreate-$ts@example.com"
$endpoint = 'https://www.selectservicepros.com/api/create-checkout-session'
Write-Output "Test email: $email"
Write-Output ''

# ---------------------------------------------------------------------------
# STEP 1: Pre-create the Stripe customer
# ---------------------------------------------------------------------------
Write-Output '=== STEP 1: Pre-create Stripe customer ==='
$createRaw = stripe customers create --email $email --name 'Race Test Precreate' | Out-String
Write-Output '--- raw output of customers create ---'
Write-Output $createRaw
$createParsed = $null
try { $createParsed = $createRaw | ConvertFrom-Json } catch { Write-Output "(ConvertFrom-Json failed: $_)" }
$precreateCustomerId = $createParsed.id
Write-Output "Pre-created customer ID: $precreateCustomerId"
Write-Output ''

if (-not $precreateCustomerId) {
    Write-Output 'ERROR: failed to capture precreated customer ID; aborting before any POSTs.'
    exit 1
}

# ---------------------------------------------------------------------------
# STEP 2: POST 1 (Pro) to the deployed endpoint
# ---------------------------------------------------------------------------
Write-Output '=== STEP 2: POST 1 (Pro) ==='
$body1 = @{ planId = 'pro'; email = $email; name = 'Race Test'; phone = '5555551234'; companyName = 'Race Co' } | ConvertTo-Json -Compress
$resp1 = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $body1
$sid1 = ($resp1.clientSecret -split '_secret_')[0]
Write-Output "Session 1 ID: $sid1"
Write-Output ''

# ---------------------------------------------------------------------------
# STEP 3: POST 2 (Elite, same email)
# ---------------------------------------------------------------------------
Write-Output '=== STEP 3: POST 2 (Elite, same email) ==='
$body2 = @{ planId = 'elite'; email = $email; name = 'Race Test'; phone = '5555551234'; companyName = 'Race Co' } | ConvertTo-Json -Compress
$resp2 = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $body2
$sid2 = ($resp2.clientSecret -split '_secret_')[0]
Write-Output "Session 2 ID: $sid2"
Write-Output ''

# ---------------------------------------------------------------------------
# STEP 4: Customer search by email - expecting 1 (the precreated one only)
# ---------------------------------------------------------------------------
Write-Output '=== STEP 4: Customer search ==='
$searchRaw = stripe customers list --email $email --limit 10 | Out-String
Write-Output '--- raw output of customers search ---'
Write-Output $searchRaw
$searchParsed = $null
try { $searchParsed = $searchRaw | ConvertFrom-Json } catch { Write-Output "(ConvertFrom-Json failed: $_)" }
$customerCount = if ($null -ne $searchParsed) { @($searchParsed.data).Count } else { -1 }
Write-Output "Customer count (parsed): $customerCount"
Write-Output ''

# ---------------------------------------------------------------------------
# STEP 5: Session 1 - full raw output, then parsed view
# ---------------------------------------------------------------------------
Write-Output '=== STEP 5: Session 1 retrieve (raw, then parsed) ==='
$s1Raw = stripe checkout sessions retrieve $sid1 | Out-String
Write-Output '--- raw output of session 1 retrieve ---'
Write-Output $s1Raw
$s1Parsed = $null
try { $s1Parsed = $s1Raw | ConvertFrom-Json } catch { Write-Output "(ConvertFrom-Json failed: $_)" }
if ($s1Parsed) {
    Write-Output '--- parsed view of session 1 ---'
    $s1Parsed | Select-Object id, customer, customer_email, mode, status, livemode, payment_status | Format-List
} else {
    Write-Output '(parsed view unavailable - see raw above)'
}
Write-Output ''

# ---------------------------------------------------------------------------
# STEP 6: Session 2 - full raw output, then parsed view
# ---------------------------------------------------------------------------
Write-Output '=== STEP 6: Session 2 retrieve (raw, then parsed) ==='
$s2Raw = stripe checkout sessions retrieve $sid2 | Out-String
Write-Output '--- raw output of session 2 retrieve ---'
Write-Output $s2Raw
$s2Parsed = $null
try { $s2Parsed = $s2Raw | ConvertFrom-Json } catch { Write-Output "(ConvertFrom-Json failed: $_)" }
if ($s2Parsed) {
    Write-Output '--- parsed view of session 2 ---'
    $s2Parsed | Select-Object id, customer, customer_email, mode, status, livemode, payment_status | Format-List
} else {
    Write-Output '(parsed view unavailable - see raw above)'
}
Write-Output ''

# ---------------------------------------------------------------------------
# STEP 7: Verdict
# ---------------------------------------------------------------------------
Write-Output '=== VERDICT ==='
$s1Customer = if ($s1Parsed) { $s1Parsed.customer } else { $null }
$s2Customer = if ($s2Parsed) { $s2Parsed.customer } else { $null }
Write-Output "Pre-created customer ID:    $precreateCustomerId"
Write-Output "Customer count after POSTs: $customerCount"
Write-Output "Session 1 customer field:   $s1Customer"
Write-Output "Session 2 customer field:   $s2Customer"
Write-Output ''

if ($customerCount -eq 1 -and $s1Customer -eq $precreateCustomerId -and $s2Customer -eq $precreateCustomerId) {
    Write-Output 'RESULT: PASS - fix engaged. Both sessions reuse the pre-created customer; no duplicates.'
} elseif ($customerCount -ge 2) {
    Write-Output "RESULT: FAIL - fix did not engage. $customerCount customers exist for this email; should be 1."
} else {
    Write-Output 'RESULT: INCONCLUSIVE - review the raw output above to diagnose.'
}
