#!/usr/bin/env python3
"""Smoke test: every Domain Services flow through the live preview (real HTTP).

Exercises all 9 hub cards + dashboard + admin against the running preview on :3000.
Uses the exact route contracts from src/routes/domain-services.ts and domain-brokerage.ts.
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3000"
PASSWORD = "demo-password-123"
results = []


def call(method, path, token=None, payload=None, expect=200):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    body = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(req, body) as res:
            code, data = res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        code, data = e.code, json.loads(e.read() or b"{}")
    if isinstance(expect, int):
        expect = [expect]
    return code in expect, code, data


def check(name, ok, detail):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  — {detail}")


def login(email):
    ok, code, data = call("POST", "/api/auth/login", payload={"email": email, "password": PASSWORD})
    assert ok, f"login failed for {email}: {code}"
    return data["token"]


root = login("root@demo.cloudhost247.test")
amaka = login("amaka@demo-customer.test")

CONTACT = {
    "firstName": "Amaka", "lastName": "Obi", "email": "amaka@demo-customer.test",
    "phone": "+234.8012345678", "addressLine1": "1 Demo Way", "city": "Lagos",
    "state": "LA", "postalCode": "100001", "countryCode": "NG",
}

# --- 1. FIND A DOMAIN --------------------------------------------------------------------------
ok, code, data = call("POST", "/api/v1/domain-services/search", amaka, {"query": "amaka-brand"})
first = next((r for r in data.get("results", []) if r["domainName"] == "amaka-brand.com"), {})
check("1a search: available + provider price", ok and data.get("status") == "completed"
      and first.get("availabilityStatus") == "available" and first.get("registrationPrice") == "10.98",
      f"{data.get('status')}, amaka-brand.com={first.get('availabilityStatus')}@{first.get('registrationPrice')}")

ok, code, data = call("POST", "/api/v1/domain-services/search", amaka, {"query": "amaka-brand-taken"})
reg = next((r for r in data.get("results", []) if r["domainName"] == "amaka-brand-taken.com"), {})
check("1b search: taken reported as registered", ok and reg.get("availabilityStatus") == "registered",
      f"amaka-brand-taken.com={reg.get('availabilityStatus')}")

ok, code, data = call("GET", "/api/v1/domain-services/extensions")
trending = [e["extension"] for e in data.get("extensions", []) if e.get("isTrending")]
check("1c extensions: catalogue synced with admin trending badges",
      ok and len(data.get("extensions", [])) == 11 and trending == [".ai", ".dev", ".io"],
      f"{len(data.get('extensions', []))} extensions, trending={trending}")

# --- 2. DOMAIN INVESTING -----------------------------------------------------------------------
ok, code, data = call("GET", "/api/v1/domain-services/auctions")
live = [a for a in data.get("auctions", []) if a.get("status") == "live"]
check("2a auctions: live auction listed", ok and any(a["domainName"] == "brandstack.com" for a in live),
      f"live={[a['domainName'] for a in live]}")
auction_id = next((a["id"] for a in data.get("auctions", []) if a["domainName"] == "brandstack.com"), None)

ok, code, data = call("GET", f"/api/v1/domain-services/auctions/{auction_id}", amaka)
check("2b auction detail: amaka's bid visible", ok and any(
    b.get("amount") == "260.00" for b in data.get("bids", [])),
    f"{len(data.get('bids', []))} bids, top={data.get('bids', [{}])[0].get('amount')}")

ok, code, data = call("POST", "/api/v1/domain-services/appraisals", amaka, {"domainName": "amaka-brand.com"}, 201)
check("2c appraisal: honest not-configured (no fabricated value)",
      ok and data.get("status") == "provider_not_configured", f"status={data.get('status')}")

ok, code, data = call("GET", "/api/v1/domain-services/club/plans")
plan = next((p for p in data.get("plans", []) if p.get("status") == "published"), {})
check("2d club: published plan with member discount", ok and plan
      and plan.get("discountType") == "percentage" and plan.get("discountValue") == "25.00",
      f"{plan.get('name', '-')}: -{plan.get('discountValue')}% (${plan.get('priceAmount')}/{plan.get('billingPeriod')})")

ok, code, data = call("GET", "/api/v1/domain-services/club/pricing-preview?standardPrice=20.00", amaka)
check("2e club pricing preview: member price computed server-side",
      ok and data.get("memberPrice") == "15.00", f"standard=20.00 member={data.get('memberPrice')}")

# --- 3. DOMAIN TOOLS AND SERVICES --------------------------------------------------------------
# Anonymous WHOIS has a burst throttle; on re-runs a 429 rate_limited is the correct answer.
def whois(domain):
    ok, code, data = call("POST", "/api/v1/domain-services/whois", None, {"domainName": domain}, [200, 429])
    if code == 429:
        data = {"status": "rate_limited"}
    return ok, code, data

ok, code, data = whois("taken-public.com")
check("3a whois: public registrant shown", ok and data.get("status") in ("completed", "rate_limited")
      and (data.get("status") == "rate_limited" or data.get("result", {}).get("privacyProtected") is False),
      f"status={data.get('status')}")

ok, code, data = whois("taken-private.net")
check("3b whois: privacy protected reported honestly", ok and data.get("status") in ("completed", "rate_limited")
      and (data.get("status") == "rate_limited" or data.get("result", {}).get("privacyProtected") is True),
      f"status={data.get('status')}")

ok, code, data = whois("no-record-here.com")
check("3c whois: unregistered = not_found (not an error)", ok
      and data.get("status") in ("not_found", "rate_limited"), f"status={data.get('status')}")

ok, code, data = call("POST", "/api/v1/domain-services/bulk-search", amaka,
                      {"content": "amaka-brand.com\namaka-brand.ai\ntaken-private.net"}, [200, 429])
if code == 429:
    data = {"status": "rate_limited"}
# Bulk search is throttled per hour; a rate_limited answer on re-runs is correct behaviour.
by = {r.get("domainName"): r.get("availabilityStatus") for r in data.get("results", [])}
check("3d bulk search: batched statuses", ok and (
      data.get("status") == "rate_limited"
      or (data.get("status") == "completed"
          and by.get("amaka-brand.com") == "available" and by.get("amaka-brand.ai") == "premium"
          and by.get("taken-private.net") == "registered")),
      f"status={data.get('status')} {by}")

transfer_domain = f"taken-run-{int(time.time())}.net"
ok, code, data = call("POST", "/api/v1/domain-services/transfers", amaka, {
    "domainName": transfer_domain, "currentRegistrar": "Simulated Registrar LLC",
    "authCode": "demo-auth-code-1234", "authorizationConfirmed": True, "contact": CONTACT,
}, 201)
transfer_id = data.get("transferId")
check("3e transfer: starts with order (payment-gated)", ok and bool(transfer_id) and bool(data.get("orderId")),
      f"transferId={bool(transfer_id)}, orderId={bool(data.get('orderId'))}, status={data.get('statusLabel')}")

ok, code, data = call("POST", "/api/v1/account/domain-brokerage/cases", amaka, {
    "domain": "premium-asset.com", "customerName": "Amaka Obi",
    "contactInformation": "amaka@demo-customer.test", "maxBudget": 5000, "currency": "usd",
    "openingOffer": 1500, "message": "Interested in acquiring this domain for our rebrand.",
    "termsAccepted": True,
}, 201)
check("3f broker: case created over existing module", ok and bool(data.get("case", {}).get("brokerage_id")),
      f"case={data.get('case', {}).get('brokerage_id')}")

ok, code, data = call("GET", "/api/v1/account/domain-brokerage/cases", amaka)
check("3g broker: case listed", ok and any(
    c.get("domain") == "premium-asset.com" for c in data.get("cases", [])),
      f"{len(data.get('cases', []))} case(s)")

# --- 4. DASHBOARD ------------------------------------------------------------------------------
ok, code, data = call("GET", "/api/v1/domain-services/registrations", amaka)
regs = data.get("registrations", [])
check("4a dashboard: registration listed as registered", ok and any(
    r.get("domain_name") == "amaka-brand.com" and r.get("status") == "registered" for r in regs),
    f"{[(r.get('domain_name'), r.get('status')) for r in regs]}")

ok, code, data = call("GET", "/api/v1/domain-services/transfers", amaka)
check("4b dashboard: transfer listed (awaiting payment)", ok and any(
    t.get("domain_name") == transfer_domain and t.get("status") == "pending"
    for t in data.get("transfers", [])),
    f"{[(t.get('domain_name'), t.get('status')) for t in data.get('transfers', [])]}")

ok, code, data = call("GET", "/api/v1/domain-services/transactions", amaka)
check("4c dashboard: domain transactions scoped", ok and len(data.get("transactions", [])) >= 2,
      f"{len(data.get('transactions', []))} transactions")

# --- 5. ADMIN ----------------------------------------------------------------------------------
ok, code, data = call("GET", "/api/v1/admin/domain-services/overview", root)
check("5a admin: overview counters", ok and data.get("registrations", {}).get("registered") == 1
      and data.get("auctions", {}).get("live") == 1 and data.get("searchesLast24h", 0) >= 6,
      f"registrations={data.get('registrations')}, auctions={data.get('auctions')}, searches24h={data.get('searchesLast24h')}")

ok, code, data = call("GET", "/api/v1/admin/domain-services/providers", root)
statuses = {p["providerKey"]: p["status"] for p in data.get("providers", [])}
check("5a2 admin: registrar + rdap connected", ok and statuses.get("demo-registrar") == "connected"
      and statuses.get("demo-rdap") == "connected", f"{statuses}")

ok, code, data = call("GET", "/api/v1/admin/domain-services/providers", root)
check("5b admin: credentials never returned", ok and all(
    not p.get("credentials") for p in data.get("providers", [])), "")

ok, code, data = call("GET", "/api/v1/admin/domain-services/overview", amaka, [401, 403])
check("5c admin: customer blocked from admin routes", code in (401, 403), f"{code}")

# --- summary -----------------------------------------------------------------------------------
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
