"""Make a road insights API key (backend/src/road_insights.ts, data.vettadrive.com).

    python tools/data_key.py

Prints a new key (give it to whoever uses it; it is shown once) and its sha256. Add the sha256 to the Worker variable
DATA_OWNER_KEYS (internal use, works at once) or DATA_API_KEYS (a partner; works only once the road_data_partners flag is
on), comma-separated: Cloudflare dashboard -> Workers -> apexnav -> Settings -> Variables and Secrets. Remove the hash to
revoke the key. The key itself is never stored anywhere.
"""
import hashlib
import secrets

key = "vk_" + secrets.token_urlsafe(32)
print("key:   ", key)
print("sha256:", hashlib.sha256(key.encode()).hexdigest())
