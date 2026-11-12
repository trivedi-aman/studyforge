import requests

MODEL = "openai/gpt-oss-120b"

for i, key in enumerate(API_KEYS, 1):
    print(f"\n🔑 Key {i}")

    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": [
                    {"role": "user", "content": "Reply with OK"}
                ],
                "max_tokens": 5,
            },
            timeout=30,
        )

        if response.status_code == 200:
            print("✅ GPT-OSS 120B WORKS")
            print(response.json()["choices"][0]["message"]["content"])
        else:
            print(f"❌ Failed — HTTP {response.status_code}")
            print(response.text)

    except Exception as e:
        print(f"⚠️ Error: {e}")
