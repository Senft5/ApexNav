"""Session in the iOS Keychain (web/sync.js + ApexApiBridge, IDEAS Z-10): in the app, /api calls go through the shell, the page
never holds the token, an older build's stored token moves over once and leaves page storage, and sign-out forgets it."""
import json
import os
import shutil
import subprocess

import pytest

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RUNNER = r"""
const m = new Map([['apex.session', 'oldtoken_oldtoken_oldtoken']]);
globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
Object.defineProperty(globalThis, 'location', { value: { protocol: 'apexnav:' } });
const sent = [];
let offline = false;
globalThis.fetch = async () => { throw new Error('the page must not fetch /api itself in the app'); };
globalThis.webkit = { messageHandlers: { apexApi: { postMessage: async (msg) => {
  sent.push(msg);
  if (msg.cmd !== 'fetch') return true;
  if (offline) throw new Error('offline');
  return msg.path === '/api/me' ? { status: 200, type: 'application/json', body: '{"signed_in":true}' } : { status: 204, type: '', body: '' };
} } } };
const S = require(process.argv[1] + '/web/sync.js');
(async () => {
  const afterLoad = { stored: m.get('apex.session') || null, flag: m.get('apex.signedIn') || null };
  const r = await S.apiFetch('/api/me', { method: 'GET', headers: { 'x-extra': 'y' } });
  const me = await r.json();
  const none = await S.apiFetch('/api/thing', { method: 'DELETE' });
  S.setSession(null);
  await S.apiFetch('/api/me');
  offline = true;
  let rejected = null; try { await S.apiFetch('/api/me'); } catch (e) { rejected = e.name; }
  console.log(JSON.stringify({ afterLoad, sent, me, ok: r.ok, noneStatus: none.status, noneBody: await none.text(), rejected, flagAfter: m.get('apex.signedIn') || null, signedIn: S.signedIn() }));
})();
"""


@pytest.fixture(scope="module")
def out():
    return json.loads(subprocess.run([NODE, "-e", RUNNER, ROOT], capture_output=True, text=True, check=True).stdout)


def test_old_token_moves_into_the_keychain_and_leaves_the_page(out):
    assert out["sent"][0] == {"cmd": "adopt", "token": "oldtoken_oldtoken_oldtoken"}
    assert out["afterLoad"] == {"stored": None, "flag": "1"}


def test_calls_go_through_the_shell_without_a_token(out):
    fetches = [m for m in out["sent"] if m["cmd"] == "fetch"]
    assert fetches[0]["path"] == "/api/me" and fetches[0]["method"] == "GET" and fetches[0]["headers"]["x-apexnav"] == "1"
    assert "token" not in json.dumps(fetches).lower() and "authorization" not in json.dumps(fetches).lower()
    assert out["ok"] is True and out["me"] == {"signed_in": True}
    assert out["noneStatus"] == 204 and out["noneBody"] == ""
    assert out["rejected"] == "TypeError", "offline rejects like fetch"


def test_sign_out_forgets_it(out):
    assert {"cmd": "signOut"} in out["sent"]
    assert out["flagAfter"] is None and out["signedIn"] is False


def test_the_shell_keeps_the_token():
    swift = open(os.path.join(ROOT, "ApexNavApp.swift"), encoding="utf-8").read()
    assert 'name: "apexApi"' in swift and "WKScriptMessageHandlerWithReply" in swift
    assert "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly" in swift
    assert "token:'" not in swift, "the token is never handed to the page"
    assert swift.count("ApexKeychain.setSession(token)") == 2, "both sign-ins keep it in the Keychain"
