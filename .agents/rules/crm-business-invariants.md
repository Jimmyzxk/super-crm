# CRM Business Invariants & Lifecycle Rules

1. **Won/Lost Deal Immutability**: Historical won/lost deals must never change ownership upon customer pool transitions.
2. **In-Flight Deal Guard**: Customers with active (non-terminal) deals cannot be released to public pool or claimed.
3. **Claimed_at Protection Window**: All pool claims must record `claimed_at` and protect from immediate recycling for at least 7 days.
4. **Customer-Centric Contacts**: Contacts belong to customers; claiming happens at customer level only.
5. **No Hardcoded Dates**: All year/month calculations must be dynamic via system date objects.
