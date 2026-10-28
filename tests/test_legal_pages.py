"""Privacy policy and terms (IDEAS O-11, docs/APP_REVIEW.md): published from web/, linked in Settings and wherever you sign in."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()


def test_pages_exist_and_link_each_other():
    privacy, terms = read("web", "privacy.html"), read("web", "terms.html")
    assert 'href="terms.html"' in privacy and 'href="privacy.html"' in terms
    assert "Delete account" in privacy and "8 weeks" in privacy           # deletion and backup retention are stated
    assert "Never your position, your path, speeds or times" in privacy                # matches contributor.js
    assert "no tolerance for objectionable content" in terms.lower()      # guideline 1.2


def test_linked_from_settings_and_every_sign_in():
    html = read("web", "index.html")
    site = re.search(r"const LEGAL_SITE = '([^']+)'", html).group(1)
    assert html.count(f'{site}/privacy.html') >= 2                          # Settings and onboarding
    buttons = html.count(">Sign in with Google</a>") + html.count("textContent: 'Sign in with Google'")
    assert buttons == html.count("you agree to the ") == 2                  # every sign-in button carries the note
