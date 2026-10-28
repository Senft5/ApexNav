"""Sign in with Apple (IDEAS O-05, App Review 4.8): the page, the shell, the entitlement and the Worker route stay wired."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_wired_end_to_end():
    html, swift, yml = read("web", "index.html"), read("ApexNavApp.swift"), read("project.yml")
    assert html.count("data-apple-signin") >= 2 and "ApexSync.signInApple()" in html          # onboarding and Account
    assert html.index("Sign in with Apple") < html.index("Sign in with Google")                 # first, as prominent as Google
    assert "cmd: 'signInApple'" in read("web", "sync.js")
    assert 'case "signInApple":' in swift and "ASAuthorizationAppleIDProvider" in swift and 'appendingPathComponent("api/auth/apple")' in swift
    assert "com.apple.developer.applesignin: [Default]" in yml
    assert 'on("POST", "/api/auth/apple"' in read("backend", "src", "index.ts")
