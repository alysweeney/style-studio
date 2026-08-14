"""A very small Firestore REST client, authenticated as Aly's own app user.

Deliberately not firebase-admin with a service account. A service account is a
second credential to store, rotate and worry about, and it bypasses the security
rules entirely — so a bug in a script could write anywhere in the database. This
signs in with the same email and password the app uses, which means every read
and write here is subject to exactly the rules in the README, scoped to her uid.

The Firebase web API key is not a secret (it identifies the project, the rules
enforce access), so it's read straight out of cloud.js rather than stored again.
The password is a secret and lives in ~/.config/personal-automation/.
"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
FIRESTORE = "https://firestore.googleapis.com/v1/projects/{pid}/databases/(default)/documents"


def web_config():
    """Pull apiKey and projectId out of cloud.js — one source of truth."""
    src = (ROOT / "cloud.js").read_text()
    grab = lambda k: re.search(rf"{k}:\s*'([^']+)'", src).group(1)
    return grab("apiKey"), grab("projectId")


def _post(url, payload, token=None):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        raise SystemExit(f"Firestore/Auth call failed ({e.code}): {detail}")


# ---------------------------------------------------------------- values

def encode(value):
    """Python -> Firestore's typed value wrapper."""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [encode(v) for v in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: encode(v) for k, v in value.items()}}}
    raise TypeError(f"can't encode {type(value)}")


def decode(value):
    """Firestore's typed value wrapper -> Python."""
    if "nullValue" in value:
        return None
    for key, cast in (("booleanValue", bool), ("stringValue", str),
                      ("doubleValue", float), ("timestampValue", str)):
        if key in value:
            return cast(value[key])
    if "integerValue" in value:
        return int(value["integerValue"])
    if "arrayValue" in value:
        return [decode(v) for v in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {k: decode(v) for k, v in value["mapValue"].get("fields", {}).items()}
    return None


def to_doc(obj):
    return {"fields": {k: encode(v) for k, v in obj.items()}}


def from_doc(doc):
    return {k: decode(v) for k, v in (doc.get("fields") or {}).items()}


# ---------------------------------------------------------------- client

class Client:
    def __init__(self, email, password):
        api_key, self.project = web_config()
        auth = _post(f"{IDENTITY}?key={api_key}",
                     {"email": email, "password": password, "returnSecureToken": True})
        self.token = auth["idToken"]
        self.uid = auth["localId"]
        self.base = FIRESTORE.format(pid=self.project)

    def _get(self, path, params=None):
        url = f"{self.base}/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params, doseq=True)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {}
            raise SystemExit(f"Firestore read failed ({e.code}): {e.read().decode()[:300]}")

    def collection(self, name, fields=None):
        """Every document in users/{uid}/{name}, paged.

        `fields` limits what comes back — the closet stores a ~40 KB photo per
        item, and the morning job never needs the pixels. Fetching 36 of those
        for nothing is a megabyte and a half of pointless download.
        """
        out, token = [], None
        while True:
            params = {"pageSize": 300}
            if fields:
                params["mask.fieldPaths"] = list(fields)
            if token:
                params["pageToken"] = token
            page = self._get(f"users/{self.uid}/{name}", params)
            for doc in page.get("documents", []):
                item = from_doc(doc)
                item.setdefault("id", doc["name"].rsplit("/", 1)[-1])
                out.append(item)
            token = page.get("nextPageToken")
            if not token:
                return out

    def put(self, path, obj):
        """Create or overwrite users/{uid}/{path}."""
        url = f"{self.base}/users/{self.uid}/{path}"
        req = urllib.request.Request(
            url, data=json.dumps(to_doc(obj)).encode(), method="PATCH",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            raise SystemExit(f"Firestore write failed ({e.code}): {e.read().decode()[:300]}")
