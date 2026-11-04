#!/usr/bin/env python3
import os
import sys
import json
import subprocess
import urllib.request
import urllib.error

ENDPOINT = "https://models.github.ai/inference/chat/completions"
MODEL = "gpt-4o-mini"

def get_code_diff():
    # Coba ambil diff dari commit sebelumnya
    try:
        diff = subprocess.check_output(
            ["git", "diff", "HEAD~1", "HEAD", "--", "backend-rust/"],
            stderr=subprocess.DEVNULL
        ).decode("utf-8", errors="replace")
        if diff.strip():
            return diff
    except Exception:
        pass

    # Fallback: ambil git status dan diff uncommitted / against main
    try:
        diff = subprocess.check_output(
            ["git", "diff", "origin/main...HEAD", "--", "backend-rust/"],
            stderr=subprocess.DEVNULL
        ).decode("utf-8", errors="replace")
        if diff.strip():
            return diff
    except Exception:
        pass

    # Fallback terakhir: baca file Cargo.toml & main.rs & lib.rs
    snippets = []
    for root, _, files in os.walk("backend-rust"):
        for f in files:
            if f.endswith(".rs") or f.endswith(".toml"):
                p = os.path.join(root, f)
                try:
                    with open(p, "r", encoding="utf-8", errors="replace") as fp:
                        content = fp.read()
                    snippets.append(f"--- File: {p} ---\n{content[:2000]}")
                except Exception:
                    pass
    return "\n\n".join(snippets[:10])

def main():
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("⚠️ GITHUB_TOKEN not found in environment. Skipping AI check.")
        sys.exit(0)

    print("🔍 Collecting codebase diff for AI Gatekeeper...")
    diff_text = get_code_diff()
    if not diff_text.strip():
        print("ℹ️ No Rust changes detected. Passing check.")
        sys.exit(0)

    # Batasi panjang input agar aman di token limit (maks ~25.000 karakter)
    truncated_diff = diff_text[:25000]

    system_prompt = (
        "You are a strict code review and syntax auditor for Rust backend applications.\n"
        "Analyze the provided Rust code/diff for:\n"
        "1. Critical syntax errors, missing imports, unclosed delimiters, or invalid types that would fail `cargo check`.\n"
        "2. Fatal logic bugs, infinite loops, or unhandled panics on request paths.\n"
        "3. Obvious security vulnerabilities.\n\n"
        "OUTPUT FORMAT RULES:\n"
        "Your first line MUST be strictly one of these two:\n"
        "STATUS: PASS\n"
        "or\n"
        "STATUS: REJECT\n\n"
        "Then provide a concise explanation and bullet points. "
        "If rejecting, specify the exact file, issue, and why it prevents compilation."
    )

    user_prompt = f"Please review this Rust backend change:\n\n```rust\n{truncated_diff}\n```"

    payload = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "model": MODEL,
        "temperature": 0.1
    }

    req = urllib.request.Request(
        ENDPOINT,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        data=json.dumps(payload).encode("utf-8")
    )

    print("🤖 Contacting GitHub Models (GPT-4o-mini) for pre-compile review...")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            reply = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

            print("\n" + "=" * 65)
            print("  GITHUB AI GATEKEEPER VERDICT")
            print("=" * 65)
            print(reply)
            print("=" * 65 + "\n")

            if "STATUS: REJECT" in reply:
                print("❌ AI Gatekeeper detected critical issues! Build canceled.")
                sys.exit(1)
            else:
                print("✅ AI Gatekeeper passed! Proceeding to Docker build.")
                sys.exit(0)

    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"⚠️ GitHub Models API returned HTTP {e.code}: {err_body}")
        # Jangan gagalkan pipeline jika API GitHub Models sedang rate-limited / maintenance
        print("⚠️ Bypassing AI check due to API availability.")
        sys.exit(0)
    except Exception as e:
        print(f"⚠️ Failed to connect to GitHub Models: {e}")
        sys.exit(0)

if __name__ == "__main__":
    main()
